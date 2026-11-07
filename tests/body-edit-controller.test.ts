import {afterEach,expect,it,vi} from 'vitest';
import {BodyEditController} from '../src/body/edit-controller';
import type {NativeBodyLink} from '../src/body/native-bridge';
import {nativeParagraph,type NativeBodySnapshot} from '../src/body/native-port';
const tick=()=>new Promise(r=>setTimeout(r,0));
const live:BodyEditController[]=[];
afterEach(async()=>{for(const controller of live.splice(0))await controller.dispose();});
function fixture(){
 const candidate:NativeBodySnapshot={key:'candidate',epoch:'run-a',id:'',mode:'rendered',text:'Alpha bold',style:'Normal',xml:nativeParagraph('Alpha **bold**'),start:0,selectionStart:3,selectionEnd:3};
 let selected:string|null=null,mode:'source'|'rendered'='rendered',records:any[]=[];
 const host={
  selectedKey:vi.fn(async()=>selected),candidate:vi.fn(async()=>({...candidate})),
  claim:vi.fn(async(_candidate:NativeBodySnapshot,key:string)=>{selected=key;return {code:0};}),
  read:vi.fn(async(key:string)=>({...candidate,id:'42',key,mode})),journals:vi.fn(async()=>records),
  transition:vi.fn(async()=>{throw new Error('Stage 1 must never rewrite source/rendered content');}),
 };
 let frame:(value:unknown)=>void=()=>{},disconnect:()=>void=()=>{},sequence=0;
 const link:NativeBodyLink={epoch:'run-a',capabilities:{ownership:true,selection:true},host,
  subscribe:vi.fn((signal,lost)=>{frame=signal;disconnect=()=>lost();return vi.fn();}),close:vi.fn(async()=>{}),
 };
 const bridge={open:vi.fn(async()=>link)},changes:any[]=[];
 const controller=new BodyEditController(bridge,state=>changes.push(state));live.push(controller);
 const emit=(state='idle',extra={})=>frame({epoch:'run-a',seq:++sequence,state,snapshot:sequence===1,selection:0,selectionSupported:true,...extra});
 return {controller,host,link,bridge,candidate,emit,disconnect:()=>disconnect(),changes,setExisting(key:string,nextMode:'source'|'rendered'='rendered',journals:any[]=[]){selected=key;mode=nextMode;records=journals;}};
}
it('does not query or register before a trusted idle; enrollment never converts the body',async()=>{
 const f=fixture();await f.controller.start();f.emit('unknown');f.emit('active');await tick();
 expect(f.host.selectedKey).not.toHaveBeenCalled();expect(f.host.claim).not.toHaveBeenCalled();
 f.emit();await tick();expect(f.controller.state.phase).toBe('ready');expect(f.host.claim).toHaveBeenCalledOnce();
 expect(f.host.transition).not.toHaveBeenCalled();await f.controller.stop();expect(f.controller.state.phase).toBe('stopped');expect(f.link.close).toHaveBeenCalledOnce();
});
it('restarts on the same verified owned paragraph without wrapping it again',async()=>{
 const f=fixture();await f.controller.start();f.emit();await tick();const key=f.controller.state.key;
 await f.controller.stop();await f.controller.start();f.emit('idle',{snapshot:true});await tick();
 expect(f.controller.state).toMatchObject({phase:'ready',key});expect(f.host.claim).toHaveBeenCalledOnce();
});
it('does not poll or repeat live-region status updates on unchanged health frames',async()=>{
 const f=fixture();await f.controller.start();f.emit();await tick();
 const updates=f.changes.length,reads=f.host.selectedKey.mock.calls.length;
 f.emit();f.emit();await tick();expect(f.changes).toHaveLength(updates);expect(f.host.selectedKey).toHaveBeenCalledTimes(reads);
 await f.controller.stop();expect(f.controller.state.input).toBe('unknown');
});
it('requires ownership capability and native selection support',async()=>{
 const f=fixture();f.link.capabilities.ownership=false;await f.controller.start();await tick();
 expect(f.controller.state.phase).toBe('error');expect(f.host.selectedKey).not.toHaveBeenCalled();expect(f.link.close).toHaveBeenCalledOnce();
 const g=fixture();await g.controller.start();g.emit('idle',{selectionSupported:false});await tick();
 expect(g.controller.state.phase).toBe('error');expect(g.host.claim).not.toHaveBeenCalled();
});
it('waits for a late connection before completing stop, and never enrolls it',async()=>{
 const f=fixture();let resolve!:(link:NativeBodyLink)=>void;
 f.bridge.open.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const starting=f.controller.start();await tick();const stopping=f.controller.stop();
 expect(f.controller.state.phase).toBe('stopping');resolve(f.link);await Promise.all([starting,stopping]);
 expect(f.controller.state.phase).toBe('stopped');expect(f.link.subscribe).not.toHaveBeenCalled();expect(f.link.close).toHaveBeenCalledOnce();
});
it('cancels after an outstanding candidate read without submitting a claim',async()=>{
 const f=fixture();let resolve!:(value:NativeBodySnapshot)=>void;
 f.host.candidate.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 await f.controller.start();f.emit();await tick();const stopping=f.controller.stop();resolve(f.candidate);await stopping;
 expect(f.host.claim).not.toHaveBeenCalled();expect(f.controller.state.phase).toBe('stopped');
});
it('awaits an in-flight claim result during stop and sends no post-stop reads or retries',async()=>{
 const f=fixture();let resolve!:(result:{code:number})=>void;
 f.host.claim.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 await f.controller.start();f.emit();await tick();expect(f.host.claim).toHaveBeenCalledOnce();
 const reads=f.host.selectedKey.mock.calls.length,stopping=f.controller.stop();
 expect(f.controller.state.phase).toBe('stopping');expect(f.link.close).not.toHaveBeenCalled();
 resolve({code:0});await stopping;expect(f.host.selectedKey).toHaveBeenCalledTimes(reads);expect(f.host.claim).toHaveBeenCalledOnce();expect(f.link.close).toHaveBeenCalledOnce();
});
it('does not hide an unknown in-flight mutation outcome when Stop was already requested',async()=>{
 const f=fixture();let fail!:(error:unknown)=>void;
 f.host.claim.mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject;}));
 await f.controller.start();f.emit();await tick();const stopping=f.controller.stop();fail(new Error('reply lost'));
 await stopping;expect(f.controller.state.phase).toBe('error');expect(f.controller.state.message).toContain('Ctrl+Z');expect(f.host.claim).toHaveBeenCalledOnce();
});
it('ignores the intentional disconnect notification from closing a stopped lease',async()=>{
 const f=fixture();vi.mocked(f.link.close).mockImplementation(async()=>{f.disconnect();});
 await f.controller.start();f.emit();await tick();await f.controller.stop();expect(f.controller.state.phase).toBe('stopped');
});
it('gates post-registration verification when input becomes active',async()=>{
 const f=fixture();let resolve!:(result:{code:number})=>void;
 f.host.claim.mockImplementation(async(_candidate,key)=>{f.setExisting(key);return new Promise(r=>{resolve=r;});});
 await f.controller.start();f.emit();await tick();f.emit('active');const reads=f.host.selectedKey.mock.calls.length;
 resolve({code:0});await tick();expect(f.host.selectedKey).toHaveBeenCalledTimes(reads);expect(f.controller.state.phase).toBe('waiting');
 f.emit();await tick();expect(f.controller.state.phase).toBe('ready');expect(f.host.claim).toHaveBeenCalledOnce();
});
it('disconnects and ignores late frames without replay',async()=>{
 const f=fixture();await f.controller.start();f.disconnect();await tick();f.emit();await tick();
 expect(f.controller.state.phase).toBe('error');expect(f.host.claim).not.toHaveBeenCalled();expect(f.link.close).toHaveBeenCalledOnce();
});
it('pauses on wrong epoch or missing initial snapshot',async()=>{
 for(const extra of [{epoch:'old'}, {snapshot:false}]){
  const f=fixture();await f.controller.start();f.emit('idle',extra);await tick();expect(f.controller.state.phase).toBe('error');expect(f.host.selectedKey).not.toHaveBeenCalled();
 }
});
it('refuses interrupted/source states using reads only',async()=>{
 for(const [mode,records] of [['source',[]],['rendered',[{key:'existing',phase:'editing'}]]] as const){
  const f=fixture();f.setExisting('existing',mode,[...records]);await f.controller.start();f.emit();await tick();
  expect(f.controller.state.phase).toBe('error');expect(f.host.claim).not.toHaveBeenCalled();expect(f.host.transition).not.toHaveBeenCalled();
 }
});
it('reports unknown registration outcome with Word Undo and never retries',async()=>{
 const f=fixture();f.host.claim.mockRejectedValue(new Error('reply lost'));await f.controller.start();f.emit();await tick();
 expect(f.controller.state.phase).toBe('error');expect(f.controller.state.message).toContain('Ctrl+Z');f.emit();await tick();expect(f.host.claim).toHaveBeenCalledOnce();
});
