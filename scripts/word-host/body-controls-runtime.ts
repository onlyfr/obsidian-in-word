import {installNativeBodyBridge,type NativeBodyBridge,type NativeBodyLink} from '../../src/body/native-bridge';
import {createNativeHarness} from './native-runtime';

/** Only the owned, authenticated acceptance-test entry installs this HTTP adapter. Never imported by the product task pane. */
export function installBodyControlHarness(token:string){
  const harness=createNativeHarness(token),leases:{closed:boolean;disconnect:()=>void}[]=[];
  const bridge:NativeBodyBridge={async open(){
    const metadata=await harness.connection();
    let stream:EventSource|undefined;
    const lease={closed:false,disconnect:()=>{}};leases.push(lease);
    const link:NativeBodyLink={...metadata,host:harness.host,
      subscribe(signal,disconnected){
        stream=new EventSource('/__test/ime');
        lease.disconnect=()=>disconnected(new Error('test transport closed'));
        stream.onmessage=event=>{try{signal(JSON.parse(event.data));}catch(error){disconnected(error);}};
        stream.onerror=()=>disconnected(new Error('native event stream disconnected'));
        return ()=>{stream?.close();};
      },
      close(){lease.closed=true;stream?.close();},
    };
    return link;
  }};
  const detach=installNativeBodyBridge(bridge);
  return {harness,bridge,leases,detach,disconnect(){leases.at(-1)?.disconnect();}};
}
