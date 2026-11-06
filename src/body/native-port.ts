import {normalizeOoxml} from "../convert/sidecar";
import {inlineToRuns} from "../convert/tables";
import {wrapPackage} from "../convert/equations";
import {inlineBodyCodec} from "./inline-codec";
import {sourceCaret} from "./caret-map";
import {SelectionMoved, type BodyBlock, type BodyCommit, type BodyJournal, type BodyPort} from "./session";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const NATIVE_BODY_NAMESPACE = "urn:obsidian-in-word:body-edit:v1";
const escape = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

export interface NativeBodySnapshot {
  key: string; epoch: string; mode: "source" | "rendered"; id: string; text: string; style: string; xml: string;
  start: number; selectionStart: number; selectionEnd: number;
}
export interface NativeTransition {
  expected: NativeBodySnapshot;
  mode: "source" | "rendered" | "journal";
  text: string; xml: string; style: string;
  caretStart: number; caretEnd: number;
  pending: string; complete: string;
}
export interface NativeBodyHost {
  read(key: string): Promise<NativeBodySnapshot | null>;
  journals(): Promise<BodyJournal[]>;
  transition(change: NativeTransition): Promise<{code: number}>;
}

/** Narrow native format reader. Refuse runs/objects this phase cannot reproduce. No Office.js dependency. */
export function nativeBodyBlock(snapshot: NativeBodySnapshot): BodyBlock {
  const doc = new DOMParser().parseFromString(snapshot.xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("본문 OOXML을 읽을 수 없습니다");
  const body = doc.getElementsByTagNameNS(W,"body")[0];
  const paragraphs = body?.getElementsByTagNameNS(W,"p");
  if (!paragraphs || paragraphs.length !== 1) throw new Error("네이티브 편집은 일반 문단 한 개만 지원합니다");
  const p = paragraphs[0]; let html = "", visible = "";
  const forbidden = new Set(["tbl","drawing","pict","object","fldChar","fldSimple","footnoteReference","endnoteReference","ins","del","commentRangeStart","numPr"]);
  if (Array.from(body.querySelectorAll("*")).some(el => forbidden.has(el.localName) || el.namespaceURI === "http://schemas.openxmlformats.org/officeDocument/2006/math"))
    throw new Error("목록·객체·필드·변경 추적은 네이티브 편집 실험 대상이 아닙니다");
  const child = (el: Element | undefined, name: string) => Array.from(el?.children ?? []).find(c => c.namespaceURI === W && c.localName === name);
  const styles = new Map(Array.from(doc.getElementsByTagNameNS(W,"style")).map(el => [el.getAttributeNS(W,"styleId"),el]));
  const styleProperties = (id: string, seen = new Set<string>()): Element[] => {
    if (!id) return [];
    if (seen.has(id)) throw new Error("문단 스타일 상속이 순환합니다");
    seen.add(id);
    const style = styles.get(id); if (!style) return [];
    const base = child(style,"basedOn")?.getAttributeNS(W,"val") ?? "";
    const properties = child(style,"rPr");
    return [...styleProperties(base,seen),...(properties ? [properties] : [])];
  };
  const defaultStyle=Array.from(styles.values()).find(s=>s.getAttributeNS(W,"type")==="paragraph" && s.getAttributeNS(W,"default")==="1")?.getAttributeNS(W,"styleId") ?? "Normal";
  const paragraphProperties = styleProperties(child(child(p,"pPr"),"pStyle")?.getAttributeNS(W,"val") ?? defaultStyle);
  const on = (properties: Element[], name: string) => {
    let value = false;
    for (const props of properties) {const el = child(props,name); if (el) value = !["0","false","off"].includes(el.getAttributeNS(W,"val") ?? "");}
    return value;
  };
  for (const runNode of Array.from(p.children)) {
    if (runNode.namespaceURI !== W) throw new Error("지원하지 않는 본문 객체입니다");
    if (["pPr","proofErr"].includes(runNode.localName)) continue;
    if (runNode.localName !== "r") throw new Error("필드·책갈피·객체가 있는 문단은 아직 편집하지 않습니다");
    const own = child(runNode,"rPr");
    if (snapshot.mode !== "source" && own && Array.from(own.children).some(p => ["u","vertAlign","dstrike","highlight","shd","vanish"].includes(p.localName)))
      throw new Error("이 run의 서식은 네이티브 편집 실험에서 아직 보존하지 못합니다");
    const props = [...paragraphProperties,...styleProperties(child(own,"rStyle")?.getAttributeNS(W,"val") ?? ""),...(own ? [own] : [])];
    let text = "";
    for (const part of Array.from(runNode.children)) {
      if (part.localName === "rPr") continue;
      if (snapshot.mode === "source" && part.namespaceURI === W && ["tab","br"].includes(part.localName)) {text += part.localName === "tab" ? "\t" : "\v"; continue;}
      if (part.namespaceURI !== W || part.localName !== "t") throw new Error("여러 줄·특수 run은 아직 편집하지 않습니다");
      text += part.textContent ?? "";
    }
    visible += text;
    let run = escape(text);
    const fonts = props.map(p => child(p,"rFonts")).filter(p => !!p).at(-1);
    if (fonts?.getAttributeNS(W,"ascii") === "Consolas") run = `<code>${run}</code>`;
    if (on(props,"strike")) run = `<s>${run}</s>`;
    if (on(props,"i")) run = `<em>${run}</em>`;
    if (on(props,"b")) run = `<strong>${run}</strong>`;
    html += run;
  }
  if (visible !== snapshot.text) throw new Error("네이티브 문단 스냅샷의 텍스트가 일치하지 않습니다");
  const key = snapshot.key;
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(key) || !["source","rendered"].includes(snapshot.mode)) throw new Error("잘못된 네이티브 블록 ID/모드");
  return {key,mode:snapshot.mode,text:visible,html:`<p>${html}</p>`,style:snapshot.style,
    revision:normalizeOoxml(new XMLSerializer().serializeToString(body))};
}

export function nativeParagraph(markdown: string): string {
  if (/[\0\t\v\f]/.test(markdown)) throw new Error("네이티브 문단 전환에는 탭/제어 문자를 사용할 수 없습니다");
  const html = inlineBodyCodec.html(markdown);
  if (new DOMParser().parseFromString(html,"text/html").querySelector("a,br")) throw new Error("네이티브 단계에서는 링크·줄바꿈을 아직 편집하지 않습니다");
  return wrapPackage(`<w:p>${inlineToRuns(markdown,"",false,{htmlBreaks:false})}</w:p>`);
}
function journalXml(journal: BodyJournal, stage?: string): string {
  const {nativeStage: _stage, ...data} = journal;
  return `<bodyEdit xmlns="${NATIVE_BODY_NAMESPACE}" key="${journal.key}">${encodeURIComponent(JSON.stringify(stage ? {...data,nativeStage:stage} : data))}</bodyEdit>`;
}

/** Native transition port; the host transport is supplied by the shell, not tied to HTTP/npm/Office.js. */
export class NativeBodyPort implements BodyPort {
  private snapshots = new WeakMap<BodyBlock,NativeBodySnapshot>();
  constructor(private host: NativeBodyHost) {}
  async read(key: string): Promise<BodyBlock | null> {
    const snapshot = await this.host.read(key); if (!snapshot) return null;
    if (snapshot.key !== key) throw new Error("호스트가 다른 문단을 반환했습니다");
    const block = nativeBodyBlock(snapshot); this.snapshots.set(block,{...snapshot}); return block;
  }
  journals(): Promise<BodyJournal[]> { return this.host.journals(); }
  async save(journal: BodyJournal): Promise<void> {
    const block = await this.read(journal.key); if (!block) throw new Error("복구 문단이 삭제되었습니다");
    const expected = this.snapshot(block);
    await this.execute({expected,mode:"journal",text:expected.text,xml:"",style:expected.style,caretStart:0,caretEnd:0,pending:journalXml(journal),complete:journalXml(journal)});
  }
  source(): Promise<void> { return Promise.reject(new Error("네이티브 포트는 복구 기록과 함께 commit해야 합니다")); }
  render(): Promise<void> { return Promise.reject(new Error("네이티브 포트는 복구 기록과 함께 commit해야 합니다")); }
  async commit(block: BodyBlock, change: BodyCommit): Promise<void> {
    const expected = this.snapshot(block);
    if (change.journal.key !== block.key) throw new Error("복구 기록의 문단 ID가 다릅니다");
    const xml = nativeParagraph(change.markdown);
    let from = 0, to = 0;
    if (change.mode === "source") {
      if (expected.selectionStart < expected.start || expected.selectionEnd > expected.start + block.text.length) throw new SelectionMoved("커서가 다른 문단으로 이동했습니다");
      from = sourceCaret(change.markdown,block.text,expected.selectionStart-expected.start);
      to = sourceCaret(change.markdown,block.text,expected.selectionEnd-expected.start);
    }
    const complete = {...change.journal,phase:change.mode === "source" ? "editing" as const : "closed" as const};
    await this.execute({expected,mode:change.mode,text:change.markdown,xml,style:change.style,caretStart:from,caretEnd:to,
      pending:journalXml(change.journal,"prepared"),complete:journalXml(complete)});
  }
  private snapshot(block: BodyBlock): NativeBodySnapshot {
    const snapshot = this.snapshots.get(block); if (!snapshot) throw new Error("이 포트에서 새로 읽은 문단 스냅샷이 필요합니다");
    if (nativeBodyBlock(snapshot).revision !== block.revision || snapshot.mode !== block.mode || snapshot.key !== block.key || snapshot.text !== block.text || snapshot.style !== block.style) throw new Error("문단 스냅샷이 변경됐습니다");
    return snapshot;
  }
  private async execute(change: NativeTransition): Promise<void> {
    const {code} = await this.host.transition(change);
    if (code === 10) throw new SelectionMoved("커서가 다른 위치로 이동했습니다");
    if (code !== 0) throw new Error(`네이티브 본문 전환 실패 (${code}). 자동 재시도 없이 복구 기록을 확인하세요`);
  }
}
