import {NativeBodyPort, type NativeBodyHost, type NativeTransition} from "../../src/body/native-port";
import {BodyEditSession} from "../../src/body/session";
import {inlineBodyCodec} from "../../src/body/inline-codec";
import {NativeBodyOwnership,type NativeOwnershipHost} from "../../src/body/native-ownership";
import {BodySelectionDriver} from "../../src/body/selection-driver";
import {NativeImeConnection} from "../../src/body/native-ime";

export function createNativeHarness(token: string) {
  const host: NativeBodyHost & NativeOwnershipHost & {failAt: number;dropReply:boolean; operations: unknown[];selectionReads:number} = {
    failAt: 0,dropReply:false, operations: [],
    selectionReads:0,
    async selectedKey(){host.selectionReads++;return request({op:'selectedKey'});},
    async candidate(){return request({op:'candidate'});},
    async claim(candidate,key){host.operations.push({mode:'claim',key});return request({op:'claim',candidate,key});},
    async read(key) {return request({op:"read",key});},
    async journals() {return request({op:"journals"});},
    async transition(change: NativeTransition) {
      host.operations.push({mode:change.mode,key:change.expected.key});
      const dropReply=host.dropReply;host.dropReply=false;
      return request({op:"transition",change,failAt:host.failAt,dropReply});
    },
  };
  async function request(job: unknown) {
    const response = await fetch("/__test/native-body",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(job)});
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json(); if (!result.ok) throw new Error(result.error); return result.value;
  }
  const port = new NativeBodyPort(host), session = new BodyEditSession(port,inlineBodyCodec);
  const ownership=new NativeBodyOwnership(host);
  function connectSelection(epoch:string){
    const errors:string[]=[],signals:any[]=[];
    const driver=new BodySelectionDriver(session,()=>host.selectedKey(),e=>errors.push(String(e)));
    const connection=new NativeImeConnection(driver,epoch,e=>errors.push(String(e)),2500,()=>driver.notify());
    const stream=new EventSource('/__test/ime');
    stream.onmessage=e=>{try{const frame=JSON.parse(e.data);signals.push({...frame,selectionReads:host.selectionReads});connection.receive(frame);}catch(error){errors.push(String(error));connection.disconnect();}};
    stream.onerror=()=>connection.disconnect();
    return {driver,connection,stream,errors,signals,dispose(){stream.close();connection.disconnect();driver.dispose();}};
  }
  return {host,port,session,ownership,connectSelection};
}
