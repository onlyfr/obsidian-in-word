import { placeholderIds } from "../convert/blocks";
import { htmlToMarkdown, renderWithSidecar, styleHintsFromParagraphs } from "../convert/obsidian";
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

/** Read the current selection from Word as Obsidian-flavored markdown. */
export async function readSelectionAsMarkdown(): Promise<string> {
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
    // getHtml has no real names for built-in styles (Quote, ...); ask Office.js for the localized names.
    const hints = styleHintsFromParagraphs(
      html.value,
      selection.paragraphs.items.map((p) => ({ text: p.text, style: p.style })),
    );
    const markdown = htmlToMarkdown(html.value, sidecar, hints, pictures.map((p) => p.value));
    // Keep only the objects referenced by the markdown just produced; older entries are stale.
    await saveSidecar(context, pruneSidecar(sidecar, placeholderIds(markdown)));
    return markdown;
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
    const { html, missing, styled } = renderWithSidecar(markdown, sidecar);
    const inserted = context.document.getSelection().insertHtml(html, Word.InsertLocation.replace);
    inserted.paragraphs.load("items/text");
    await context.sync();

    // insertHtml may ignore class/mso-style-name (e.g. built-in Quote), so set styles explicitly by name.
    const used = new Set<number>();
    const paras = inserted.paragraphs.items;
    for (const spec of styled) {
      const idx = paras.findIndex((p, i) => !used.has(i) && norm(p.text) === norm(spec.text));
      if (idx < 0) continue;
      used.add(idx);
      try {
        paras[idx].style = spec.style;
        await context.sync();
      } catch {
        // unknown style name in this document: keep whatever insertHtml produced
      }
    }

    // Drop sidecar entries for objects that are no longer referenced by the markdown being applied.
    await saveSidecar(context, pruneSidecar(sidecar, placeholderIds(markdown)));
    return { missing };
  });
}
