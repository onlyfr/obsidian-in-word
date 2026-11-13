import type {PluginLibrary,LocalDataStore,StoredPlugin} from '../plugins/storage';
import {createTransfer,parseTransfer,importTransfer,TRANSFER_LIMIT,type TransferArchive} from './transfer';
import {askConfirm} from './confirm';
export interface TransferUiOptions {exclusive:<T>(action:()=>Promise<T>)=>Promise<T>;preferencesChanged:()=>void;preferencesSnapshot?:()=>TransferArchive['preferences'];}
export function initTransferUi(options:TransferUiOptions & {library:PluginLibrary;dataStore:LocalDataStore;installed:()=>StoredPlugin[];runOperation:(action:()=>Promise<void>)=>Promise<void>;changed:()=>Promise<void>}){
  const exportButton=document.getElementById('transfer-export') as HTMLButtonElement,input=document.getElementById('transfer-file') as HTMLInputElement;
  const status=document.getElementById('transfer-status')!,include=document.getElementById('transfer-preferences') as HTMLInputElement;
  const execute=(action:()=>Promise<void>)=>options.runOperation(async()=>{
    try{await options.exclusive(action);}catch(error){
      const message=error instanceof SyntaxError?'JSON 파일 형식이 올바르지 않습니다.':(error as Error).name==='QuotaExceededError'?'저장 공간이 부족합니다. 기존 설정을 유지했는지 확인하고 공간을 확보한 뒤 다시 시도하세요.':(error as Error).message;
      status.textContent=`이관 실패: ${message}`;
    }
  });
  exportButton.onclick=()=>execute(async()=>{
    const text=createTransfer(options.installed(),options.dataStore,options.preferencesSnapshot?.());
    (document.getElementById('transfer-json-text') as HTMLTextAreaElement).value=text;document.getElementById('transfer-json')!.hidden=false;
    const blob=new Blob([text],{type:'application/json'});let url:string|undefined;
    try{url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='obsidian-in-word-settings.json';
      document.body.append(link);try{link.click();}finally{link.remove();}
      status.textContent=`이관 파일 생성 완료 · 플러그인 ${options.installed().length}개와 옵션. 다운로드가 안 되면 JSON 보기에서 복사해 저장하세요.`;
    }catch{status.textContent='이관 JSON을 만들었지만 다운로드를 시작하지 못했습니다. JSON 보기에서 복사해 저장하세요.';}
    finally{if(url)setTimeout(()=>URL.revokeObjectURL(url!),30000);}
  });
  input.onchange=async()=>{
    const file=input.files?.[0];if(!file)return;
    try{await execute(async()=>{
      try{
        if(file.size>TRANSFER_LIMIT)throw new Error('이관 파일은 50MB 이하여야 합니다.');
        const archive=parseTransfer(await file.text()),existing=new Set(options.installed().map(p=>p.manifest.id));
        const added=archive.plugins.filter(p=>!existing.has(p.bundle.manifest.id)).length,preferences=include.checked;
        const agreed=await askConfirm(document.getElementById('plugins')!,`신규 플러그인 ${added}개를 꺼짐으로 설치하고 기존 ID ${archive.plugins.length-added}개는 건너뜁니다. 옵션 ${preferences?'적용':'유지'}. 신규 플러그인의 설정은 이관 파일 값을 사용합니다. 가져올까요?`,'가져오기','취소');
        if(!agreed){status.textContent='이관을 취소했습니다.';return;}
        const result=await importTransfer(archive,options.library,preferences);
        for(const id of result.added)options.dataStore.refresh(id);
        if(result.preferences)options.preferencesChanged();
        await options.changed();status.textContent=`이관 완료 · 신규 ${result.added.length}개 (꺼짐), 기존 ${result.skipped}개 유지, 옵션 ${result.preferences?'적용':'유지'}`;
      }finally{input.value='';}
    });}finally{input.value='';}
  };
}
