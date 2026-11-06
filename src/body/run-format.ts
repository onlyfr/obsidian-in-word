const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const fontKeys=["ascii","hAnsi","eastAsia","cs"] as const;
export interface RunAppearance {ascii?:string;hAnsi?:string;eastAsia?:string;cs?:string;size?:number;sizeCs?:number;color?:string;}
export interface NativeRunFormat {version:1;text:string;paragraph?:RunAppearance;spans:{text:string;format:RunAppearance}[];}
const child=(el:Element|undefined,name:string)=>Array.from(el?.children??[]).find(c=>c.namespaceURI===W && c.localName===name);
const value=(el:Element,name="val")=>el.getAttributeNS(W,name)??"";
const fontName=(name:unknown):name is string=>typeof name==="string" && name.length>0 && name.length<=128 && !/[\x00-\x1f]/.test(name);
const halfPoints=(size:unknown):size is number=>Number.isInteger(size) && (size as number)>=1 && (size as number)<=3276;
const colorValue=(color:unknown):color is string=>typeof color==="string" && /^(?:auto|[0-9a-fA-F]{6})$/.test(color);
const attrs=(el:Element)=>Array.from(el.attributes).filter(a=>a.namespaceURI!=="http://www.w3.org/2000/xmlns/");

/** Only concrete typography is assignable through this native renderer; theme overrides stay unsupported. */
function supportedAppearanceProperty(el:Element):boolean{
  if(el.namespaceURI!==W)return false;
  if(el.localName==="rFonts")return attrs(el).length>0 && attrs(el).every(a=>a.namespaceURI===W && fontKeys.includes(a.localName as typeof fontKeys[number]) && fontName(a.value));
  if(["sz","szCs"].includes(el.localName))return attrs(el).length===1 && attrs(el)[0].namespaceURI===W && attrs(el)[0].localName==="val" && /^\d+$/.test(value(el)) && halfPoints(Number(value(el)));
  return el.localName==="color" && attrs(el).length===1 && attrs(el)[0].namespaceURI===W && attrs(el)[0].localName==="val" && colorValue(value(el));
}
function assertRunFormatSupport(doc:Document):void{
  const p=doc.getElementsByTagNameNS(W,"body")[0]?.getElementsByTagNameNS(W,"p")[0];
  if(!p)throw new Error("일반 문단의 원본 run 서식이 필요합니다");
  const pPr=child(p,"pPr");
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
      if(supportedAppearanceProperty(el))continue;
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
function readProperties(props:Element|undefined,format:RunAppearance):void{
  for(const el of Array.from(props?.children??[])){
    if(!supportedAppearanceProperty(el))continue;
    if(el.localName==="rFonts")for(const key of fontKeys){const name=value(el,key);if(name)format[key]=name;}
    if(el.localName==="sz")format.size=Number(value(el));
    if(el.localName==="szCs")format.sizeCs=Number(value(el));
    if(el.localName==="color")format.color=value(el).toUpperCase()==="AUTO"?"auto":value(el).toUpperCase();
  }
}
export function captureRunFormat(xml:string,text:string):NativeRunFormat{
  const doc=new DOMParser().parseFromString(xml,"application/xml");
  if(doc.querySelector("parsererror"))throw new Error("원본 run 서식을 읽을 수 없습니다");
  assertRunFormatSupport(doc);
  const styles=new Map(Array.from(doc.getElementsByTagNameNS(W,"style")).map(el=>[el.getAttributeNS(W,"styleId"),el]));
  const inherit=(id:string,seen=new Set<string>()):Element[]=>{
    if(!id)return [];if(seen.has(id))throw new Error("스타일 상속이 순환합니다");seen.add(id);
    const style=styles.get(id),props=child(style,"rPr");
    return [...inherit(child(style,"basedOn")?.getAttributeNS(W,"val")??"",seen),...(props?[props]:[])];
  };
  const body=doc.getElementsByTagNameNS(W,"body")[0];
  const spans=Array.from(body?.getElementsByTagNameNS(W,"r")??[]).map(run=>{
    const own=child(run,"rPr"),format:RunAppearance={};
    for(const props of [...inherit(child(own,"rStyle")?.getAttributeNS(W,"val")??""),...(own?[own]:[])])readProperties(props,format);
    // Consolas is the existing Markdown code marker; removing backticks must remove that semantic font.
    if(format.ascii==="Consolas")for(const key of fontKeys)if(format[key]==="Consolas")delete format[key];
    return {text:Array.from(run.getElementsByTagNameNS(W,"t")).map(el=>el.textContent??"").join(""),format};
  }).filter(span=>span.text.length>0);
  const paragraph:RunAppearance={};readProperties(child(child(body?.getElementsByTagNameNS(W,"p")[0],"pPr"),"rPr"),paragraph);
  const result:NativeRunFormat={version:1,text,paragraph,spans};validateRunFormat(result);return result;
}
function validateRunFormat(data:NativeRunFormat):void{
  if(!data || data.version!==1 || typeof data.text!=="string" || data.text.length>4000 || !Array.isArray(data.spans) || data.spans.length>4000)throw new Error("잘못된 원본 run 기록입니다");
  for(const span of [...data.spans,...(data.paragraph?[{text:"",format:data.paragraph}]:[])]){
    if(!span || typeof span.text!=="string" || !span.format || typeof span.format!=="object" || Array.isArray(span.format))throw new Error("잘못된 run 서식입니다");
    for(const [key,val] of Object.entries(span.format)){
      if(fontKeys.includes(key as typeof fontKeys[number])? !fontName(val) : ["size","sizeCs"].includes(key)? !halfPoints(val) : key==="color"? !colorValue(val) : true)throw new Error("지원하지 않는 run 서식 기록입니다");
    }
  }
  if(data.spans.map(s=>s.text).join("")!==data.text)throw new Error("원본 텍스트와 run 서식 기록이 다릅니다");
}
const signature=(format:RunAppearance)=>JSON.stringify([...fontKeys,"size","sizeCs","color"].map(k=>format[k as keyof RunAppearance]??null));

/** One contiguous text replacement has an unambiguous appearance only within one original appearance. */
function mapAppearance(data:NativeRunFormat,text:string):RunAppearance[]{
  validateRunFormat(data);
  const old=Array.from(data.text),fresh=Array.from(text),formats:RunAppearance[]=[];
  for(const span of data.spans)for(const _char of Array.from(span.text))formats.push(span.format);
  let prefix=0,suffix=0;
  while(prefix<old.length && prefix<fresh.length && old[prefix]===fresh[prefix])prefix++;
  while(suffix<old.length-prefix && suffix<fresh.length-prefix && old[old.length-1-suffix]===fresh[fresh.length-1-suffix])suffix++;
  const inserted=fresh.length-prefix-suffix,removed=old.length-prefix-suffix;
  let middle:RunAppearance={};
  if(inserted){
    const candidates=removed?formats.slice(prefix,old.length-suffix):[formats[prefix-1],formats[prefix]].filter((f):f is RunAppearance=>!!f);
    middle=candidates[0]??{};
    if(candidates.some(f=>signature(f)!==signature(middle)))throw new Error("여러 원본 서식에 걸친 편집의 서식을 결정할 수 없습니다. 소스를 보존하고 자동 전환을 멈춥니다");
  }
  return [...formats.slice(0,prefix),...Array.from({length:inserted},()=>middle),...(suffix?formats.slice(old.length-suffix):[])];
}
export function applyRunFormat(xml:string,data:NativeRunFormat|undefined):string{
  if(!data)return xml;
  const doc=new DOMParser().parseFromString(xml,"application/xml"),runs=Array.from(doc.getElementsByTagNameNS(W,"r"));
  const text=runs.map(r=>Array.from(r.getElementsByTagNameNS(W,"t")).map(t=>t.textContent??"").join("")).join("");
  const formats=mapAppearance(data,text);let at=0;
  const element=(name:string,attributes:Record<string,string>)=>{const el=doc.createElementNS(W,`w:${name}`);for(const [key,val] of Object.entries(attributes))el.setAttributeNS(W,`w:${key}`,val);return el;};
  const appendAppearance=(props:Element,format:RunAppearance)=>{
    if(!child(props,"rFonts")){
      const names:Record<string,string>={};for(const key of fontKeys)if(format[key])names[key]=format[key]!;
      if(Object.keys(names).length)props.append(element("rFonts",names));
    }
    if(format.size!==undefined)props.append(element("sz",{val:String(format.size)}));
    if(format.sizeCs!==undefined)props.append(element("szCs",{val:String(format.sizeCs)}));
    if(format.color!==undefined)props.append(element("color",{val:format.color}));
  };
  if(data.paragraph && Object.keys(data.paragraph).length){
    const p=doc.getElementsByTagNameNS(W,"p")[0],pPr=element("pPr",{}),rPr=element("rPr",{});
    appendAppearance(rPr,data.paragraph);pPr.append(rPr);p.prepend(pPr);
  }
  for(const run of runs){
    const chars=Array.from(Array.from(run.getElementsByTagNameNS(W,"t")).map(t=>t.textContent??"").join(""));
    for(let start=0;start<chars.length;){
      const format=formats[at]??{};let end=start+1;
      while(end<chars.length && signature(formats[at+end-start]??{})===signature(format))end++;
      const replacement=run.cloneNode(true) as Element;
      for(const el of Array.from(replacement.children))if(el.localName==="t")el.remove();
      let props=child(replacement,"rPr");if(!props){props=element("rPr",{});replacement.prepend(props);}
      appendAppearance(props,format);
      const t=element("t",{});t.setAttributeNS("http://www.w3.org/XML/1998/namespace","xml:space","preserve");t.textContent=chars.slice(start,end).join("");replacement.append(t);
      run.before(replacement);at+=end-start;start=end;
    }
    run.remove();
  }
  return new XMLSerializer().serializeToString(doc);
}
