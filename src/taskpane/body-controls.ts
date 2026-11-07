import {BodyEditController,type BodyControlState} from '../body/edit-controller';
import type {NativeBodyBridge} from '../body/native-bridge';

export function mountBodyControls(root:HTMLElement,bridge:NativeBodyBridge){
  const start=root.querySelector<HTMLButtonElement>('[data-body-start]')!;
  const stop=root.querySelector<HTMLButtonElement>('[data-body-stop]')!;
  const status=root.querySelector<HTMLElement>('[data-body-status]')!;
  let disposed=false;
  const render=(state:BodyControlState)=>{
    if(disposed)return;
    root.dataset.state=state.phase;status.textContent=state.message;
    const inactive=['off','stopped','error'].includes(state.phase);
    start.disabled=!inactive;stop.disabled=inactive || state.phase==='stopping';
  };
  const controller=new BodyEditController(bridge,render);
  start.onclick=()=>{void controller.start();};stop.onclick=()=>{void controller.stop();};
  root.hidden=false;render(controller.state);
  return {controller,async dispose(){disposed=true;start.onclick=null;stop.onclick=null;root.hidden=true;await controller.dispose();}};
}
