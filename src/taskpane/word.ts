import { plainParagraphEdit, plainWordContent } from "./paragraph-edit";
import { leftoverChecks } from "./markers";
import type { MathOutputMode } from "../convert/mathimg";
import {documentFontName,selectionMathAppearance,type MathAppearance,type MathAppearanceSource} from '../convert/math-appearance';
import { trailingBlankParagraphs } from "../convert/trailing-blanks";
import { hashId, normText, placeholderIds, type FloatBlock, type FloatReport } from "../convert/blocks";
import {
  BLANK_TOKEN,
  findFloatingBlocks,
  htmlToMarkdown,
  renderWithSidecar,
  styleHintsFromParagraphs,
  type MathReport,
  type TableReport,
} from "../convert/obsidian";
import { equationPackage, mathIds, mathImgIds, scanOoxml, wrapPackage } from "../convert/equations";
import { TABLE_MARKER_RE, countTables, scanTables, tableRelationships } from "../convert/tables";

/** Sidecar ids of the markdown tables (`<!-- word:table id=... -->`). */
const tableIds = (markdown: string) =>
  new Set(markdown.split("\n").map((l) => TABLE_MARKER_RE.exec(l)?.[1]).filter((x): x is string => !!x));
import {
  MemorySidecar,
  SIDECAR_NAMESPACE,
  retainSidecar,
  keepEquivalentEntries,
  sidecarFromXml,
  sidecarToXml,
  type Sidecar,
} from "../convert/sidecar";

interface LoadedSidecar {
  sidecar: Sidecar;
  /** Our own serialization right after loading, to detect whether anything changed before saving. */
  before: string;
  /** Number of stored parts: more than one is consolidated on the next save. */
  parts: number;
}

/** Load the sidecar stored inside the document (Custom XML Part). Empty if none exists yet. */
async function loadSidecar(context: Word.RequestContext): Promise<LoadedSidecar> {
  const sidecar = new MemorySidecar();
  const parts = context.document.customXmlParts.getByNamespace(SIDECAR_NAMESPACE);
  parts.load("items");
  await context.sync();
  const xmls = parts.items.map((p) => p.getXml());
  await context.sync();
  for (const x of xmls) sidecarFromXml(x.value, sidecar);
  return { sidecar, before: sidecarToXml(sidecar), parts: parts.items.length };
}

/**
 * Replace the stored sidecar with `sidecar` (delete old part(s), add a fresh one). Skipped when nothing changed:
 * rewriting a part with embedded pictures/OOXML is expensive and dirties the document for no reason.
 */
async function saveSidecar(
  context: Word.RequestContext,
  sidecar: Sidecar,
  loaded: LoadedSidecar,
  /** Ids referenced by the markdown being loaded/applied: always retained and marked as recently used. */
  keep: Set<string>,
): Promise<void> {
  // The sidecar belongs to the whole document, not to the selection: never drop what other regions may still need
  // (see retainSidecar). Neither age nor size proves that an original is unused.
  let xml = sidecarToXml(retainSidecar(sidecar, keep));
  if (xml !== loaded.before) {
    // Word gives the same table/float new rsids on every getOoxml: entries equal up to those keep the stored version.
    const merged = await keepEquivalentEntries(sidecar, sidecarFromXml(loaded.before), ungz);
    xml = sidecarToXml(retainSidecar(merged, keep));
  }
  if (xml === loaded.before && loaded.parts <= 1) return;
  const parts = context.document.customXmlParts.getByNamespace(SIDECAR_NAMESPACE);
  parts.load("items");
  await context.sync();
  parts.items.forEach((p) => p.delete());
  context.document.customXmlParts.add(xml);
  await context.sync();
}

/** gzip + base64 (prefixed "gz:"): a paragraph's OOXML package is ~50 KB, mostly styles/theme. */
async function gz(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return "gz:" + btoa(bin);
}

async function ungz(data: string): Promise<string> {
  if (!data.startsWith("gz:")) return data;
  const bin = atob(data.slice(3));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/**
 * Lossless OOXML for blocks containing floating pictures/shapes/text boxes (getHtml can only render them as
 * flat images). Paragraphs are matched to Office.js paragraphs by text in document order; tables by index.
 */
async function captureFloatOoxml(
  context: Word.RequestContext,
  selection: Word.Range,
  blocks: FloatBlock[],
): Promise<(string | undefined)[]> {
  const paras = selection.paragraphs.items;
  let tops: Word.Table[] = [];
  if (blocks.some((b) => b.tag === "table")) {
    selection.tables.load("items/nestingLevel");
    await context.sync();
    tops = selection.tables.items.filter((t) => t.nestingLevel === 1);
  }
  let last = -1;
  const reqs = blocks.map((b) => {
    if (b.tag === "table") return tops[b.tableIndex]?.getRange("Whole").getOoxml();
    let idx = -1;
    for (let i = last + 1; i < paras.length; i++) {
      if (normText(paras[i].text) === b.text) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return undefined;
    last = idx;
    return paras[idx].getOoxml();
  });
  try {
    await context.sync();
  } catch {
    return blocks.map(() => undefined);
  }
  return Promise.all(reqs.map((r) => (r?.value ? gz(r.value) : undefined)));
}

export interface ReadResult {
  markdown: string;
  /** Messages to show next to the status (floating-object preservation, warnings). */
  notes: string[];
}

interface ParagraphBaseline {
  markdown: string;
  paragraphs: {id: string; text: string}[];
}
let paragraphBaseline: ParagraphBaseline | undefined;

/** Read the current selection from Word as Obsidian-flavored markdown. */
export async function readSelectionAsMarkdown(acceptResult: () => boolean = () => true): Promise<ReadResult> {
  const result = await Word.run(async (context) => {
    const loaded = await loadSidecar(context);
    const sidecar = loaded.sidecar;
    const selection = context.document.getSelection();
    const html = selection.getHtml();

    const supportsIds = Office.context.requirements.isSetSupported("WordApi", "1.6");
    selection.paragraphs.load("items/text,items/style,items/tableNestingLevel" + (supportsIds ? ",items/uniqueLocalId" : ""));
    selection.inlinePictures.load("items");
    const selOoxml = selection.getOoxml();
    await context.sync();
    // getHtml renders equations as bare images; their OMML comes from the OOXML (paired with the images by order).
    const scan = scanOoxml(selOoxml.value);
    const paragraphPackages=new Map<string,Promise<string>>();
    await Promise.all(scan.items.map(async it=>{
      if(it.kind!=='eq' || !it.paraXml)return;
      let pkg=paragraphPackages.get(it.paraXml);
      if(!pkg){pkg=gz(wrapPackage(it.paraXml));paragraphPackages.set(it.paraXml,pkg);}
      it.paraPkg=await pkg;
    }));
    // getHtml references images by a temp file that is gone later; keep the real bytes in the sidecar instead.
    const pictures = selection.inlinePictures.items.map((p) => p.getBase64ImageSrc());
    // Empty text can still be a picture-only paragraph. Load just the empty tail's picture collections in the same
    // batch so phantom-blank correction does not mistake a display math picture for a spacing paragraph.
    const trailing: Word.Paragraph[] = [];
    const paragraphs = selection.paragraphs.items;
    for (let i = paragraphs.length - 1; i >= 0 && paragraphs[i].tableNestingLevel === 0 && !paragraphs[i].text.trim(); i--) {
      trailing.push(paragraphs[i]);
      paragraphs[i].inlinePictures.load("items");
    }
    await context.sync();
    const floatOoxml = await captureFloatOoxml(context, selection, findFloatingBlocks(html.value));
    // getHtml has no real names for built-in styles (Quote, ...); ask Office.js for the localized names.
    const hints = styleHintsFromParagraphs(
      html.value,
      selection.paragraphs.items.map((p) => ({ text: p.text, style: p.style })),
    );
    const report: FloatReport = { total: 0, preserved: 0 };
    const mathReport: MathReport = { total: 0, latex: 0, opaque: 0, unpaired: 0 };
    const tableReport: TableReport = { total: 0, simple: 0, opaque: 0, unpaired: 0, reasons: {} };
    const tableRaw=scanTables(selOoxml.value);
    const mathCounts=tableRaw.map(raw=>{const found=scanOoxml(raw);return found.equations+found.mathImages;});
    let tablePackages:(OfficeExtension.ClientResult<string>|undefined)[]=[];
    if(mathCounts.some(Boolean)){
      selection.tables.load('items/nestingLevel');await context.sync();
      const tops=selection.tables.items.filter(table=>table.nestingLevel===1);
      if(tops.length===tableRaw.length){
        const bounds=tops.map(table=>({start:selection.getRange('Start').compareLocationWith(table.getRange('Whole').getRange('Start')),
          end:selection.getRange('End').compareLocationWith(table.getRange('Whole').getRange('End'))}));
        await context.sync();
        // A cell/picture selection must never acquire and later insert its entire surrounding table.
        tablePackages=tops.map((table,index)=>mathCounts[index] && ['Before','Equal'].includes(bounds[index].start.value) && ['After','Equal'].includes(bounds[index].end.value)?table.getRange('Whole').getOoxml():undefined);
        await context.sync();
      }
    }
    const relationships = tableRelationships(tableRaw,selOoxml.value);
    const tableCaps = await Promise.all(tableRaw.map(async(raw,index) => ({raw,gz:await gz(raw),rels:relationships[index],
      ...(tablePackages[index]?.value?{pkg:await gz(tablePackages[index]!.value),mathCount:mathCounts[index]}:{})})));
    const markdown = htmlToMarkdown(
      html.value, sidecar, hints, pictures.map((p) => p.value), floatOoxml, report, scan.items, mathReport, tableCaps, tableReport,
      trailingBlankParagraphs(trailing.reverse().map(p => ({ text: p.text, tableNestingLevel: p.tableNestingLevel, hasInlinePictures: p.inlinePictures.items.length > 0 }))),
    );
    // Objects referenced by the markdown just produced are marked as used; other regions' entries are left alone.
    const keep = new Set([...placeholderIds(markdown), ...mathIds(markdown), ...mathImgIds(markdown), ...tableIds(markdown)]);
    await saveSidecar(context, sidecar, loaded, keep);
    const notes: string[] = [];
    if (report.total) notes.push(`부동 개체 ${report.preserved}/${report.total}개 보존`);
    if (report.preserved < report.total)
      notes.push(`경고: 부동 개체 ${report.total - report.preserved}개는 보존할 수 없어 적용 시 중단됩니다`);
    if (mathReport.total)
      notes.push(`수식 ${mathReport.latex}/${mathReport.total}개 LaTeX로 표시` + (mathReport.opaque ? `, ${mathReport.opaque}개는 원본 보존` : ""));
    if (mathReport.images) notes.push(`수식 그림 ${mathReport.images}개를 LaTeX로 표시`);
    if(mathReport.preserved)notes.push(`표·보존 개체 안 수식 ${mathReport.preserved}개는 개체 전체 원본으로 보존됩니다`);
    if (tableReport.total)
      notes.push(
        `표 ${tableReport.simple}/${tableReport.total}개 마크다운 표로 표시` +
          (tableReport.opaque ? `, ${tableReport.opaque}개는 원본 보존(${Object.entries(tableReport.reasons).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""),
      );
    if (tableReport.unpaired) notes.push(`경고: 표 ${tableReport.unpaired}개를 HTML/OOXML과 짝지을 수 없어 원본 그대로 보존합니다`);
    if (mathReport.unpaired)
      notes.push(`경고: 수식 ${mathReport.unpaired}개를 변환하지 못했습니다(표 안 등). 적용 시 중단됩니다`);
    return {markdown, notes, signature:regionSignature(paragraphs.map(p => p.text)),
      baseline:supportsIds ? {markdown, paragraphs:paragraphs.map(p => ({id:p.uniqueLocalId,text:p.text}))} : undefined};
  });
  if (acceptResult()) {
    lastRegion = result.signature;
    paragraphBaseline = result.baseline;
  }
  return {markdown:result.markdown, notes:result.notes};
}

export interface ApplyResult {
  missing: string[];
  /** Normalizations worth telling the user about. */
  notes: string[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Fingerprint of a region's text (paragraph by paragraph). Remembered after every load and apply: the next apply asks
 * before it replaces a selection that is not the region the editor's markdown came from.
 */
export const regionSignature = (paragraphs: string[]) => `${paragraphs.length}:${hashId(paragraphs.map(norm).join("\n"))}`;
let lastRegion: string | null = null;

/** Explicit partial apply never falls through to whole-selection replacement. */
export async function applyParagraphEdit(markdown: string): Promise<void> {
  const base = paragraphBaseline;
  if (!base) throw new Error("WordApi 1.6을 지원하는 Word에서 선택 영역을 먼저 불러오세요.");
  const edit = plainParagraphEdit(base.markdown, markdown);
  const matches = base.paragraphs.filter(p => p.text === edit.before);
  if (matches.length !== 1) throw new Error("불러온 영역에서 대상 문단을 하나로 식별할 수 없습니다.");
  const [original] = matches;
  await Word.run(async context => {
    const selection = context.document.getSelection();
    selection.paragraphs.load("items/uniqueLocalId");
    await context.sync();
    const p = selection.paragraphs.items.find(candidate => candidate.uniqueLocalId === original.id);
    if (!p) throw new Error("수정한 문단을 포함하는 영역을 다시 선택하세요.");
    const range = p.getRange("Content");
    const start = selection.getRange("Start").compareLocationWith(range.getRange("Start"));
    const end = selection.getRange("End").compareLocationWith(range.getRange("End"));
    const control = p.parentContentControlOrNullObject;
    control.load("isNullObject");
    p.load("text,tableNestingLevel,isListItem");
    const xml = p.getOoxml();
    await context.sync();
    if (p.text !== original.text) throw new Error("Word에서 대상 문단이 바뀌었습니다. 다시 불러오세요.");
    if (!["Before","Equal"].includes(start.value) || !["After","Equal"].includes(end.value) ||
        !control.isNullObject || p.tableNestingLevel || p.isListItem || !plainWordContent(xml.value, original.text))
      throw new Error("전체가 선택된 일반 텍스트 문단만 부분 적용할 수 있습니다.");
    range.insertText(edit.after, Word.InsertLocation.replace);
    await context.sync();
    original.text = edit.after;
    base.markdown = markdown;
    lastRegion = regionSignature(base.paragraphs.map(item => item.text));
  });
}

/** Replace the current selection in Word with the rendered markdown, restoring Word-only objects. */
export async function replaceSelectionWithMarkdown(
  markdown: string,
  /** Asks the user (true = go on) when the selection is not the region that was last loaded/applied. */
  confirm?: (message: string) => Promise<boolean>,
  options: { mathOutput?: MathOutputMode;mathAppearance?:MathAppearance;mathAppearanceSource?:MathAppearanceSource } = {},
): Promise<ApplyResult> {
  return Word.run(async (context) => {
    // A collapsed selection (just a cursor) cannot be read (getHtml throws GeneralException), and replacing it would
    // insert the markdown next to the old content instead of replacing it.
    const base = paragraphBaseline;
    const supportsIds = Office.context.requirements.isSetSupported("WordApi", "1.6");
    const fields = supportsIds ? "items/text,items/uniqueLocalId" : "items/text";
    const sel0 = context.document.getSelection();
    sel0.load("isEmpty,text");
    sel0.paragraphs.load(fields);
    await context.sync();
    if (sel0.isEmpty)
      throw new Error(
        "선택 영역이 비어 있습니다 (커서만 있음). 바꿀 영역을 선택한 뒤 다시 누르세요 (방금 적용한 영역을 다시 선택하거나 '선택 영역 → 마크다운'으로 다시 불러오세요)",
      );
    // Copy the approved target before any confirmation or asynchronous math rendering.
    const target = sel0.paragraphs.items.map(p => ({id:supportsIds ? p.uniqueLocalId : "", text:p.text}));
    const selectedText = sel0.text;
    const sameIds = base && target.length === base.paragraphs.length &&
      target.every((p,i) => p.id === base.paragraphs[i].id);
    let warning: string | undefined;
    if (base) {
      const previous = new Map(base.paragraphs.map(p => [p.id, p.text]));
      const changed = target.findIndex(p => previous.has(p.id) && previous.get(p.id) !== p.text);
      if (changed >= 0)
        warning = `선택 영역의 ${changed+1}번째 문단 텍스트가 Word에서 바뀌었습니다. 전체를 적용하면 Word의 변경을 덮어씁니다. 다른 문단 한 곳만 편집했다면 취소 후 ‘한 문단만 적용’을 사용하세요. 전체를 바꿀까요?`;
    }
    if (!warning && ((base && !sameIds) || (lastRegion !== null && regionSignature(target.map(p => p.text)) !== lastRegion)))
      warning = "선택한 영역 또는 문단 구성이 달라졌습니다. 지금 선택한 영역 전체를 에디터 내용으로 바꿀까요?";
    if (warning && !(confirm && await confirm(warning)))
      throw new Error("적용을 취소했습니다. 편집한 한 문단만 적용하거나 Word에서 다시 불러오세요.");
    const loaded = await loadSidecar(context);
    const sidecar = loaded.sidecar;
    // Original OOXML of the tables the markdown refers to (stored gz-compressed in the sidecar).
    const tableSources = new Map<string, { raw: string; rels?: string }>();
    for (const id of tableIds(markdown)) {
      const e = sidecar.get(id);
      if (e?.kind === "table" && e.ooxml) tableSources.set(id, { raw: await ungz(e.ooxml), rels: e.rels });
    }
    const { html: html0, missing, styled, floats, lost, equations, opaqueEquations, tables, badTables, tableNotes, opaqueTables } =
      renderWithSidecar(markdown, sidecar, tableSources);

    if (badTables.length) throw new Error(`표를 적용할 수 없어 중단했습니다: ${badTables[0]}`);
    if (missing.length)
      throw new Error(`복원할 수 없는 Word 객체: ${missing.join(", ")}. 적용을 중단했습니다. '선택 영역 → 마크다운'으로 다시 불러오세요`);

    // Safety net: never silently destroy a floating object.
    if (lost.length)
      throw new Error(
        `Word 개체 ${lost.length}개의 원본을 복원할 수 없어 적용을 중단했습니다. '선택 영역 → 마크다운'으로 다시 불러오세요`,
      );
    const current = sel0.getHtml();
    const currentOoxml = sel0.getOoxml();
    await context.sync();
    const tablesPresent = countTables(currentOoxml.value);
    if (tablesPresent > tables.length + opaqueTables)
      throw new Error(
        `선택 영역에 표 ${tablesPresent}개가 있지만 마크다운에는 ${tables.length + opaqueTables}개만 있습니다. ` +
          `적용하면 표가 사라지므로 중단했습니다 (표 줄이나 <!-- word:obj … kind=table --> 줄을 지우지 마세요)`,
      );
    // Word equations and pictures of LaTeX (`owb:math:` alt marker) all have to be among the markdown's math spans.
    const scanNow = scanOoxml(currentOoxml.value);
    const eqPresent = scanNow.equations + scanNow.mathImages;
    if (eqPresent > equations.length + opaqueEquations)
      throw new Error(
        `선택 영역에 수식 ${eqPresent}개가 있지만 마크다운에는 ${equations.length + opaqueEquations}개만 있습니다. ` +
          `적용하면 수식이 사라지므로 중단했습니다 ('선택 영역 → 마크다운'으로 다시 불러오세요)`,
      );
    const present = findFloatingBlocks(current.value).length;
    if (present > floats.length)
      throw new Error(
        `선택 영역에 부동 개체(그림/도형/텍스트 상자) ${present}개가 있지만 마크다운에는 ${floats.length}개만 있습니다. ` +
          `적용하면 개체가 사라지므로 중단했습니다 (<!-- word:obj … kind=float --> 줄을 지우지 마세요)`,
      );
    const ooxml = await Promise.all(floats.map((f) => ungz(f.ooxml)));

    // Math without OMML: a picture of the LaTeX (stored one if unchanged), else the literal source with a warning.
    // Rendering is async, so it all happens before the document is touched.
    let html = html0;
    let active = equations;
    let pictures = new Map<string, { body: string; rels: string; parts: string }>();
    const mathNotes: string[] = [];
    if (equations.some((q) => q.img) || (options.mathOutput === "images" && equations.length)) {
      let appearance=options.mathAppearance;
      if(options.mathOutput==='images' && (options.mathAppearanceSource==='selection' || options.mathAppearanceSource==='document')){
        const font=sel0.font;
        const useFont = options.mathAppearanceSource === 'document';
        font.load(useFont ? 'size,color,name' : 'size,color');
        await context.sync();
        appearance=selectionMathAppearance(font);
        if (useFont) appearance.fontFamily = documentFontName(font.name);
        mathNotes.push(`선택 영역 서식: 수식 그림 ${appearance.sizePt}pt · ${appearance.color}${appearance.fontFamily ? " · "+appearance.fontFamily : ""}`);
      }
      const plan = await (await import("../convert/mathimg")).applyMathImages(html0, equations, sidecar, undefined, options.mathOutput,appearance);
      ({ html, active, pictures } = plan);
      mathNotes.push(...plan.notes);
    }

    const selection = context.document.getSelection();
    // The paragraphs just outside the selection are not touched by the replacement: they delimit the region again
    // afterwards (the range insertHtml returns shrinks when its first/last paragraph is replaced by an object).
    const first = selection.paragraphs.getFirst();
    const last = selection.paragraphs.getLast();
    const prev = first.getPreviousOrNullObject();
    const next = last.getNextOrNullObject();
    prev.load("isNullObject");
    next.load("isNullObject");
    const startCmp = selection.getRange("Start").compareLocationWith(first.getRange("Start"));
    const endCmp = selection.getRange("End").compareLocationWith(last.getRange("End"));
    context.trackedObjects.add(prev);
    context.trackedObjects.add(next);
    try {
      selection.load("text");
      selection.paragraphs.load(fields);
      await context.sync();
      const final = selection.paragraphs.items;
      if (selection.text !== selectedText || final.length !== target.length ||
          final.some((p,i) => p.text !== target[i].text || (supportsIds && p.uniqueLocalId !== target[i].id)))
        throw new Error("적용을 준비하는 동안 Word 원문 또는 선택 영역이 바뀌었습니다. 다시 확인하세요.");
      const wholeParagraphs = startCmp.value === "Equal" && endCmp.value === "Equal";
      paragraphBaseline = undefined;
      const inserted = selection.insertHtml(html, Word.InsertLocation.replace);
      inserted.paragraphs.load("items/text");
      // Inline equations are marker words inside a paragraph: locate them (display ones are whole marker paragraphs).
      const found = active.map((q) => (q.display ? undefined : inserted.search(q.marker, { matchCase: true })));
      found.forEach((f) => f?.load("items"));
      await context.sync();

      // Required mutations run exactly once. Office batches can partially execute before rejecting a sync.
      const paras = inserted.paragraphs.items;
      const ops: (() => void)[] = [];
      const styleOps: (() => void)[] = [];
      // insertHtml may ignore class/mso-style-name (e.g. built-in Quote), so set styles explicitly by name.
      const used = new Set<number>();
      for (const spec of styled) {
        const idx = paras.findIndex((p, i) => !used.has(i) && norm(p.text) === norm(spec.text));
        if (idx < 0) continue;
        used.add(idx);
        styleOps.push(() => (paras[idx].style = spec.style));
      }
      // Floating objects: replace each marker paragraph with the object's original OOXML.
      floats.forEach((f, n) => {
        const idx = paras.findIndex((p) => p.text.trim() === f.marker);
        if (idx < 0) throw new Error(`부동 개체 위치를 찾을 수 없습니다 (${f.marker})`);
        ops.push(() => paras[idx].insertOoxml(ooxml[n], Word.InsertLocation.replace));
        if(f.table){
          const next=paras[idx+1];
          if(next && !/^OWB(?:TBL|EQ|FLOAT)\d/.test(next.text.trim()))ops.push(()=>next.getPrevious().delete());
        }
      });
      // Tables: each replaces its marker paragraph (the original table, or one rebuilt from the markdown).
      tables.forEach((t) => {
        const idx = paras.findIndex((p) => p.text.trim() === t.marker);
        if (idx < 0) throw new Error(`표 위치를 찾을 수 없습니다 (${t.marker})`);
        const tp = wrapPackage(t.ooxml, t.rels);
        ops.push(() => paras[idx].insertOoxml(tp, Word.InsertLocation.replace));
        // insertOoxml leaves the marker paragraph behind as an empty paragraph after the table. Drop it when ordinary
        // text follows (a table needs some paragraph after it, and two tables need one between them: those stay).
        const next = paras[idx + 1];
        if (next && !/^OWB(?:TBL|EQ|FLOAT)\d/.test(next.text.trim())) ops.push(() => next.getPrevious().delete());
      });
      // Equations: display ones replace their marker paragraph, inline ones replace the marker word.
      active.forEach((q, n) => {
        const pic = pictures.get(q.marker);
        const pkg = pic ? wrapPackage(pic.body, pic.rels, pic.parts) : equationPackage(q.omml);
        if (q.display) {
          const idx = paras.findIndex((p) => p.text.trim() === q.marker);
          if (idx < 0) throw new Error(`수식 위치를 찾을 수 없습니다 (${q.marker})`);
          ops.push(() => paras[idx].insertOoxml(pkg, Word.InsertLocation.replace));
        } else {
          const r = found[n]?.items[0];
          if (!r) throw new Error(`수식 위치를 찾을 수 없습니다 (${q.marker})`);
          ops.push(() => r.insertOoxml(pkg, Word.InsertLocation.replace));
        }
      });
      // Empty paragraphs (`<!-- word:blank -->` markers): the marker paragraphs become empty again.
      for (const p of paras) if (p.text.trim() === BLANK_TOKEN) ops.push(() => p.clear());
      // Leave the whole inserted region selected, so that applying again replaces the same region.
      ops.push(() => {
        if (!wholeParagraphs) return inserted.select(); // the selection began/ended inside a paragraph
        const from = prev.isNullObject ? context.document.body.getRange("Start") : prev.getRange("After");
        const to = next.isNullObject ? context.document.body.paragraphs.getLast().getRange("Whole") : next.getRange("Start");
        from.expandTo(to).select();
      });
      if (ops.length) {
        try {
          ops.forEach((op) => op());
          await context.sync();
        } catch (e) {
          throw new Error(`문서 복원 중 오류가 발생해 적용을 중단했습니다: ${(e as Error)?.message ?? String(e)} (Ctrl+Z를 여러 번 눌러 되돌리세요)`);
        }
      }

      // Styles are optional, and isolated so an unknown name cannot interrupt object restoration. Never replay this
      // batch either: styles before the failed action may already have been applied.
      const styleNotes: string[] = [];
      if (styleOps.length) {
        try {
          styleOps.forEach((op) => op());
          await context.sync();
        } catch {
          styleNotes.push("일부 문단 스타일을 적용하지 못했습니다. Word에서 스타일을 확인하세요");
        }
      }
      // Make sure no marker was left behind as text and no object is missing.
      const checks = leftoverChecks({
        floats: floats.length,
        equations: active.length,
        tables: tables.length,
        blanks: paras.some((p) => p.text.trim() === BLANK_TOKEN),
      });
      if (checks.length) {
        const found = checks.map((c) => ({ c, r: context.document.body.search(c.prefix, { matchCase: true }) }));
        found.forEach((f) => f.r.load("items"));
        await context.sync();
        for (const { c, r } of found) if (r.items.length) throw new Error(`${c.label} ${r.items.length}개를 ${c.action} (Ctrl+Z를 여러 번 눌러 되돌리세요)`);
      }

      const after = context.document.getSelection();
      after.paragraphs.load(fields);
      await context.sync();
      lastRegion = regionSignature(after.paragraphs.items.map((p) => p.text));

      // Entries referenced by the applied markdown are marked as used; other regions' entries are left alone.
      await saveSidecar(
        context,
        sidecar,
        loaded,
        new Set([...placeholderIds(markdown), ...mathIds(markdown), ...mathImgIds(markdown), ...tableIds(markdown)]),
      );
      if (supportsIds) paragraphBaseline = {markdown, paragraphs:after.paragraphs.items.map(p => ({id:p.uniqueLocalId,text:p.text}))};
      return { missing, notes: [...tableNotes, ...mathNotes, ...styleNotes] };
    } finally {
      prev.untrack();
      next.untrack();
    }
  });
}
