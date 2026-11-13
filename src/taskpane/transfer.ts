import {PluginLibrary,LocalDataStore,type StoredPlugin} from '../plugins/storage';
import {loadEditorPreferences,loadMathOutput,loadMathAppearance,loadMathAppearanceSource} from './preferences';

export const TRANSFER_LIMIT=50*1024*1024;
export const JOURNAL_KEY='oiw:transfer-pending';
const optionKeys=['oiw:editor-options','oiw:math-output','oiw:math-image-appearance','oiw:math-image-appearance-source'] as const;
type Preferences={editor:ReturnType<typeof loadEditorPreferences>;mathOutput:ReturnType<typeof loadMathOutput>;mathAppearance:ReturnType<typeof loadMathAppearance>;mathSource:ReturnType<typeof loadMathAppearanceSource>};
export interface TransferArchive {format:'obsidian-in-word-settings';version:1;plugins:{bundle:StoredPlugin;data?:unknown}[];preferences:Preferences;}
const object=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==='object' && !Array.isArray(value);
const idPattern=/^[a-z0-9][a-z0-9_.-]{0,149}$/i;
const bytes=(text:string)=>new TextEncoder().encode(text).length;
const fail=():never=>{throw new Error('이관 파일 형식 또는 값이 올바르지 않습니다.');};
export function parseTransfer(text:string):TransferArchive{
  if(bytes(text)>TRANSFER_LIMIT)throw new Error('이관 파일은 50MB 이하여야 합니다.');
  const value:unknown=JSON.parse(text.replace(/^\uFEFF/,''),(_key,value)=>typeof value==='number' && !Number.isFinite(value)?fail():value);
  if(!object(value) || value.format!=='obsidian-in-word-settings' || value.version!==1 || !Array.isArray(value.plugins) || value.plugins.length>1000 || !object(value.preferences))return fail();
  const ids=new Set<string>();
  const plugins=value.plugins.map(entry=>{
    if(!object(entry) || !object(entry.bundle) || !object(entry.bundle.manifest))return fail();
    const b=entry.bundle,m=b.manifest as Record<string,unknown>;
    if(typeof m.id!=='string' || !idPattern.test(m.id) || ids.has(m.id) || typeof m.name!=='string' || !m.name || m.name.length>300 || bytes(JSON.stringify(m))>65536 ||
      (m.version!==undefined && (typeof m.version!=='string' || m.version.length>80)) || typeof b.mainJs!=='string' || !b.mainJs.trim() || bytes(b.mainJs)>20*1024*1024 ||
      (b.stylesCss!==undefined && (typeof b.stylesCss!=='string' || bytes(b.stylesCss)>2*1024*1024)))return fail();
    ids.add(m.id);
    const bundle:StoredPlugin={manifest:m as StoredPlugin['manifest'],mainJs:b.mainJs,enabled:false};
    if(typeof b.stylesCss==='string')bundle.stylesCss=b.stylesCss;
    if(b.source!==undefined){const s=b.source;if(!object(s) || typeof s.repo!=='string' || s.repo.length>250 || !/^[a-z0-9][a-z0-9_.-]*\/(?!\.{1,2}$)[a-z0-9_.-]+$/i.test(s.repo) || typeof s.tag!=='string' || s.tag.length>200)return fail();
      bundle.source={repo:s.repo,tag:s.tag,releaseUrl:`https://github.com/${s.repo}/releases/tag/${encodeURIComponent(s.tag)}`};}
    return Object.hasOwn(entry,'data')?{bundle,data:entry.data}:{bundle};
  });
  const p=value.preferences,e=p.editor,a=p.mathAppearance;
  if(!object(e) || typeof e.lineNumbers!=='boolean' || typeof e.wrap!=='boolean' || ![12,14,16,18,20].includes(e.fontSize as number) ||
    !['hybrid','images'].includes(p.mathOutput as string) || !['manual','selection'].includes(p.mathSource as string) || !object(a) ||
    typeof a.sizePt!=='number' || a.sizePt<6 || a.sizePt>36 || Math.round(a.sizePt*2)!==a.sizePt*2 || typeof a.color!=='string' || !/^#[0-9a-f]{6}$/i.test(a.color))return fail();
  return {format:'obsidian-in-word-settings',version:1,plugins,preferences:{editor:{lineNumbers:e.lineNumbers,wrap:e.wrap,fontSize:e.fontSize as Preferences['editor']['fontSize']},mathOutput:p.mathOutput as Preferences['mathOutput'],mathSource:p.mathSource as Preferences['mathSource'],mathAppearance:{sizePt:a.sizePt,color:a.color.toLowerCase()}}};
}
export function createTransfer(plugins:StoredPlugin[],data:LocalDataStore,preferences?:TransferArchive['preferences']):string{
  const archive:TransferArchive={format:'obsidian-in-word-settings',version:1,
    plugins:plugins.map(bundle=>{const value=data.get(bundle.manifest.id);return value===undefined?{bundle}:{bundle,data:value};}),
    preferences:preferences??{editor:loadEditorPreferences(),mathOutput:loadMathOutput(),mathAppearance:loadMathAppearance(),mathSource:loadMathAppearanceSource()}};
  const text=JSON.stringify(archive);parseTransfer(text);return text;
}
function locked<T>(action:()=>Promise<T>):Promise<T>{
  if(!navigator.locks)throw new Error('이 환경은 안전한 이관 잠금을 지원하지 않습니다. 최신 Windows 앱에서 시도하세요.');
  return navigator.locks.request('oiw-settings-transfer',action);
}
type Journal={id:string;before:[string,string|null,string][]};
function journal():Journal|null{
  const raw=localStorage.getItem(JOURNAL_KEY);if(raw===null)return null;
  const value:unknown=JSON.parse(raw);
  if(!object(value) || typeof value.id!=='string' || !/^[0-9a-f-]{36}$/.test(value.id) || !Array.isArray(value.before) || value.before.length>1004)throw new Error('이관 중단 기록을 확인할 수 없습니다. 저장소를 초기화하지 말고 기록을 확인하세요.');
  const seen=new Set<string>();
  for(const entry of value.before){if(!Array.isArray(entry) || entry.length!==3 || typeof entry[0]!=='string' || seen.has(entry[0]) ||
    !(optionKeys.includes(entry[0] as typeof optionKeys[number]) || (entry[0].startsWith('oiw:data:') && idPattern.test(entry[0].slice(9)))) ||
    (entry[1]!==null && typeof entry[1]!=='string') || typeof entry[2]!=='string')throw new Error('이관 중단 기록의 키가 올바르지 않습니다.');seen.add(entry[0]);}
  return value as unknown as Journal;
}
async function recoverUnlocked(library:PluginLibrary):Promise<boolean>{
  const pending=journal();if(!pending)return false;
  if(!await library.transferCommitted(pending.id))for(const [key,value,imported] of pending.before){
    if(localStorage.getItem(key)!==imported)continue; // Preserve a later edit from another pane.
    if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);
  }
  localStorage.removeItem(JOURNAL_KEY);return true;
}
export async function recoverTransfer(library:PluginLibrary):Promise<boolean>{
  if(!hasPendingTransfer())return false;
  return locked(()=>recoverUnlocked(library));
}
export function hasPendingTransfer():boolean{try{return localStorage.getItem(JOURNAL_KEY)!==null;}catch{return false;}}
export async function importTransfer(archive:TransferArchive,library:PluginLibrary,includePreferences:boolean):Promise<{added:string[];skipped:number;preferences:boolean}>{
  // Revalidate a caller-supplied object as well as file input.
  const validated=parseTransfer(JSON.stringify(archive));
  return locked(async()=>{
    await recoverUnlocked(library);
    const existing=new Set((await library.list()).map(p=>p.manifest.id));
    const incoming=validated.plugins.filter(p=>!existing.has(p.bundle.manifest.id));
    const values:[string,string][]=[];
    for(const entry of incoming)if(Object.hasOwn(entry,'data'))values.push(['oiw:data:'+entry.bundle.manifest.id,JSON.stringify(entry.data)]);
    if(includePreferences){const p=validated.preferences;values.push([optionKeys[0],JSON.stringify(p.editor)],[optionKeys[1],p.mathOutput],[optionKeys[2],JSON.stringify(p.mathAppearance)],[optionKeys[3],p.mathSource]);}
    const id=crypto.randomUUID();
    await library.transferCommitted(id); // Confirm persistent storage before local writes.
    const pending:Journal={id,before:values.map(([key,value])=>[key,localStorage.getItem(key),value])};
    localStorage.setItem(JOURNAL_KEY,JSON.stringify(pending));
    try{
      for(const [key,value] of values)localStorage.setItem(key,value);
      await library.commitTransfer(id,incoming.map(entry=>entry.bundle));
    }catch(error){
      let committed:boolean;
      try{committed=await library.transferCommitted(id);await recoverUnlocked(library);}catch{throw new Error('이관이 끝나지 않았습니다. 중단 기록을 유지했으므로 작업창을 다시 열어 저장 결과를 확인하세요.');}
      if(!committed)throw error;
    }
    try{localStorage.removeItem(JOURNAL_KEY);}catch{/* Committed marker resolves this record on the next open. */}
    return {added:incoming.map(entry=>entry.bundle.manifest.id),skipped:validated.plugins.length-incoming.length,preferences:includePreferences};
  });
}
