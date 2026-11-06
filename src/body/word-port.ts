/** Experimental Word adapter. Not imported by the production task pane. Native shells can replace this port. */
import { normalizeOoxml } from "../convert/sidecar";
import { SelectionMoved, type BodyBlock, type BodyJournal, type BodyPort } from "./session";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const BODY_NAMESPACE = "urn:obsidian-in-word:body-edit:v1";
const PREFIX = "owb-body:v1:";
const KEY = /^[a-zA-Z0-9-]{1,64}$/;
export const bodyTag = (key: string, mode: BodyBlock["mode"]) => {
  if (!KEY.test(key)) throw new Error("잘못된 본문 블록 ID");
  return `${PREFIX}${key}:${mode}`;
};

function parseTag(tag: string): {key: string; mode: BodyBlock["mode"]} | null {
  const match = /^owb-body:v1:([a-zA-Z0-9-]{1,64}):(rendered|source)$/.exec(tag);
  return match ? {key: match[1], mode: match[2] as BodyBlock["mode"]} : null;
}

function parseJournal(xml: string): BodyJournal {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (root.namespaceURI !== BODY_NAMESPACE || root.localName !== "bodyEdit") throw new Error("잘못된 본문 복구 기록");
  const data = JSON.parse(decodeURIComponent(root.textContent ?? "")) as BodyJournal;
  if (data.version !== 1 || typeof data.key !== "string" || !KEY.test(data.key) || !["opening", "editing", "closing", "closed"].includes(data.phase)
    || typeof data.originalMarkdown !== "string" || data.originalMarkdown.length > 4000
    || typeof data.originalStyle !== "string" || typeof data.originalRevision !== "string") throw new Error("손상된 본문 복구 기록");
  return data;
}

async function find(context: Word.RequestContext, key: string): Promise<Word.ContentControl | null> {
  if (!KEY.test(key)) throw new Error("잘못된 본문 블록 ID");
  const controls = context.document.contentControls;
  controls.load("items/tag");
  await context.sync();
  const matches = controls.items.filter(c => parseTag(c.tag)?.key === key);
  if (matches.length > 1) throw new Error("본문 블록 ID가 중복되어 자동 편집을 중단했습니다");
  return matches[0] ?? null;
}

async function read(context: Word.RequestContext, control: Word.ContentControl): Promise<BodyBlock> {
  control.load("text,tag");
  const range = control.getRange("Content");
  range.paragraphs.load("items/style,items/tableNestingLevel,items/isListItem");
  const html = range.getHtml(); const xml = range.getOoxml();
  await context.sync();
  const parsed = parseTag(control.tag);
  if (!parsed) throw new Error("본문 블록 표지가 바뀌었습니다");
  if (range.paragraphs.items.length !== 1 || range.paragraphs.items[0].tableNestingLevel || range.paragraphs.items[0].isListItem)
    throw new Error("일반 문단 한 개만 실험할 수 있습니다");
  const doc = new DOMParser().parseFromString(xml.value, "application/xml");
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("본문 문단 원본을 읽을 수 없습니다");
  const forbidden = new Set(["tbl", "drawing", "pict", "object", "fldChar", "fldSimple", "footnoteReference", "endnoteReference", "ins", "del", "commentRangeStart"]);
  if (Array.from(body.querySelectorAll("*")).some(el => forbidden.has(el.localName) || el.namespaceURI === "http://schemas.openxmlformats.org/officeDocument/2006/math"))
    throw new Error("객체·필드·변경 추적이 있는 문단은 아직 실험 대상이 아닙니다");
  return {
    ...parsed, text: control.text.replace(/\r$/, ""), html: html.value, style: range.paragraphs.items[0].style,
    revision: normalizeOoxml(new XMLSerializer().serializeToString(body)),
  };
}

export class WordBodyPort implements BodyPort {
  async read(key: string): Promise<BodyBlock | null> {
    return Word.run(async context => { const control = await find(context, key); return control ? read(context, control) : null; });
  }

  async journals(): Promise<BodyJournal[]> {
    return Word.run(async context => {
      const parts = context.document.customXmlParts.getByNamespace(BODY_NAMESPACE); parts.load("items"); await context.sync();
      const xml = parts.items.map(p => p.getXml()); await context.sync();
      const records = xml.map(x => parseJournal(x.value));
      if (new Set(records.map(r => r.key)).size !== records.length) throw new Error("복구 기록의 ID가 중복되었습니다");
      return records;
    });
  }

  async save(journal: BodyJournal): Promise<void> {
    const xml = `<bodyEdit xmlns="${BODY_NAMESPACE}">${encodeURIComponent(JSON.stringify(journal))}</bodyEdit>`;
    parseJournal(xml);
    return Word.run(async context => {
      const parts = context.document.customXmlParts.getByNamespace(BODY_NAMESPACE); parts.load("items"); await context.sync();
      const old = parts.items.map(part => ({part, xml: part.getXml()})); await context.sync();
      const matches = old.filter(p => parseJournal(p.xml.value).key === journal.key);
      if (matches.length > 1) throw new Error("복구 기록의 ID가 중복되었습니다");
      if (matches[0]?.xml.value === xml) return;
      if (matches[0]) matches[0].part.setXml(xml);
      else context.document.customXmlParts.add(xml);
      await context.sync();
    });
  }

  async source(expected: BodyBlock, markdown: string): Promise<void> {
    return this.mutate(expected, async (context, control) => {
      const location = control.getRange("Content").compareLocationWith(context.document.getSelection()); await context.sync();
      if (!["Contains", "ContainsStart", "ContainsEnd", "Equal"].includes(location.value)) throw new SelectionMoved("커서가 다른 문단으로 이동했습니다");
      control.insertText(markdown, "Replace");
      control.tag = bodyTag(expected.key, "source");
      control.getRange("Content").getRange("End").select();
      await context.sync();
    });
  }

  async render(expected: BodyBlock, html: string, style: string): Promise<void> {
    return this.mutate(expected, async (context, control) => {
      const selected = context.document.getSelection(); context.trackedObjects.add(selected);
      try {
        control.insertHtml(html, "Replace");
        control.tag = bodyTag(expected.key, "rendered");
        control.getRange("Content").paragraphs.getFirst().style = style;
        await context.sync();
        selected.select(); await context.sync();
      } finally { selected.untrack(); }
    });
  }

  private async mutate(expected: BodyBlock, op: (c: Word.RequestContext, cc: Word.ContentControl) => Promise<void>): Promise<void> {
    return Word.run(async context => {
      const control = await find(context, expected.key);
      if (!control) throw new Error("편집 문단이 삭제되었습니다");
      const current = await read(context, control);
      if (current.revision !== expected.revision || current.mode !== expected.mode) throw new Error("문단이 다른 작업으로 바뀌어 덮어쓰기를 중단했습니다");
      await op(context, control); // Never retry a partially executed host batch.
    });
  }
}
