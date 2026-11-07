import {observeNativeBodyBridge} from '../body/native-bridge';
import type {mountBodyControls} from './body-controls';

/** Ordinary web task panes stay disconnected. Heavy native modules load only after explicit host injection. */
export function bindBodyControls(root:HTMLElement){
  let generation=0,current:ReturnType<typeof mountBodyControls>|undefined;
  let retiring:Promise<void>=Promise.resolve();
  const stop=observeNativeBodyBridge(bridge=>{
    const own=++generation,old=current;current=undefined;root.hidden=true;
    const closing=old?.dispose();
    retiring=Promise.allSettled([retiring,closing]).then(()=>{});
    void (async()=>{
      await retiring;
      if(!bridge || own!==generation)return;
      const {mountBodyControls}=await import('./body-controls');
      if(own===generation)current=mountBodyControls(root,bridge);
    })().catch(()=>{
      if(own!==generation)return;
      root.hidden=false;root.dataset.state='error';
      root.querySelector<HTMLElement>('[data-body-status]')!.textContent='본문 편집 준비 화면을 불러오지 못했습니다. 작업창을 다시 열어주세요.';
      root.querySelector<HTMLButtonElement>('[data-body-start]')!.disabled=true;
      root.querySelector<HTMLButtonElement>('[data-body-stop]')!.disabled=true;
    });
  });
  const dispose=()=>{stop();generation++;void current?.dispose();root.hidden=true;};
  window.addEventListener('pagehide',dispose,{once:true});
  return ()=>{window.removeEventListener('pagehide',dispose);dispose();};
}
