import { htmlToMarkdown, renderWithSidecar } from "../convert/obsidian";
import { MemorySidecar, SIDECAR_NAMESPACE, sidecarFromXml, sidecarToXml, type Sidecar } from "../convert/sidecar";

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
    const html = context.document.getSelection().getHtml();
    await context.sync();
    const markdown = htmlToMarkdown(html.value, sidecar);
    await saveSidecar(context, sidecar);
    return markdown;
  });
}

export interface ApplyResult {
  missing: string[];
}

/** Replace the current selection in Word with the rendered markdown, restoring Word-only objects. */
export async function replaceSelectionWithMarkdown(markdown: string): Promise<ApplyResult> {
  return Word.run(async (context) => {
    const sidecar = await loadSidecar(context);
    const { html, missing } = renderWithSidecar(markdown, sidecar);
    context.document.getSelection().insertHtml(html, Word.InsertLocation.replace);
    await context.sync();
    return { missing };
  });
}
