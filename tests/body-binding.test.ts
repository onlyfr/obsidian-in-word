import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const tick=()=>new Promise(r=>setTimeout(r,0));
beforeEach(()=>{vi.resetModules();document.body.innerHTML='<section id="body-controls" hidden><button data-body-check>상태 확인</button><button data-body-start>시작</button><button data-body-stop>중지</button><p data-body-status></p></section>';});
afterEach(()=>vi.doUnmock('../src/taskpane/body-controls'));
it('does not load controls or open any connection without explicit injection',async()=>{
 const mount=vi.fn();vi.doMock('../src/taskpane/body-controls',()=>({mountBodyControls:mount}));
 const {bindBodyControls}=await import('../src/taskpane/body-binding');
 const root=document.getElementById('body-controls')!,dispose=bindBodyControls(root);await tick();
 expect(root.hidden).toBe(true);expect(mount).not.toHaveBeenCalled();dispose();
});
it('waits for old controls to retire before mounting a replacement bridge',async()=>{
 let finish!:()=>void;const closing=new Promise<void>(r=>{finish=r;});
 const mount=vi.fn().mockImplementationOnce((root:HTMLElement)=>{root.hidden=false;return {dispose:()=>closing};}).mockImplementation((root:HTMLElement)=>{root.hidden=false;return {dispose:async()=>{}};});
 vi.doMock('../src/taskpane/body-controls',()=>({mountBodyControls:mount}));
 const {bindBodyControls}=await import('../src/taskpane/body-binding'),{installNativeBodyBridge}=await import('../src/body/native-bridge');
 const root=document.getElementById('body-controls')!,dispose=bindBodyControls(root);
 const first=installNativeBodyBridge({open:vi.fn()});await tick();expect(mount).toHaveBeenCalledOnce();first();
 const second=installNativeBodyBridge({open:vi.fn()});await tick();expect(mount).toHaveBeenCalledOnce();
 finish();await tick();expect(mount).toHaveBeenCalledTimes(2);second();dispose();
});
it('reports a native UI chunk failure without opening the bridge',async()=>{
 vi.doMock('../src/taskpane/body-controls',()=>{throw new Error('chunk missing');});
 const {bindBodyControls}=await import('../src/taskpane/body-binding'),{installNativeBodyBridge}=await import('../src/body/native-bridge');
 const root=document.getElementById('body-controls')!,dispose=bindBodyControls(root),open=vi.fn();
 const remove=installNativeBodyBridge({open});await tick();
 expect(root.hidden).toBe(false);expect(root.dataset.state).toBe('error');expect(open).not.toHaveBeenCalled();
 expect(root.querySelector<HTMLButtonElement>('[data-body-start]')!.disabled).toBe(true);remove();dispose();
});
it('requires detaching a provider before another can replace it',async()=>{
 const {installNativeBodyBridge}=await import('../src/body/native-bridge');
 const remove=installNativeBodyBridge({open:vi.fn()});
 expect(()=>installNativeBodyBridge({open:vi.fn()})).toThrow('이미 등록');remove();
});
