import type {PluginManifest} from './host';
import type {StoredPlugin} from './storage';

export const COMMUNITY_CATALOG='https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json';
export interface CommunityPlugin {id:string;name:string;author:string;description:string;repo:string;}
type Fetcher=typeof fetch;
export type CommunityAssetReader=(id:string,repo:string,assetId:number,max:number)=>Promise<string>;
const record=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==='object' && !Array.isArray(v);
const repoPattern=/^[a-z0-9][a-z0-9_.-]*\/(?!\.{1,2}$)[a-z0-9_.-]+$/i;
const idPattern=/^[a-z0-9][a-z0-9_.-]{0,149}$/i;
const string=(v:unknown,max:number):v is string=>typeof v==='string' && v.length>0 && v.length<=max;

/** Fixed public GitHub endpoints only. Limit actual streamed bytes, not just Content-Length. */
async function read(url:string,max:number,fetcher:Fetcher,asset=false):Promise<string>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetcher(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',
      headers:{Accept:asset?'application/octet-stream':'application/vnd.github+json'}});
    if(!response.ok)throw new Error(response.status===403 || response.status===429
      ?'GitHub 요청 한도 또는 접근 제한입니다. 잠시 후 다시 시도하세요.'
      :`다운로드 실패 (HTTP ${response.status})`);
    if(Number(response.headers.get('content-length'))>max)throw new Error('파일이 지원 크기를 넘습니다.');
    if(!response.body)throw new Error('다운로드 본문이 없습니다.');
    const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
    let length=0,text='';
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;
        length+=value.byteLength;if(length>max)throw new Error('파일이 지원 크기를 넘습니다.');
        text+=decoder.decode(value,{stream:true});
      }
      return text+decoder.decode();
    }catch(error){await reader.cancel().catch(()=>{});throw error;}
    finally{reader.releaseLock();}
  }catch(error){
    if(controller.signal.aborted)throw new Error('다운로드 시간이 초과되었습니다. 다시 시도하세요.');
    throw error;
  }finally{clearTimeout(timer);}
}

export function parseCommunityCatalog(value:unknown):CommunityPlugin[]{
  if(!Array.isArray(value) || value.length>30000)throw new Error('공식 플러그인 목록 형식이 올바르지 않습니다.');
  const ids=new Set<string>();
  return value.map(item=>{
    if(!record(item) || !string(item.id,150) || !idPattern.test(item.id) || ids.has(item.id) ||
      !string(item.name,300) || !string(item.author,500) || !string(item.description,5000) ||
      !string(item.repo,250) || !repoPattern.test(item.repo))throw new Error('공식 플러그인 목록 항목이 올바르지 않습니다.');
    ids.add(item.id);
    return {id:item.id,name:item.name,author:item.author,description:item.description,repo:item.repo};
  });
}
export async function fetchCommunityCatalog(fetcher:Fetcher=fetch):Promise<CommunityPlugin[]>{
  return parseCommunityCatalog(JSON.parse(await read(COMMUNITY_CATALOG,8*1024*1024,fetcher)));
}
export function searchCommunityPlugins(items:CommunityPlugin[],query:string):CommunityPlugin[]{
  const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item=>{const text=[item.id,item.name,item.author,item.description,item.repo].join(' ').toLowerCase();return terms.every(term=>text.includes(term));});
}

/** Validate release manifest against the selected official catalog identity before storing any executable code. */
export function releaseManifest(value:unknown,id:string):PluginManifest{
  if(!record(value) || value.id!==id || !string(value.name,300) || !string(value.version,80) ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(value.version) ||
    (value.isDesktopOnly!==undefined && typeof value.isDesktopOnly!=='boolean'))
    throw new Error('릴리스 manifest의 ID·이름·버전이 올바르지 않습니다. 설치하지 않았습니다.');
  return value as PluginManifest;
}

/** Latest stable release assets, never main/master source files. Downloading does not execute JS. */
export async function downloadCommunityPlugin(item:CommunityPlugin,fetcher:Fetcher=fetch,readAsset?:CommunityAssetReader):Promise<StoredPlugin>{
  if(!repoPattern.test(item.repo) || !idPattern.test(item.id))throw new Error('플러그인 출처가 올바르지 않습니다.');
  const base=`https://api.github.com/repos/${item.repo}/releases`;
  const release:unknown=JSON.parse(await read(`${base}/latest`,1024*1024,fetcher));
  if(!record(release) || release.draft!==false || release.prerelease!==false || !string(release.tag_name,200) || !Array.isArray(release.assets))
    throw new Error('설치할 정식 릴리스를 찾지 못했습니다.');
  const asset=async(name:string,max:number,required:boolean)=>{
    const entries=release.assets as unknown[];
    const found=entries.filter(v=>record(v) && v.name===name);
    if(!found.length && !required)return undefined;
    const file=found[0];
    if(found.length!==1 || !record(file) || !Number.isSafeInteger(file.id) || (file.id as number)<=0 ||
      typeof file.size!=='number' || file.size<1 || file.size>max)
      throw new Error(`릴리스의 ${name} 파일이 없거나 지원 크기를 넘습니다.`);
    if(!readAsset)throw new Error('다운로드 도우미를 먼저 연결하세요. GitHub 첨부파일은 작업창에서 직접 받을 수 없습니다.');
    return readAsset(item.id,item.repo,file.id as number,max);
  };
  const manifest=releaseManifest(JSON.parse((await asset('manifest.json',64*1024,true))!),item.id);
  const [mainJs,stylesCss]=await Promise.all([asset('main.js',20*1024*1024,true),asset('styles.css',2*1024*1024,false)]);
  if(!mainJs?.trim())throw new Error('main.js가 비어 있습니다.');
  return {manifest,mainJs,stylesCss,enabled:false,source:{repo:item.repo,tag:release.tag_name,
    releaseUrl:`https://github.com/${item.repo}/releases/tag/${encodeURIComponent(release.tag_name)}`}};
}
