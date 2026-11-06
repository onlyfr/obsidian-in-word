import {nativeBodyBlock,type NativeBodySnapshot} from "./native-port";
import {inlineBodyCodec} from "./inline-codec";
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
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
  const doc=new DOMParser().parseFromString(candidate.xml,"application/xml");
  const child=(el:Element|undefined,name:string)=>Array.from(el?.children??[]).find(c=>c.namespaceURI===W && c.localName===name);
  const p=doc.getElementsByTagNameNS(W,"body")[0].getElementsByTagNameNS(W,"p")[0],pPr=child(p,"pPr");
  if(Array.from(pPr?.children??[]).some(el=>!["pStyle","rPr"].includes(el.localName)))throw new Error("직접 지정한 문단 배치 서식은 아직 등록하지 않습니다");
  const styles=new Map(Array.from(doc.getElementsByTagNameNS(W,"style")).map(el=>[el.getAttributeNS(W,"styleId"),el]));
  const properties=(id:string,seen=new Set<string>()):Element[]=>{
    if(!id)return [];if(seen.has(id))throw new Error("스타일 상속이 순환합니다");seen.add(id);
    const style=styles.get(id);if(!style)return [];const own=child(style,"rPr");
    return [...properties(child(style,"basedOn")?.getAttributeNS(W,"val")??"",seen),...(own?[own]:[])];
  };
  const defaultStyle=Array.from(styles.values()).find(s=>s.getAttributeNS(W,"type")==="paragraph" && s.getAttributeNS(W,"default")==="1")?.getAttributeNS(W,"styleId")??"Normal";
  const defaults=doc.getElementsByTagNameNS(W,"rPrDefault")[0];
  const base=new Map<string,string>();
  const signature=(el:Element)=>Array.from(el.attributes).filter(a=>a.namespaceURI!=="http://www.w3.org/2000/xmlns/").map(a=>`${a.namespaceURI}:${a.localName}=${a.value}`).sort().join("|");
  for(const props of [child(defaults,"rPr"),...properties(child(pPr,"pStyle")?.getAttributeNS(W,"val")??defaultStyle)])for(const el of Array.from(props?.children??[]))base.set(el.localName,signature(el));
  const validate=(props:Element)=>{
    for(const el of Array.from(props.children)){
      if(["b","i","strike","rStyle","lang","noProof"].includes(el.localName))continue;
      if(el.localName==="rFonts" && ["ascii","hAnsi"].every(n=>el.getAttributeNS(W,n)==="Consolas"))continue;
      if(["bCs","iCs"].includes(el.localName)){
        const other=child(props,el.localName==="bCs"?"b":"i");if(other && signature(other)===signature(el))continue;
      }
      if(base.get(el.localName)!==signature(el))throw new Error("이 run 서식은 아직 손실 없이 등록할 수 없습니다");
    }
  };
  const mark=child(pPr,"rPr");if(mark)validate(mark);
  for(const run of Array.from(p.getElementsByTagNameNS(W,"r"))){
    const own=child(run,"rPr");for(const props of properties(child(own,"rStyle")?.getAttributeNS(W,"val")??""))validate(props);if(own)validate(own);
  }
}
