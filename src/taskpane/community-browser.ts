import {downloadCommunityPlugin,fetchCommunityCatalog,searchCommunityPlugins,type CommunityPlugin,type CommunityAssetReader} from '../plugins/community';
import {connectCommunityDownloader} from '../plugins/community-connection';
import type {StoredPlugin} from '../plugins/storage';

const PAGE_SIZE=20;
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{
  const element=document.createElement(tag);element.textContent=text;return element;
};

export function initCommunityBrowser(options:{
  installed:()=>StoredPlugin[];
  install:(plugin:StoredPlugin)=>Promise<boolean>;
  runOperation:(action:()=>Promise<void>)=>Promise<void>;
}){
  const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const load=get<HTMLButtonElement>('community-load'),search=get<HTMLInputElement>('community-search');
  const status=get('community-status'),results=get('community-results'),pages=get('community-pages');
  const previous=get<HTMLButtonElement>('community-prev'),next=get<HTMLButtonElement>('community-next');
  const connection=get<HTMLInputElement>('community-connection'),connect=get<HTMLButtonElement>('community-connect'),disconnect=get<HTMLButtonElement>('community-disconnect');
  let readAsset:CommunityAssetReader|undefined;
  let catalog:CommunityPlugin[]=[],hasCatalog=false,fetching=false,busy=false,page=0;
  const render=()=>{
    load.disabled=fetching || busy;load.textContent=hasCatalog?'목록 새로고침':'공식 목록 불러오기';
    connect.disabled=disconnect.disabled=connection.disabled=busy;
    if(!busy)disconnect.disabled=!readAsset;
    search.disabled=!hasCatalog;
    const filtered=searchCommunityPlugins(catalog,search.value);
    const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));page=Math.min(page,totalPages-1);
    results.replaceChildren();
    if(hasCatalog){
      if(!filtered.length)results.append(node('p','검색 결과가 없습니다.'));
      for(const item of filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)){
        const row=node('article');row.className='community-result';row.dataset.communityId=item.id;
        const title=node('strong',item.name),author=node('span',` · ${item.author}`);
        const description=node('p',item.description);description.className='option-help';
        const link=node('a',item.repo);link.href=`https://github.com/${item.repo}`;link.target='_blank';link.rel='noopener noreferrer';
        const installed=options.installed().find(p=>p.manifest.id===item.id);
        const button=node('button',installed?'최신 릴리스로 다시 다운로드':'다운로드');button.type='button';button.disabled=busy || !readAsset;
        if(!readAsset)button.title='다운로드 도우미를 먼저 연결하세요';
        button.onclick=()=>options.runOperation(async()=>{
          status.textContent=`${item.name} 정식 릴리스를 내려받는 중…`;
          try{
            const bundle=await downloadCommunityPlugin(item,fetch,readAsset);
            const installed=await options.install(bundle);
            status.textContent=installed?`${item.name} 다운로드 완료. 설치 목록에서 ‘켜기’로 적용하세요.`:'교체를 취소했습니다. 기존 설치를 유지합니다.';
          }catch(error){status.textContent=`${item.name} 다운로드 실패: ${(error as Error).message}`;}
        });
        row.append(title,author,description,link);
        if(installed)row.append(node('p',`설치됨: ${installed.manifest.version??'버전 미상'}`));
        row.append(button);results.append(row);
      }
      get('community-page').textContent=`${filtered.length}개 · ${page+1} / ${totalPages}`;
    }
    pages.hidden=!hasCatalog || !filtered.length;
    previous.disabled=page===0;next.disabled=page>=totalPages-1;
  };
  load.onclick=async()=>{
    if(fetching || busy)return;
    fetching=true;status.textContent='공식 Obsidian 플러그인 목록을 불러오는 중…';render();
    try{catalog=await fetchCommunityCatalog();hasCatalog=true;page=0;status.textContent=`공식 목록 ${catalog.length}개. 이름·설명·제작자로 검색하세요.`;}
    catch(error){status.textContent=`목록을 불러오지 못했습니다: ${(error as Error).message} 목록 버튼으로 다시 시도할 수 있습니다.`;}
    finally{fetching=false;render();}
  };
  search.oninput=()=>{page=0;render();};
  connect.onclick=()=>options.runOperation(async()=>{
    const info=get('community-connection-status');info.textContent='도우미에 연결하는 중…';readAsset=undefined;
    try{readAsset=await connectCommunityDownloader(connection.value);connection.value='';info.textContent='도우미 연결됨 · 다운로드할 수 있습니다.';}
    catch(error){info.textContent=`연결 실패: ${(error as Error).message}`;}
  });
  disconnect.onclick=()=>{readAsset=undefined;connection.value='';get('community-connection-status').textContent='도우미 연결 해제됨';render();};
  previous.onclick=()=>{page=Math.max(0,page-1);render();};next.onclick=()=>{page++;render();};
  render();
  return {refresh:render,setBusy(value:boolean){busy=value;render();}};
}
