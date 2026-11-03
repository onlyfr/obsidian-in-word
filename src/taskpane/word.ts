import { normText, placeholderIds, type FloatBlock, type FloatReport } from "../convert/blocks";
import { findFloatingBlocks, htmlToMarkdown, renderWithSidecar, styleHintsFromParagraphs } from "../convert/obsidian";
import {
  MemorySidecar,
  SIDECAR_NAMESPACE,
  pruneSidecar,
  sidecarFromXml,
  sidecarToXml,
  type Sidecar,
} from "../convert/sidecar";

/** Load the sidecar stored inside the document (Custom XML Part). Empty if none exists yet. */
async function loadSidecar(context: Word.RequestContext): Promise<Sidecar> {
  const sidecar = new MemorySidecar();
  const parts = context.document.customXmlParts.getByNamespace(SIDECAR_NAMESPACE);
  parts.load("items");
  await context.sync();
  const xmls = parts.items.map((p) => p.getXml());
  await context.sync();
  for (const x of xmls) sidecarFromXml(x.value, sidecar);
  return sidecar;
}

/** Replace the stored sidecar with `sidecar` (delete old part(s), add a fresh one). */
async function saveSidecar(context: Word.RequestContext, sidecar: Sidecar): Promise<void> {
  const parts = context.document.customXmlParts.getByNamespace(SIDECAR_NAMESPACE);
  parts.load("items");
  await context.sync();
  parts.items.forEach((p) => p.delete());
  context.document.customXmlParts.add(sidecarToXml(sidecar));
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

/** Read the current selection from Word as Obsidian-flavored markdown. */
export async function readSelectionAsMarkdown(): Promise<ReadResult> {
  return Word.run(async (context) => {
    const sidecar = await loadSidecar(context);
    const selection = context.document.getSelection();
    const html = selection.getHtml();
    selection.paragraphs.load("items/text,items/style");
    selection.inlinePictures.load("items");
    await context.sync();
    // getHtml references images by a temp file that is gone later; keep the real bytes in the sidecar instead.
    const pictures = selection.inlinePictures.items.map((p) => p.getBase64ImageSrc());
    await context.sync();
    const floatOoxml = await captureFloatOoxml(context, selection, findFloatingBlocks(html.value));
    // getHtml has no real names for built-in styles (Quote, ...); ask Office.js for the localized names.
    const hints = styleHintsFromParagraphs(
      html.value,
      selection.paragraphs.items.map((p) => ({ text: p.text, style: p.style })),
    );
    const report: FloatReport = { total: 0, preserved: 0 };
    const markdown = htmlToMarkdown(html.value, sidecar, hints, pictures.map((p) => p.value), floatOoxml, report);
    // Keep only the objects referenced by the markdown just produced; older entries are stale.
    await saveSidecar(context, pruneSidecar(sidecar, placeholderIds(markdown)));
    const notes: string[] = [];
    if (report.total) notes.push(`부동 개체 ${report.preserved}/${report.total}개 보존`);
    if (report.preserved < report.total)
      notes.push(`경고: 부동 개체 ${report.total - report.preserved}개는 보존할 수 없어 적용 시 중단됩니다`);
    return { markdown, notes };
  });
}

export interface ApplyResult {
  missing: string[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Replace the current selection in Word with the rendered markdown, restoring Word-only objects. */
export async function replaceSelectionWithMarkdown(markdown: string): Promise<ApplyResult> {
  return Word.run(async (context) => {
    const sidecar = await loadSidecar(context);
    const { html, missing, styled, floats, lost } = renderWithSidecar(markdown, sidecar);

    // Safety net: never silently destroy a floating object.
    if (lost.length)
      throw new Error(
        `부동 개체 ${lost.length}개의 원본을 복원할 수 없어 적용을 중단했습니다. '선택 영역 → 마크다운'으로 다시 불러오세요`,
      );
    const current = context.document.getSelection().getHtml();
    await context.sync();
    const present = findFloatingBlocks(current.value).length;
    if (present > floats.length)
      throw new Error(
        `선택 영역에 부동 개체(그림/도형/텍스트 상자) ${present}개가 있지만 마크다운에는 ${floats.length}개만 있습니다. ` +
          `적용하면 개체가 사라지므로 중단했습니다 (<!-- word:obj … kind=float --> 줄을 지우지 마세요)`,
      );
    const ooxml = await Promise.all(floats.map((f) => ungz(f.ooxml)));

    const inserted = context.document.getSelection().insertHtml(html, Word.InsertLocation.replace);
    inserted.paragraphs.load("items/text");
    await context.sync();

    // Everything below is one sync: every sync that changes the document is a separate Undo step.
    const paras = inserted.paragraphs.items;
    const ops: (() => void)[] = [];
    // insertHtml may ignore class/mso-style-name (e.g. built-in Quote), so set styles explicitly by name.
    const used = new Set<number>();
    for (const spec of styled) {
      const idx = paras.findIndex((p, i) => !used.has(i) && norm(p.text) === norm(spec.text));
      if (idx < 0) continue;
      used.add(idx);
      ops.push(() => (paras[idx].style = spec.style));
    }
    // Floating objects: replace each marker paragraph with the object's original OOXML.
    floats.forEach((f, n) => {
      const idx = paras.findIndex((p) => p.text.trim() === f.marker);
      if (idx < 0) throw new Error(`부동 개체 위치를 찾을 수 없습니다 (${f.marker})`);
      ops.push(() => paras[idx].insertOoxml(ooxml[n], Word.InsertLocation.replace));
    });
    if (ops.length) {
      try {
        ops.forEach((op) => op());
        await context.sync();
      } catch {
        // an unknown style name fails the whole batch: retry one by one and skip the bad ones
        for (const op of ops) {
          try {
            op();
            await context.sync();
          } catch {
            /* keep whatever insertHtml produced */
          }
        }
      }
    }

    // Drop sidecar entries for objects that are no longer referenced by the markdown being applied.
    await saveSidecar(context, pruneSidecar(sidecar, placeholderIds(markdown)));
    return { missing };
  });
}
