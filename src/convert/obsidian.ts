import MarkdownIt from "markdown-it";
import TurndownService from "turndown";

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

/** Obsidian [[target]] / [[target|alias]] -> markdown link with an `obsidian:` scheme marker. */
export function preprocessWikilinks(src: string): string {
  return src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
    const label = alias ?? target;
    return `[${label}](wikilink:${encodeURIComponent(target.trim())})`;
  });
}

/**
 * Obsidian callout `> [!type] Title` -> blockquote whose first paragraph is a bold marker
 * (`**[!type] Title**`) that htmlToMarkdown can turn back into the callout header.
 */
export function preprocessCallouts(src: string): string {
  return src.replace(/^> \[!(\w+)\][ \t]*(.*)$/gm, (_m, type: string, title: string) => {
    const header = `[!${type.toLowerCase()}] ${title.trim()}`.trim();
    return `> **${header}**\n>`;
  });
}

md.validateLink = () => true; // allow the wikilink: scheme

/** Obsidian-flavored markdown -> HTML suitable for Word's insertHtml. */
export function markdownToHtml(src: string): string {
  return md.render(preprocessCallouts(preprocessWikilinks(src)));
}

const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });

td.addRule("wikilink", {
  filter: (node) => node.nodeName === "A" && (node.getAttribute("href") ?? "").startsWith("wikilink:"),
  replacement: (content, node) => {
    const target = decodeURIComponent((node as HTMLElement).getAttribute("href")!.slice("wikilink:".length));
    return content === target ? `[[${target}]]` : `[[${target}|${content}]]`;
  },
});

/** Strip Word-specific noise from getHtml() output and keep only the body. */
export function cleanWordHtml(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?o:p>/gi, "")
    .replace(/<\/?(?:span|font)\b[^>]*>/gi, (tag) => (/<span[^>]*mso-/i.test(tag) ? "" : tag));
}

/** HTML from Word's getHtml -> Obsidian-flavored markdown. */
export function htmlToMarkdown(html: string): string {
  const out = td.turndown(cleanWordHtml(html));
  return out
    .replace(/^(\s*)-   /gm, "$1- ") // turndown pads list items to 4 columns
    .replace(/^> \*\*\\\[!(\w+)\\\]\s*(.*?)\*\*\n>[ \t]*\n/gm, (_m, type: string, title: string) =>
      `> [!${type}]${title ? " " + title : ""}\n`,
    )
    .trimEnd();
}
