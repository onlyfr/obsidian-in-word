import MarkdownIt from "markdown-it";
import TurndownService from "turndown";
import {
  EQ_ATTR,
  hasFloating,
  PLACEHOLDER_SPLIT_RE,
  isFloatingImg,
  STYLE_MARKER_RE,
  findFloatingInDoc,
  parseStyleNames,
  protectOpaque,
  tokensToPlaceholders,
  type FloatBlock,
  type FloatReport,
} from "./blocks";
import { MemorySidecar, type Sidecar } from "./sidecar";
import {
  EQ_TOKEN_RE,
  captureMath,
  tokenizeMath,
  type ImgCapture,
  type MathResolved,
} from "./equations";
import { TABLE_MARKER_RE, analyzeHtmlTable, buildTableOoxml, findTableBlocks, modelToLines, sameModel, tableId, tableMarker, type TableModel } from "./tables";

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

// List items get an explicit class: insertHtml otherwise makes them "Normal (Web)", and setting a style through
// Office.js afterwards would strip the list formatting. `<li class=MsoListParagraph>` keeps a real list.
const DEFAULT_LIST_CLASS = "MsoListParagraph";

md.core.ruler.after("block", "word_style_apply", (state) => {
  const env = state.env as StyleEnv;
  let pending = null as { cls: string; name: string } | null;
  let listCls: string | null = null;
  let listLevel = -1;
  state.tokens = state.tokens.filter((t) => {
    if (t.type === "word_style") {
      pending = t.meta as { cls: string; name: string };
      return false;
    }
    if ((t.type === "bullet_list_open" || t.type === "ordered_list_open") && listCls === null) {
      listCls = pending?.cls ?? DEFAULT_LIST_CLASS;
      listLevel = t.level;
      pending = null;
    }
    if (t.type === "list_item_open" && listCls) t.attrSet("class", listCls);
    if ((t.type === "bullet_list_close" || t.type === "ordered_list_close") && t.level === listLevel) {
      listCls = null;
      listLevel = -1;
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
  // Without a real name (name === class) a style block would just create a junk style called e.g. "MsoQuote".
  const css = [...used]
    .filter(([cls, name]) => name !== cls)
    .map(([cls, name]) => `p.${cls}{mso-style-name:"${escapeCss(name)}";}`)
    .join("");
  return css ? `<style>${css}</style>${body}` : body;
}

const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });

/** Strip Word-specific noise from getHtml() output and keep only the body. */
/**
 * A "top and bottom" wrapped picture is rendered by Word as a layout-table hack *inside* the paragraph
 * (`<table cellpadding=0 cellspacing=0><tr><td width=N height=0></td></tr><tr><td></td><td><img></td></tr></table>
 * <br clear=ALL>`), which an HTML parser hoists out of the `<p>` and which has no floating marker of its own.
 * Rewrite it to the `position:absolute` form used for other floating pictures.
 */
const TOP_BOTTOM_HACK_RE =
  /<table\s+cellpadding=0\s+cellspacing=0>\s*<tr>\s*<td\s+width=\d+\s+height=0>\s*<\/td>\s*<\/tr>\s*<tr>\s*<td>\s*<\/td>\s*<td>\s*(<img\b[^>]*>)\s*<\/td>\s*<\/tr>\s*<\/table>\s*<br\s+clear=ALL>/gi;

export function cleanWordHtml(html: string): string {
  const body = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html).replace(
    TOP_BOTTOM_HACK_RE,
    '<span style="position:absolute">$1</span>',
  );
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
export function htmlToMarkdown(
  html: string,
  sidecar: Sidecar = new MemorySidecar(),
  /** class -> real Word style name (e.g. from Office.js), overriding names parsed from the HTML. */
  styleNameHints: Map<string, string> = new Map(),
  /** Base64 data of the selection's inline pictures, in document order. */
  images?: string[],
  /** OOXML for the floating blocks reported by findFloatingBlocks (same order). */
  floatOoxml?: (string | undefined)[],
  /** Out: floating-object statistics. */
  report?: FloatReport,
  /** Image-like objects of the selection's OOXML (see scanOoxml), used to turn equation images into LaTeX. */
  imgCaptures?: ImgCapture[],
  /** Out: equation statistics. */
  mathReport?: MathReport,
  /** Raw OOXML (and its gz form) of the selection's top-level tables, in order (see scanTables). */
  tableCaps?: TableCapture[],
  /** Out: table statistics. */
  tableReport?: TableReport,
): string {
  const styleNames = new Map([...parseStyleNames(html), ...styleNameHints]);
  const tokens: MathToken[] = [];
  const eqPackages: { pkg: string; count: number }[] = [];
  const tableBlocks: string[] = [];
  const pics = { total: 0, math: new Set<number>() };
  const cleaned = convertSimpleTables(
    replaceEquationImages(cleanWordHtml(html), imgCaptures, sidecar, tokens, eqPackages, mathReport, pics),
    tableCaps,
    sidecar,
    tableBlocks,
    tableReport,
  );
  const raw0 = tokensToPlaceholders(
    td.turndown(
      protectOpaque(
        cleaned,
        sidecar,
        styleNames,
        // Office.js lists our math pictures among the inline pictures; they became $latex$ above, so drop their bytes.
        images && pics.math.size && images.length === pics.total ? images.filter((_, k) => !pics.math.has(k)) : images,
        floatOoxml,
        report,
        eqPackages,
      ),
    ),
  );
  // Literal dollar signs must not read as math; then put the equations in as $latex$ / $$ blocks.
  const raw = raw0;
  const out = raw
    .replace(/(```[\s\S]*?```|`[^`\n]*`|\$)/g, (m) => (m === "$" ? "\\$" : m))
    .replace(/^OWBEQ(\d+)END[ \t]*$/gm, (m, n: string) => {
      const t = tokens[Number(n)];
      return t?.display ? `$$\n${t.latex}\n$$` : m;
    })
    .replace(EQ_TOKEN_RE, (_m, n: string) => {
      const t = tokens[Number(n)];
      return t.display ? `$$${t.latex}$$` : `$${t.latex}$`;
    });
  return out
    .replace(/^OWBTBL(\d+)END[ 	]*$/gm, (_m, n: string) => tableBlocks[Number(n)])
    .replace(/^(\s*)-   /gm, "$1- ") // turndown pads list items to 4 columns
    .replace(/^(\s*)(\d+\.) {2,}/gm, "$1$2 ")
    .replace(/\\\[\\\[(.+?)\\\]\\\]/g, "[[$1]]") // turndown escapes the brackets of plain-text [[wikilinks]]
    .replace(/(<!-- word:style [^>]*-->)\n\n(?=\S)/g, "$1\n") // keep a style marker next to its paragraph
    .replace(/^> \*\*\\\[!(\w+)\\\]\s*(.*?)\*\*\n>[ \t]*\n/gm, (_m, type: string, title: string) =>
      `> [!${type}]${title ? " " + title : ""}\n`,
    )
    .trimEnd();
}

export interface TableCapture {
  /** Raw top-level `<w:tbl>` markup. */
  raw: string;
  /** gz-encoded `raw` (stored in the sidecar). */
  gz: string;
  /** `<Relationship>` markup for the hyperlinks `raw` refers to (see tableRels). */
  rels?: string;
}

export interface TableReport {
  total: number;
  /** Shown as markdown tables. */
  simple: number;
  /** Kept as opaque `kind=table` placeholders (merged cells, nested tables, ...). */
  opaque: number;
  /** HTML and OOXML tables could not be paired; all stay opaque. */
  unpaired: number;
  /** Why tables stayed opaque (reason -> count). */
  reasons: Record<string, number>;
}

/** Inline markdown of one table cell (same rules as paragraphs, escaped for a pipe table). */
function cellMarkdown(inlineHtml: string): string {
  return td
    .turndown(`<div>${inlineHtml}</div>`)
    .replace(/\\\[\\\[(.+?)\\\]\\\]/g, "[[$1]]") // turndown escapes the brackets of plain-text [[wikilinks]]
    .replace(/(`[^`\n]*`|\$|~~)/g, (m) => (m === "$" ? "\\$" : m === "~~" ? "\\~~" : m)); // a literal $ / ~~ must not read as math / strike
}

/**
 * Replace simple top-level tables (see analyzeHtmlTable) by `OWBTBLnEND` paragraphs; the markdown block (marker +
 * pipe table) is put back after turndown. The original table OOXML goes into the sidecar under the marker's id.
 */
function convertSimpleTables(
  html: string,
  caps: TableCapture[] | undefined,
  sidecar: Sidecar,
  blocks: string[],
  report?: TableReport,
): string {
  if (!caps || !caps.length) {
    if (report) {
      const n = (html.match(/<table/gi) ?? []).length;
      report.total += n;
    }
    return html;
  }
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  // Every table that is not nested in another one pairs with a top-level table of the OOXML (document order); only
  // the ones that are direct children of the body/section are converted (a table inside a list item or quote stays).
  const tops = Array.from(doc.body.querySelectorAll("table")).filter((t) => !t.parentElement?.closest("table"));
  const direct = (t: Element) => {
    let p = t.parentElement;
    while (p && p !== doc.body && p.tagName === "DIV" && /^WordSection/i.test(p.className)) p = p.parentElement;
    return p === doc.body;
  };
  if (report) report.total += tops.length;
  if (tops.length !== caps.length) {
    if (report) report.unpaired += tops.length;
    return html;
  }
  const note = (reason: string) => {
    if (!report) return;
    report.opaque++;
    report.reasons[reason] = (report.reasons[reason] ?? 0) + 1;
  };
  tops.forEach((el, i) => {
    if (!direct(el)) return note("inside a list or quote");
    if (hasFloating(el)) return note("floating object");
    const a = analyzeHtmlTable(el, cellMarkdown);
    if (!a.simple) return note(a.reason);
    const id = tableId(caps[i].raw);
    const lines = modelToLines(a.model);
    sidecar.set(id, { kind: "table", html: "", ooxml: caps[i].gz, md: lines.join("\n"), rels: caps[i].rels });
    blocks.push(`${tableMarker(id)}\n${lines.join("\n")}`);
    const p = doc.createElement("p");
    p.textContent = `OWBTBL${blocks.length - 1}END`;
    el.replaceWith(p);
    if (report) report.simple++;
  });
  return doc.body.innerHTML;
}

export interface MathReport {
  /** Equations in the selection (from OOXML). */
  total: number;
  /** Shown as LaTeX. */
  latex: number;
  /** Kept as opaque `kind=equation` paragraphs (no LaTeX form). */
  opaque: number;
  /** Equations that could not be paired with an HTML image (counts did not match); apply will refuse. */
  unpaired: number;
  /** LaTeX-as-picture pairs (`owb:math:` alt marker) shown as LaTeX again; not part of `total`. */
  images?: number;
}

interface MathToken {
  latex: string;
  display: boolean;
}

/**
 * getHtml turns each equation into a bare `<img>`. Pair the non-floating images with the OOXML captures by order:
 * equations with a LaTeX form become `OWBEQnEND` text tokens, the others mark their paragraph as an opaque block.
 */
function replaceEquationImages(
  html: string,
  caps: ImgCapture[] | undefined,
  sidecar: Sidecar,
  tokens: MathToken[],
  eqPackages: { pkg: string; count: number }[],
  report?: MathReport,
  /** Out: number of non-equation pictures in the OOXML, and the (ordinal) positions of those that became math. */
  pics?: { total: number; math: Set<number> },
): string {
  if (pics && caps) pics.total = caps.filter((c) => c.kind !== "eq").length;
  const eqCount = caps?.filter((c) => c.kind === "eq").length ?? 0;
  const miCount = caps?.filter((c) => c.kind === "mathimg").length ?? 0;
  if (report) report.total += eqCount;
  if (!caps || !(eqCount + miCount)) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const imgs = Array.from(doc.body.querySelectorAll("img")).filter((i) => !isFloatingImg(i));
  if (imgs.length !== caps.length) {
    if (report) report.unpaired += eqCount + miCount;
    return html;
  }
  const perPara = new Map<string, number>();
  for (const c of caps) if (c.kind === "eq") perPara.set(c.paraXml, (perPara.get(c.paraXml) ?? 0) + 1);
  const pkgIndex = new Map<string, number>();
  let ord = -1;
  imgs.forEach((img, i) => {
    const cap = caps[i];
    if (cap.kind !== "eq") ord++;
    if (cap.kind === "pic") return;
    if (img.closest("table")) {
      // Equations inside tables cannot be restored separately from the (opaque) table: leave them, apply will refuse.
      if (report) report.unpaired++;
      return;
    }
    const span = img.parentElement;
    const target = span && span.tagName === "SPAN" && span.children.length === 1 && !(span.textContent ?? "").trim() ? span : img;
    if (cap.kind === "mathimg") {
      // LaTeX shown as a picture: the source comes from the sidecar pair (or, failing that, an untruncated alt text).
      const e = sidecar.get(cap.id);
      const latex = e?.kind === "mathimg" && e.latex ? e.latex : cap.latex;
      const display = e?.kind === "mathimg" ? !!e.display : cap.display;
      if (!latex || /(?<!\\)\$/.test(latex) || (!display && latex.includes("\n"))) {
        if (report) report.unpaired++; // no usable source: stays a plain picture, apply refuses rather than lose it
        return;
      }
      tokens.push({ latex, display });
      target.replaceWith(doc.createTextNode(`OWBEQ${tokens.length - 1}END`));
      pics?.math.add(ord);
      if (report) report.images = (report.images ?? 0) + 1;
      return;
    }
    const res = captureMath(cap, sidecar);
    if (res) {
      tokens.push({ latex: res.latex, display: cap.display });
      target.replaceWith(doc.createTextNode(`OWBEQ${tokens.length - 1}END`));
      if (report) report.latex++;
      return;
    }
    const block = img.closest("p, li, h1, h2, h3, h4, h5, h6, div, td, th") ?? img;
    if (!pkgIndex.has(cap.paraXml)) {
      pkgIndex.set(cap.paraXml, eqPackages.length);
      eqPackages.push({ pkg: cap.paraPkg ?? "", count: perPara.get(cap.paraXml) ?? 1 });
      if (report) report.opaque += perPara.get(cap.paraXml) ?? 1;
    }
    block.setAttribute(EQ_ATTR, String(pkgIndex.get(cap.paraXml)));
    target.remove();
  });
  return doc.body.innerHTML;
}

/** Blocks of `html` (getHtml output) that contain floating pictures/shapes/text boxes, in document order. */
export function findFloatingBlocks(html: string): FloatBlock[] {
  const doc = new DOMParser().parseFromString(`<body>${cleanWordHtml(html)}</body>`, "text/html");
  return findFloatingInDoc(doc);
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Map paragraph class -> Word style name by matching the paragraphs of getHtml output with the
 * style names Office.js reports for the same paragraphs (matched by text).
 */
export function styleHintsFromParagraphs(html: string, paras: { text: string; style: string }[]): Map<string, string> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const byText = new Map(paras.map((p) => [norm(p.text), p.style]));
  const hints = new Map<string, string>();
  for (const p of Array.from(doc.querySelectorAll("p[class]"))) {
    const style = byText.get(norm(p.textContent ?? ""));
    if (style && p.className && !hints.has(p.className)) hints.set(p.className.trim(), style);
  }
  return hints;
}

export interface RenderResult {
  html: string;
  /** Paragraphs that carry an explicit Word style; set via Office.js after insertHtml (which may ignore classes). */
  styled: { text: string; style: string }[];
  /** Placeholder ids that were not found in the sidecar (object deleted or document mismatch). */
  missing: string[];
  /**
   * Blocks restored losslessly from OOXML, in document order. `html` holds a marker paragraph with exactly this
   * text at the right position; the caller replaces that paragraph with `insertOoxml(ooxml)` after insertHtml.
   */
  floats: { marker: string; ooxml: string }[];
  /** Floating objects whose lossless OOXML was not captured: restoring them would silently drop the object. */
  lost: string[];
  /**
   * Equations written as `$...$` / `$$...$$`. `html` contains each `marker` as plain text (display ones alone in their
   * paragraph); the caller replaces it with `insertOoxml(equationPackage(omml))`. Entries with `img` have no OMML: the
   * caller makes a picture of the LaTeX (mathimg.ts) or, when that fails, writes the `$...$` source instead.
   */
  equations: MathResolved[];
  /** Equations inside opaque `kind=equation` paragraphs that are restored from the sidecar. */
  opaqueEquations: number;
  /**
   * Markdown tables. `html` contains each `marker` as plain text alone in its paragraph; the caller replaces that
   * paragraph with `insertOoxml(wrapPackage(ooxml))` (the original table if it was not edited).
   */
  tables: { marker: string; ooxml: string; rels?: string; edited: boolean }[];
  /** Tables that cannot be applied without losing text (ragged rows, broken markers): the apply refuses. */
  badTables: string[];
  /** Normalizations the user should hear about (e.g. short rows padded). */
  tableNotes: string[];
  /** Top-level Word tables that stay opaque (`kind=table`, or floating blocks that are tables). */
  opaqueTables: number;
}

function collectStyled(chunk: string, out: { text: string; style: string }[]): void {
  const doc = new DOMParser().parseFromString(chunk, "text/html");
  const names = new Map<string, string>();
  for (const m of chunk.matchAll(/p\.([\w-]+)\{mso-style-name:"([^"]*)";\}/g)) names.set(m[1], m[2]);
  for (const p of Array.from(doc.body.querySelectorAll("p[class]"))) {
    const style = names.get(p.className);
    if (style && style !== p.className) out.push({ text: p.textContent ?? "", style });
  }
}

/** Markdown (with placeholders) -> HTML for Word, restoring Word-only objects from the sidecar. */
/**
 * Replace the markdown tables of `src` (with their marker lines) by `OWBTBLnEND` paragraphs and work out the OOXML
 * of each: the stored original when the table text is unchanged, otherwise a rebuild (see buildTableOoxml).
 */
function extractTables(
  src: string,
  sidecar: Sidecar,
  sources: Map<string, { raw: string; rels?: string }>,
  tables: RenderResult["tables"],
  bad: string[],
  notes: string[],
): string {
  const blocks = findTableBlocks(src);
  if (!blocks.length) return src;
  let out = "";
  let pos = 0;
  for (const b of blocks) {
    out += src.slice(pos, b.start);
    pos = b.end;
    if (b.error === "orphan" || b.error === "separator") {
      bad.push(`표 표지(<!-- word:table … -->) 아래에 올바른 표가 없습니다 (머리글/구분선 줄을 확인하세요)`);
      continue;
    }
    if (b.error?.startsWith("ragged")) {
      bad.push(`표의 ${b.error.split(":")[1]}번째 줄에 머리글보다 칸이 많아 글자가 사라질 수 있습니다`);
      out += src.slice(b.start, b.end);
      continue;
    }
    const entry = b.id ? sidecar.get(b.id) : undefined;
    const original = entry?.kind === "table" ? sources.get(b.id!) : undefined;
    const raw = original?.raw;
    const origModel: TableModel | undefined = entry?.md ? findTableBlocks(entry.md)[0]?.model : undefined;
    if (b.id && !raw) notes.push("원본 표를 찾지 못해 새 표로 만들었습니다 (서식 없음)");
    const unchanged = !!raw && !!origModel && sameModel(origModel, b.model);
    if (b.padded) notes.push(`표의 짧은 행 ${b.padded}개를 빈 칸으로 채웠습니다`);
    const ooxml = unchanged ? raw! : buildTableOoxml(raw ?? null, b.model, origModel).xml;
    const rels = original?.rels;
    const marker = `OWBTBL${tables.length}END`;
    tables.push({ marker, ooxml, rels, edited: !unchanged });
    out += `\n\n${marker}\n\n`;
  }
  return out + src.slice(pos);
}

/** Markdown (with placeholders) -> HTML for Word, restoring Word-only objects from the sidecar. */
export function renderWithSidecar(
  src: string,
  sidecar: Sidecar,
  /** Un-gz'd original OOXML of `kind=table` sidecar entries, by id (the caller decompresses them). */
  tableSources: Map<string, { raw: string; rels?: string }> = new Map(),
): RenderResult {
  const parts = src.split(PLACEHOLDER_SPLIT_RE); // [text, id, kind, text, id, kind, ...]
  const missing: string[] = [];
  const styled: RenderResult["styled"] = [];
  const floats: RenderResult["floats"] = [];
  const lost: string[] = [];
  const equations: MathResolved[] = [];
  const usedMath = new Map<string, number>();
  let opaqueEquations = 0;
  let opaqueTables = 0;
  const tables: RenderResult["tables"] = [];
  const badTables: string[] = [];
  const tableNotes: string[] = [];
  let html = "";
  for (let i = 0; i < parts.length; i += 3) {
    const noTables = extractTables(parts[i], sidecar, tableSources, tables, badTables, tableNotes);
    const chunk = markdownToHtml(tokenizeMath(noTables, sidecar, usedMath, equations.length, equations));
    html += chunk;
    collectStyled(chunk, styled);
    const id = parts[i + 1];
    if (id === undefined) continue;
    const entry = sidecar.get(id);
    if (entry?.kind === "equation") opaqueEquations += entry.count ?? 1;
    if (entry?.kind === "table" || (entry?.kind === "float" && entry.html.startsWith("<table"))) opaqueTables++;
    if (entry?.ooxml) {
      const marker = `OWBFLOAT${floats.length}X${id}`;
      floats.push({ marker, ooxml: entry.ooxml });
      html += `<p class="MsoNormal">${marker}</p>`;
    } else if (entry) {
      if (entry.kind === "float" || entry.kind === "equation") lost.push(id);
      html += entry.html;
    } else {
      missing.push(id);
      html += `<p>[missing Word object ${id}]</p>`;
    }
  }
  return { html, missing, styled, floats, lost, equations, opaqueEquations, tables, badTables, tableNotes, opaqueTables };
}
