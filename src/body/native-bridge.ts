import type {NativeBodyHost} from './native-port';
import type {NativeOwnershipHost} from './native-ownership';

export interface NativeBodyLink {
  epoch:string;
  capabilities:{ownership:boolean;selection:boolean};
  host:NativeBodyHost & NativeOwnershipHost;
  /** A fresh snapshot must be delivered before ordered live frames. No document text is carried by signals. */
  subscribe(signal:(frame:unknown)=>void,disconnected:(error?:unknown)=>void):()=>void;
  /** Release this lease; do not terminate Word or a shared native observer. */
  close():void|Promise<void>;
}
/** Supplied by a trusted native shell. Calls need finite transport deadlines and must not replay unknown outcomes.
 * This interface has no HTTP/Office.js/localhost discovery. */
export interface NativeBodyBridge {open():Promise<NativeBodyLink>;}

let bridge:NativeBodyBridge|null=null;
const listeners=new Set<(value:NativeBodyBridge|null)=>void>();
export function observeNativeBodyBridge(listener:(value:NativeBodyBridge|null)=>void):()=>void{
  listeners.add(listener);listener(bridge);return ()=>listeners.delete(listener);
}
/** Called explicitly by the embedding shell, never from document data or a URL parameter. */
export function installNativeBodyBridge(value:NativeBodyBridge):()=>void{
  if(bridge)throw new Error('본문 연결이 이미 등록되어 있습니다');
  bridge=value;for(const listener of listeners)listener(bridge);
  return ()=>{if(bridge!==value)return;bridge=null;for(const listener of listeners)listener(null);};
}
