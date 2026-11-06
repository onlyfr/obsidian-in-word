import {nativeBodyBlock,type NativeBodySnapshot} from "./native-port";
import {inlineBodyCodec} from "./inline-codec";
import {captureRunFormat} from "./run-format";
export interface NativeOwnershipHost {
  selectedKey():Promise<string|null>;
  candidate():Promise<NativeBodySnapshot>;
  claim(candidate:NativeBodySnapshot,key:string):Promise<{code:number}>;
}

/** Explicit enrollment only. Selection notifications never claim a paragraph or adopt someone else's control. */
export class NativeBodyOwnership {
  constructor(private host:NativeOwnershipHost){}
  async claimSelected(key:string=crypto.randomUUID()):Promise<string>{
    if(!/^[a-zA-Z0-9-]{1,64}$/.test(key))throw new Error("잘못된 블록 ID");
    const existing=await this.host.selectedKey();if(existing)return existing;
    const candidate=await this.host.candidate();
    validateNativeCandidate(candidate);
    const {code}=await this.host.claim(candidate,key);
    if(code!==0)throw new Error(`네이티브 블록 등록 실패 (${code}). 자동 재등록하지 않습니다`);
    const registered=await this.host.selectedKey();
    if(registered!==key)throw new Error("등록 후 소유권을 확인할 수 없습니다. 자동 전환을 멈춥니다");
    return key;
  }
}

/** Refuse visible direct formatting that this native renderer cannot preserve, before adding a control. */
export function validateNativeCandidate(candidate:NativeBodySnapshot):void{
  if(candidate.id || candidate.mode!=="rendered" || !candidate.text || candidate.text.length>4000)throw new Error("등록할 수 없는 일반 문단입니다");
  const block=nativeBodyBlock(candidate);inlineBodyCodec.html(inlineBodyCodec.markdown(block.html));
  captureRunFormat(candidate.xml,candidate.text);
}
