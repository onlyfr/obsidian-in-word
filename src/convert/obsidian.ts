import MarkdownIt from "markdown-it";
import TurndownService from "turndown";
import { PLACEHOLDER_SPLIT_RE, STYLE_MARKER_RE, parseStyleNames, protectOpaque, tokensToPlaceholders } from "./blocks";
import { MemorySidecar, type Sidecar } from "./sidecar";

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

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


interface StyleEnv {
  styles?: Map<string, string>;
}

// `<!-- word:style class=a3 name=... -->` on its own line applies a Word paragraph style to the next paragraph.
md.block.ruler.before("paragraph", "word_style", (state, startLine, _endLine, silent) => {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const m = STYLE_MARKER_RE.exec(state.src.slice(pos, state.eMarks[startLine]));
  if (!m) return false;
  if (silent) return true;
  const token = state.push("word_style", "", 0);
  token.meta = { cls: m[1], name: decodeURIComponent(m[2]) };
  token.map = [startLine, startLine + 1];
  state.line = startLine + 1;
  return true;
});

md.core.ruler.after("block", "word_style_apply", (state) => {
  const env = state.env as StyleEnv;
  let pending = null as { cls: string; name: string } | null;
  state.tokens = state.tokens.filter((t) => {
    if (t.type === "word_style") {
      pending = t.meta as { cls: string; name: string };
      return false;
    }
    if (t.type === "paragraph_open" && t.level === 0 && !t.hidden) {
      // Without an explicit class, insertHtml would use "Normal (Web)"; MsoNormal maps to Word's Normal.
      t.attrSet("class", pending?.cls ?? "MsoNormal");
      if (pending) (env.styles ??= new Map()).set(pending.cls, pending.name);
      pending = null;
    }
    return true;
  });
});

const escapeCss = (v: string) => v.replace(/["\\\n]/g, "");

/** Obsidian-flavored markdown -> HTML suitable for Word's insertHtml. */
export function markdownToHtml(src: string): string {
  const env: Record<string, unknown> = {};
  const body = md.render(preprocessCallouts(src), env);
  const used = (env as StyleEnv).styles;
  if (!used?.size) return body;
  const css = [...used].map(([cls, name]) => `p.${cls}{mso-style-name:"${escapeCss(name)}";}`).join("");
  return `<style>${css}</style>${body}`;
}

const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });

/** Strip Word-specific noise from getHtml() output and keep only the body. */
export function cleanWordHtml(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?o:p>/gi, "")
    .replace(/<\/?(?:span|font)\b[^>]*>/gi, (tag) => (/<span[^>]*mso-/i.test(tag) ? "" : tag));
}

/**
 * HTML from Word's getHtml -> Obsidian-flavored markdown.
 * Word-only objects (tables, images, tracked changes, ...) become `<!-- word:obj ... -->`
 * placeholders; their original HTML is stored in `sidecar`.
 */
export function htmlToMarkdown(html: string, sidecar: Sidecar = new MemorySidecar()): string {
  const styleNames = parseStyleNames(html);
  const out = tokensToPlaceholders(td.turndown(protectOpaque(cleanWordHtml(html), sidecar, styleNames)));
  return out
    .replace(/^(\s*)-   /gm, "$1- ") // turndown pads list items to 4 columns
    .replace(/\\\[\\\[(.+?)\\\]\\\]/g, "[[$1]]") // turndown escapes the brackets of plain-text [[wikilinks]]
    .replace(/(<!-- word:style [^>]*-->)\n\n(?=\S)/g, "$1\n") // keep a style marker next to its paragraph
    .replace(/^> \*\*\\\[!(\w+)\\\]\s*(.*?)\*\*\n>[ \t]*\n/gm, (_m, type: string, title: string) =>
      `> [!${type}]${title ? " " + title : ""}\n`,
    )
    .trimEnd();
}

export interface RenderResult {
  html: string;
  /** Placeholder ids that were not found in the sidecar (object deleted or document mismatch). */
  missing: string[];
}

/** Markdown (with placeholders) -> HTML for Word, restoring Word-only objects from the sidecar. */
export function renderWithSidecar(src: string, sidecar: Sidecar): RenderResult {
  const parts = src.split(PLACEHOLDER_SPLIT_RE); // [text, id, kind, text, id, kind, ...]
  const missing: string[] = [];
  let html = "";
  for (let i = 0; i < parts.length; i += 3) {
    html += markdownToHtml(parts[i]);
    const id = parts[i + 1];
    if (id === undefined) continue;
    const entry = sidecar.get(id);
    if (entry) html += entry.html;
    else {
      missing.push(id);
      html += `<p>[missing Word object ${id}]</p>`;
    }
  }
  return { html, missing };
}
