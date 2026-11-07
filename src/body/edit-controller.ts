import {NativeImeConnection,type NativeImeSignal} from './native-ime';
import {NativeBodyOwnership,type NativeOwnershipHost} from './native-ownership';
import type {NativeBodyBridge,NativeBodyLink} from './native-bridge';

type Input=NativeImeSignal['state'];
export type BodyControlPhase='off'|'connecting'|'waiting'|'registering'|'ready'|'stopping'|'stopped'|'error';
export interface BodyControlState {phase:BodyControlPhase;input:Input;key?:string;message:string;}
class Cancelled extends Error {}
interface Run {
  cancelled:boolean;input:Input;key?:string;failure?:string;mutationSubmitted:boolean;
  link?:NativeBodyLink;ime?:NativeImeConnection;unsubscribe?:()=>void;
  setup?:Promise<void>;enrollment?:Promise<void>;cleanup?:Promise<void>;
  waiters:Set<{resolve:()=>void;reject:(error:unknown)=>void}>;
}

/** Stage 1: explicit enrollment and lifecycle only. No source/render writes or recovery commands. */
export class BodyEditController {
  private current:Run|null=null;
  private disposed=false;
  private value:BodyControlState={phase:'off',input:'unknown',message:'본문 편집 준비가 꺼져 있습니다.'};
  constructor(private bridge:NativeBodyBridge,private changed:(state:BodyControlState)=>void=()=>{}){}
  get state():BodyControlState{return {...this.value};}
  private publish(phase:BodyControlPhase,message:string,run?:Run){
    const input=run?.input??'unknown',key=run?.key;
    if(this.value.phase===phase && this.value.message===message && this.value.input===input && this.value.key===key)return;
    this.value={phase,message,input,key};this.changed(this.state);
  }
  private alive(run:Run):boolean{return this.current===run && !run.cancelled;}
  private assertAlive(run:Run){if(!this.alive(run))throw new Cancelled();}
  start():Promise<void>{
    if(this.disposed || this.current)return Promise.resolve();
    const run:Run={cancelled:false,input:'unknown',mutationSubmitted:false,waiters:new Set()};
    this.current=run;this.publish('connecting','본문 연결을 확인하고 있습니다.',run);
    run.setup=Promise.resolve().then(()=>this.open(run)).catch(error=>this.fail(run,error));
    return run.setup;
  }
  private async open(run:Run){
    this.assertAlive(run);
    const link=await this.bridge.open();run.link=link;
    if(!this.alive(run))return;
    if(!link.epoch || link.capabilities?.ownership!==true || link.capabilities?.selection!==true)throw new Error('이 연결은 본문 편집 준비를 지원하지 않습니다.');
    run.ime=new NativeImeConnection({signal:async input=>this.input(run,input)},link.epoch,error=>this.fail(run,error),2500,()=>{});
    this.publish('waiting','Word 본문에서 등록할 일반 문단을 선택하세요.',run);
    run.unsubscribe=link.subscribe(frame=>{
      if(!this.alive(run))return;
      run.ime!.receive(frame);
      if(run.ime!.isClosed)this.fail(run,new Error('입력 연결을 확인할 수 없어 중지했습니다.'));
    },()=>this.fail(run,new Error('본문 연결이 종료되어 중지했습니다.')));
  }
  private input(run:Run,input:Input){
    if(!this.alive(run))return;
    run.input=input;
    if(input==='idle'){
      for(const waiter of run.waiters)waiter.resolve();run.waiters.clear();
      if(run.key)this.publish('ready','문단 등록이 완료됐습니다. 본문 편집 준비 상태입니다.',run);
      else if(!run.enrollment){
        this.publish('registering','선택한 문단을 확인하고 등록합니다.',run);
        run.enrollment=Promise.resolve().then(()=>this.enroll(run)).catch(error=>{if(!(error instanceof Cancelled))this.fail(run,error,true);});
      }
    }else this.publish('waiting',input==='active'?'글자 입력이 끝날 때까지 기다립니다.':'Word 본문에서 등록할 일반 문단을 선택하세요.',run);
  }
  private async idle<T>(run:Run,operation:()=>Promise<T>):Promise<T>{
    for(;;){
      this.assertAlive(run);
      if(run.input==='idle')return operation();
      await new Promise<void>((resolve,reject)=>run.waiters.add({resolve,reject}));
    }
  }
  private async verifyRendered(run:Run,key:string){
    const link=run.link!;
    const block=await this.idle(run,()=>link.host.read(key));this.assertAlive(run);
    if(!block || block.key!==key || block.epoch!==link.epoch || block.mode!=='rendered')throw new Error('문단 상태를 확인할 수 없습니다. Word의 Ctrl+Z / Ctrl+Y로 문서를 확인하세요.');
    const records=await this.idle(run,()=>link.host.journals());this.assertAlive(run);
    const record=records.find(item=>item.key===key);
    if(record && (record.phase!=='closed' || record.nativeStage))throw new Error('중단된 전환 기록이 있습니다. Word의 Ctrl+Z / Ctrl+Y로 문서를 확인하세요.');
  }
  private async enroll(run:Run){
    const host=run.link!.host;
    const gated:NativeOwnershipHost={
      selectedKey:()=>this.idle(run,()=>host.selectedKey()),
      candidate:()=>this.idle(run,()=>host.candidate()),
      claim:(candidate,key)=>this.idle(run,async()=>{
        run.mutationSubmitted=true;
        try{return await host.claim(candidate,key);}
        catch(cause){throw new Error('문단 등록 결과를 확인할 수 없습니다. 자동으로 다시 등록하지 않습니다.',{cause});}
      }),
    };
    const selected=await gated.selectedKey();this.assertAlive(run);
    if(selected)await this.verifyRendered(run,selected);
    const key=await new NativeBodyOwnership(gated).claimSelected();this.assertAlive(run);
    await this.verifyRendered(run,key);this.assertAlive(run);
    run.key=key;
    this.publish(run.input==='idle'?'ready':'waiting',run.input==='idle'?'문단 등록이 완료됐습니다. 본문 편집 준비 상태입니다.':'입력 상태를 확인할 때까지 기다립니다.',run);
  }
  private fail(run:Run,error:unknown,pendingOutcome=false){
    if(this.current!==run)return;
    let message=(error as Error)?.message??String(error);
    if(run.mutationSubmitted)message+=' 문서가 바뀌었다면 Word에서 Ctrl+Z로 확인하세요.';
    if(run.cancelled){
      // Stop cancels follow-up work, but cannot turn a lost in-flight mutation reply into known success.
      if(pendingOutcome && run.mutationSubmitted)run.failure??=message;
      return;
    }
    run.failure=message;
    void this.finish(run);
  }
  stop():Promise<void>{return this.current?this.finish(this.current):Promise.resolve();}
  private finish(run:Run):Promise<void>{
    if(run.cleanup)return run.cleanup;
    run.cancelled=true;run.input='unknown';
    for(const waiter of run.waiters)waiter.reject(new Cancelled());run.waiters.clear();
    this.publish('stopping',run.failure??'진행 중인 작업을 확인한 뒤 중지합니다.',run);
    run.ime?.disconnect();
    run.cleanup=Promise.resolve().then(async()=>{
      await Promise.allSettled([run.setup,run.enrollment]);
      try{run.unsubscribe?.();}catch(error){run.failure??=(error as Error).message;}
      try{await run.link?.close();}catch(error){run.failure??=(error as Error).message;}
      if(this.current===run){
        this.current=null;
        this.publish(run.failure?'error':'stopped',run.failure??'본문 편집 준비를 중지했습니다.',run);
      }
    });
    return run.cleanup;
  }
  async dispose(){this.disposed=true;await this.stop();}
}
