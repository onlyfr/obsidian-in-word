import { htmlToMarkdown, markdownToHtml } from "../convert/obsidian";

/** Read the current selection from Word as Obsidian-flavored markdown. */
export async function readSelectionAsMarkdown(): Promise<string> {
  return Word.run(async (context) => {
    const html = context.document.getSelection().getHtml();
    await context.sync();
    return htmlToMarkdown(html.value);
  });
}

/** Replace the current selection in Word with the rendered markdown. */
export async function replaceSelectionWithMarkdown(markdown: string): Promise<void> {
  await Word.run(async (context) => {
    context.document.getSelection().insertHtml(markdownToHtml(markdown), Word.InsertLocation.replace);
    await context.sync();
  });
}
