/**
 * Word tables <-> GFM pipe tables.
 *
 * A table is "simple" (editable as markdown) only if it is a rectangular grid of cells that each hold at most one
 * plain paragraph of inline content; everything else stays an opaque `kind=table` placeholder (see classify).
 * Lossless first: the original table's OOXML is kept in the sidecar under an id shown in a marker line
 * `<!-- word:table id=... -->` above the markdown table. Unchanged table -> the original OOXML is restored as is;
 * edited table -> rebuilt from the original (see buildTableOoxml for what is kept).
 */
import MarkdownIt from "markdown-it";
import { hashId } from "./blocks";
import { normalizeInlineFormatting } from "./inline-format";
import { OMML_PKG_NAMESPACES } from "./math";

export type Align = "" | "l" | "c" | "r";

export interface TableModel {
  aligns: Align[];
  /** Markdown source of each cell (already escaped: `\|`, `<br>`), row 0 is the header row. */
  rows: string[][];
}

export const MAX_COLS = 30;
export const MAX_ROWS = 500;
export const MAX_CELL = 2000;

export const TABLE_MARKER_RE = /^<!-- word:table id=([0-9a-f]{8}) -->[ \t]*$/;
export const tableMarker = (id: string) => `<!-- word:table id=${id} -->`;

// ---------------------------------------------------------------------------------------------------------------
// OOXML side

/** Raw markup of every top-level `<w:tbl>` of `ooxml`, in document order (nested tables stay inside their parent). */
export function scanTables(ooxml: string): string[] {
  const start = ooxml.indexOf("<w:body");
  const body = start < 0 ? ooxml : ooxml.slice(start);
  const out: string[] = [];
  const re = /<w:tbl[\s>]|<\/w:tbl>/g;
  let depth = 0;
  let from = -1;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m[0] === "</w:tbl>") {
      if (--depth === 0 && from >= 0) out.push(body.slice(from, m.index + m[0].length));
    } else if (depth++ === 0) from = m.index;
  }
  return out;
}

export const countTables = (ooxml: string) => scanTables(ooxml).length;

/** Drop the per-call noise Word adds (paragraph ids, revision ids) so equal tables compare/hash equal. */
export function normalizeIds(xml: string): string {
  return xml
    .replace(/<w:tblPrEx>[\s\S]*?<\/w:tblPrEx>/g, "") // redundant per-row exceptions: Word drops them when the table is inserted
    .replace(/\sw14:(?:paraId|textId)="[^"]*"/g, "")
    .replace(/\sw:rsid[A-Za-z]*="[^"]*"/g, "")
    .replace(/\sr:id="[^"]*"/g, ""); // relationship ids differ per getOoxml call; the target is in `rels`
}

/** `<Relationship>` markup for the relationship ids a table refers to (hyperlinks), from the package's rels part. */
export function tableRels(raw: string, ooxml: string): string {
  const ids = new Set(Array.from(raw.matchAll(/\sr:id="([^"]+)"/g), (m) => m[1]));
  if (!ids.size) return "";
  const out: string[] = [];
  for (const m of ooxml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const id = /\sId="([^"]+)"/.exec(m[0])?.[1];
    if (id && ids.has(id) && /\/hyperlink"/.test(m[0])) out.push(m[0]);
  }
  return out.join("");
}

export const tableId = (rawOoxml: string) => hashId("tbl:" + normalizeIds(rawOoxml));

// ---------------------------------------------------------------------------------------------------------------
// HTML (getHtml) side

export type Analysis = { simple: true; model: TableModel; header: boolean } | { simple: false; reason: string };

const CELL_BAD =
  'img, svg, object, canvas, ins, del, table, a[href^="#_ftn"], a[name^="_ftn"], a[href^="#_edn"], a[name^="_msocom"], a[href^="#_msocom"], [class*="MsoComment"], [class*="MsoFootnote"], [style*="mso-element:field"], [style*="mso-field"], [style*="position:absolute"], ul, ol, li, h1, h2, h3, h4, h5, h6, pre, blockquote, hr, div';

const cellOf = (td: Element) => Array.from(td.children).filter((c) => !/^o:p$/i.test(c.tagName));

function cellAlign(td: Element): Align {
  const p = td.querySelector("p");
  if (!p) return "";
  const a = (p.getAttribute("align") ?? /text-align:\s*(\w+)/i.exec(p.getAttribute("style") ?? "")?.[1] ?? "").toLowerCase();
  return a === "center" ? "c" : a === "right" ? "r" : a === "left" ? "l" : "";
}

/**
 * Decide whether an HTML `<table>` from getHtml is simple and, if so, convert its cells to markdown with `cellMd`
 * (the caller's HTML->markdown for one cell's inline HTML).
 */
export function analyzeHtmlTable(table: Element, cellMd: (inlineHtml: string) => string): Analysis {
  const no = (reason: string): Analysis => ({ simple: false, reason });
  if (table.querySelector("table table")) return no("nested table");
  const theadRows = Array.from(table.querySelectorAll(":scope > thead > tr"));
  const bodyRows = Array.from(table.querySelectorAll(":scope > tbody > tr, :scope > tr"));
  if (table.querySelector(":scope > tfoot")) return no("footer rows");
  if (theadRows.length > 1) return no("several header rows");
  const rows = [...theadRows, ...bodyRows];
  if (!rows.length) return no("empty table");
  if (rows.length > MAX_ROWS) return no("too many rows");
  const grid: Element[][] = rows.map((r) => Array.from(r.children).filter((c) => /^t[dh]$/i.test(c.tagName)));
  const cols = grid[0].length;
  if (!cols) return no("no cells");
  if (cols > MAX_COLS) return no("too many columns");
  const header = theadRows.length === 1;
  const out: string[][] = [];
  for (const [ri, cells] of grid.entries()) {
    if (cells.length !== cols) return no("not rectangular");
    const row: string[] = [];
    for (const td of cells) {
      if (td.hasAttribute("colspan") && Number(td.getAttribute("colspan")) !== 1) return no("merged cells");
      if (td.hasAttribute("rowspan") && Number(td.getAttribute("rowspan")) !== 1) return no("merged cells");
      if (td.querySelector(CELL_BAD)) return no("unsupported cell content");
      const kids = cellOf(td);
      if (kids.some((k) => k.tagName !== "P")) return no("unsupported cell content");
      if (kids.length > 1) return no("several paragraphs in a cell");
      const p = kids[0];
      if (p && !/^(MsoNormal|)$/.test(p.className.trim())) return no("styled cell paragraph");
      if (Array.from(td.querySelectorAll("*")).some((e) => e.tagName.includes(":") && !/^o:p$/i.test(e.tagName))) return no("unsupported cell content");
      const clone = (p ?? td).cloneNode(true) as Element;
      if (header && ri === 0) {
        // header bold comes from the table style: do not show it as ** in markdown
        for (const b of Array.from(clone.querySelectorAll("b, strong"))) b.replaceWith(...Array.from(b.childNodes));
      }
      normalizeInlineFormatting(clone);
      let md = cellMd(clone.innerHTML)
        .replace(/ *\n */g, "<br>")
        .replace(/(?:<br>)+$/g, "")
        .replace(/^(?:<br>)+/g, "")
        .trim();
      if (/^[\s ]*$/.test(md)) md = "";
      md = md.replace(/(?<!\\)\|/g, "\\|");
      if (md.length > MAX_CELL) return no("cell too long");
      row.push(md);
    }
    out.push(row);
  }
  // Column alignment: what all body cells agree on (header cells are often centred by the style).
  const body = grid.slice(1);
  const aligns: Align[] = Array.from({ length: cols }, (_v, c) => {
    const src = body.length ? body.map((r) => cellAlign(r[c])) : [cellAlign(grid[0][c])];
    return src.every((a) => a === src[0]) ? src[0] : "";
  });
  return { simple: true, model: { aligns, rows: out }, header };
}

// ---------------------------------------------------------------------------------------------------------------
// markdown side

const SEP: Record<Align, string> = { "": "---", l: ":---", c: ":---:", r: "---:" };

/** Markdown lines of a table (no marker). */
export function modelToLines(m: TableModel): string[] {
  const line = (cells: string[]) => `| ${cells.map((c) => (c === "" ? " " : c)).join(" | ")} |`.replace(/\|  \|/g, "|  |");
  return [line(m.rows[0]), `| ${m.aligns.map((a) => SEP[a]).join(" | ")} |`, ...m.rows.slice(1).map(line)];
}

export interface TableBlock {
  /** Character range in the scanned text, including the marker line (if any). */
  start: number;
  end: number;
  id?: string;
  model: TableModel;
  /** Rows shorter than the header that were padded with empty cells. */
  padded: number;
  /** Set when the block is a table the editor cannot apply losslessly (the apply must refuse). */
  error?: string;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      cur += c + s[i + 1];
      i++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  // a trailing `|` closes the last cell; text after the last pipe is one more cell
  if (cur.trim() !== "" || !s.trimEnd().endsWith("|")) cells.push(cur.trim());
  return cells;
}

const DELIM_CELL = /^:?-+:?$/;

/** Find GFM tables (and the marker line directly above them) in markdown source. Skips fenced code. */
export function findTableBlocks(src: string): TableBlock[] {
  const lines: { text: string; start: number; end: number }[] = [];
  for (let pos = 0; pos <= src.length; ) {
    let nl = src.indexOf("\n", pos);
    if (nl < 0) nl = src.length;
    lines.push({ text: src.slice(pos, nl).replace(/\r$/, ""), start: pos, end: nl });
    pos = nl + 1;
  }
  const out: TableBlock[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(t);
    if (f) {
      const mark = f[1][0].repeat(3);
      if (fence === null) fence = mark;
      else if (fence === mark) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const marker = TABLE_MARKER_RE.exec(t);
    const hi = marker ? i + 1 : i;
    const head = lines[hi]?.text;
    const sepLine = lines[hi + 1]?.text;
    if (head === undefined || sepLine === undefined || !head.includes("|") || !/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(sepLine) || !sepLine.includes("-")) {
      if (marker) {
        // a marker that is not followed by a table: the table was damaged or removed
        out.push({ start: lines[i].start, end: lines[i].end, id: marker[1], model: { aligns: [], rows: [] }, padded: 0, error: "orphan" });
      }
      continue;
    }
    const header = splitRow(head);
    const delim = splitRow(sepLine);
    if (delim.length !== header.length || !delim.every((d) => DELIM_CELL.test(d))) {
      if (marker) out.push({ start: lines[i].start, end: lines[hi + 1].end, id: marker[1], model: { aligns: [], rows: [] }, padded: 0, error: "separator" });
      continue;
    }
    const aligns = delim.map<Align>((d) => (d.startsWith(":") && d.endsWith(":") ? "c" : d.endsWith(":") ? "r" : d.startsWith(":") ? "l" : ""));
    const rows = [header];
    let j = hi + 2;
    let padded = 0;
    let error: string | undefined;
    for (; j < lines.length; j++) {
      const rt = lines[j].text;
      if (rt.trim() === "" || !rt.includes("|")) break;
      const cells = splitRow(rt);
      if (cells.length > header.length) error = `ragged:${rows.length + 1}`;
      else if (cells.length < header.length) {
        padded++;
        while (cells.length < header.length) cells.push("");
      }
      rows.push(cells.slice(0, header.length));
    }
    out.push({ start: lines[i].start, end: lines[j - 1].end, id: marker?.[1], model: { aligns, rows }, padded, error });
    i = j - 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// markdown cell -> OOXML runs

const cellMd = new MarkdownIt({ html: false, linkify: false });
const xesc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Runs for one cell's markdown. `base` is the run-property markup to start from (font, size, ...). */
export function inlineToRuns(md: string, base = "", bold = false, options: {htmlBreaks?: boolean} = {}): string {
  const text = options.htmlBreaks === false ? md : md.replace(/<br\s*\/?>/gi, "\n");
  const tokens = cellMd.parseInline(text, {});
  const kids = tokens[0]?.children ?? [];
  let b = bold ? 1 : 0, i = 0, s = 0;
  let link = "";
  let out = "";
  const rpr = (extra = "") => {
    const inner = `${base}${b ? "<w:b/>" : ""}${i ? "<w:i/>" : ""}${s ? "<w:strike/>" : ""}${extra}`;
    return inner ? `<w:rPr>${inner}</w:rPr>` : "";
  };
  const run = (t: string, extra = "") => `<w:r>${rpr(extra)}<w:t xml:space="preserve">${xesc(t)}</w:t></w:r>`;
  const push = (x: string) => {
    out += x;
  };
  for (const k of kids) {
    switch (k.type) {
      case "text":
      case "image":
        if (k.content) push(link ? linkRun(link, run(k.content, '<w:color w:val="0563C1"/><w:u w:val="single"/>')) : run(k.content));
        break;
      case "code_inline":
        push(run(k.content, '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'));
        break;
      case "softbreak":
      case "hardbreak":
        push("<w:r><w:br/></w:r>");
        break;
      case "strong_open": b++; break;
      case "strong_close": b = Math.max(bold ? 1 : 0, b - 1); break;
      case "em_open": i++; break;
      case "em_close": i--; break;
      case "s_open": s++; break;
      case "s_close": s--; break;
      case "link_open": {
        const href = String(k.attrGet("href") ?? "");
        link = /^(https?:|mailto:)/i.test(href) ? href : "";
        break;
      }
      case "link_close": link = ""; break;
      default:
        if (k.content) push(run(k.content));
    }
  }
  return out;
}

const linkRun = (href: string, runs: string) => `<w:fldSimple w:instr=" HYPERLINK &quot;${xesc(href)}&quot; ">${runs}</w:fldSimple>`;

// ---------------------------------------------------------------------------------------------------------------
// rebuilding a table

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name && c.namespaceURI === W);
const first = (el: Element, name: string) => kids(el, name)[0];

function parseTbl(raw: string): { doc: Document; tbl: Element } | null {
  const doc = new DOMParser().parseFromString(`<root ${OMML_PKG_NAMESPACES}>${raw}</root>`, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return null;
  const tbl = doc.documentElement.firstElementChild;
  return tbl && tbl.localName === "tbl" ? { doc, tbl } : null;
}

function stripIds(el: Element) {
  for (const e of [el, ...Array.from(el.querySelectorAll("*"))]) {
    e.removeAttributeNS(W14, "paraId");
    e.removeAttributeNS(W14, "textId");
    for (const a of Array.from(e.attributes)) if (a.namespaceURI === W && a.localName.startsWith("rsid")) e.removeAttributeNS(W, a.localName);
  }
}

const FORMAT_TOGGLES = new Set(["b", "bCs", "i", "iCs", "strike", "dstrike", "u", "rStyle", "color", "vertAlign", "shd", "highlight"]);

/** The cell's first run properties without the toggles the markdown controls (bold, italic, ...). */
function baseRPr(cell: Element): { base: string; bold: boolean } {
  const run = cell.getElementsByTagNameNS(W, "r")[0];
  const rPr = run ? first(run, "rPr") : undefined;
  if (!rPr) return { base: "", bold: false };
  const bold = !!first(rPr, "b");
  const ser = new XMLSerializer();
  const base = Array.from(rPr.children)
    .filter((c) => !FORMAT_TOGGLES.has(c.localName))
    .map((c) => ser.serializeToString(c))
    .join("");
  return { base, bold };
}

function setText(cell: Element, md: string, align: Align, headerBold: boolean) {
  const doc = cell.ownerDocument;
  const paras = kids(cell, "p");
  const p0 = paras[0];
  const { base } = baseRPr(cell);
  const pPr = p0 ? first(p0, "pPr") : undefined;
  const ser = new XMLSerializer();
  let ppr = pPr ? Array.from(pPr.children).filter((c) => c.localName !== "jc").map((c) => ser.serializeToString(c)).join("") : "";
  if (align) ppr += `<w:jc w:val="${align === "c" ? "center" : align === "r" ? "right" : "left"}"/>`;
  const xml = `<w:p xmlns:w="${W}">${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${inlineToRuns(md, base, headerBold)}</w:p>`;
  const frag = new DOMParser().parseFromString(xml, "application/xml").documentElement;
  for (const p of paras) p.remove();
  cell.append(doc.importNode(frag, true));
}

export interface BuildResult {
  xml: string;
}

/**
 * Build the OOXML of `model`. With the table's original OOXML (`rawOriginal`) as template, kept: table properties
 * (style, width, borders, indent, look), the grid widths, row properties (header flag, height), cell properties
 * (shading, borders, margins, vertical alignment), paragraph properties and the base font of each cell, and every cell
 * whose markdown text did not change is reused untouched (all its formatting). Replaced cells keep their cell/paragraph
 * properties and font but only carry formatting that markdown can express (bold, italic, strike, code, links).
 * New rows/columns are cloned from the last row/column. Without a template a plain bordered table with a bold
 * header row is created. Cell text is never dropped.
 */
export function buildTableOoxml(rawOriginal: string | null, model: TableModel, original?: TableModel): BuildResult {
  const rows = model.rows;
  const cols = rows[0].length;
  const parsed = rawOriginal ? parseTbl(rawOriginal) : null;
  const ser = new XMLSerializer();
  if (!parsed) {
    const w = Math.floor(9000 / cols);
    const border = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
    const tr = (r: string[], ri: number) =>
      `<w:tr>${ri === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${r
        .map((c, ci) => {
          const al = model.aligns[ci];
          const body = inlineToRuns(c, "", ri === 0);
          return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr><w:p>${al ? `<w:pPr><w:jc w:val="${al === "c" ? "center" : al === "r" ? "right" : "left"}"/></w:pPr>` : ""}${body}</w:p></w:tc>`;
        })
        .join("")}</w:tr>`;
    return {
      xml:
        `<w:tbl><w:tblPr><w:tblW w:w="${w * cols}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
        `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
        `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows.map(tr).join("")}</w:tbl>`,
    };
  }
  const { doc, tbl } = parsed;
  const origTrs = kids(tbl, "tr");
  const origGrid = first(tbl, "tblGrid");
  const origCols = origGrid ? kids(origGrid, "gridCol").length : kids(origTrs[0], "tc").length;
  const newTrs: Element[] = [];
  for (let r = 0; r < rows.length; r++) {
    const srcTr = origTrs[Math.min(r, origTrs.length - 1)];
    const tr = srcTr.cloneNode(true) as Element;
    if (r >= origTrs.length) stripIds(tr);
    const srcCells = kids(srcTr, "tc");
    const cells = kids(tr, "tc");
    for (const c of cells) c.remove();
    for (let c = 0; c < cols; c++) {
      const src = srcCells[Math.min(c, srcCells.length - 1)];
      const reuse = r < origTrs.length && c < origCols && !!original && original.rows[r]?.[c] === rows[r][c] && original.aligns[c] === model.aligns[c];
      const cell = src.cloneNode(true) as Element;
      if (!reuse || r >= origTrs.length || c >= origCols) stripIds(cell);
      if (!reuse) {
        const headerBold = r === 0 && baseRPr(srcCells[Math.min(c, srcCells.length - 1)]).bold;
        setText(cell, rows[r][c], model.aligns[c], headerBold);
      }
      if (c >= origCols && origGrid) {
        const lastW = kids(origGrid, "gridCol").at(-1)?.getAttributeNS(W, "w") ?? "1000";
        const tcW = first(first(cell, "tcPr") ?? cell, "tcW");
        tcW?.setAttributeNS(W, "w:w", lastW);
      }
      tr.append(cell);
    }
    newTrs.push(tr);
  }
  for (const t of origTrs) t.remove();
  for (const t of newTrs) tbl.append(t);
  if (origGrid) {
    const g = kids(origGrid, "gridCol");
    const lastW = g.at(-1)?.getAttributeNS(W, "w") ?? "1000";
    while (kids(origGrid, "gridCol").length > cols) kids(origGrid, "gridCol").at(-1)!.remove();
    for (let c = kids(origGrid, "gridCol").length; c < cols; c++) {
      const gc = doc.createElementNS(W, "w:gridCol");
      gc.setAttributeNS(W, "w:w", lastW);
      origGrid.append(gc);
    }
    const tblW = first(first(tbl, "tblPr")!, "tblW");
    if (tblW?.getAttributeNS(W, "type") === "dxa") {
      const sum = kids(origGrid, "gridCol").reduce((n, g) => n + Number(g.getAttributeNS(W, "w")), 0);
      tblW.setAttributeNS(W, "w:w", String(sum));
    }
  }
  let xml = ser.serializeToString(tbl);
  // Some serializers rename prefixes (ns1:paraId); map them back by namespace URI.
  const known: Record<string, string> = { [W]: "w", [W14]: "w14", "http://schemas.openxmlformats.org/officeDocument/2006/math": "m", "http://schemas.openxmlformats.org/officeDocument/2006/relationships": "r" };
  for (const m of Array.from(xml.matchAll(/\sxmlns:(ns\d+)="([^"]*)"/g))) {
    const prefix = known[m[2]];
    if (prefix) xml = xml.replace(new RegExp(`\\b${m[1]}:`, "g"), prefix + ":");
  }
  // the namespaces are declared by the insertion package
  xml = xml.replace(/\sxmlns:(?:w|m|r|mc|w14|ns\d+)="[^"]*"/g, "");
  return { xml };
}

/** Is the (already parsed) table `model` the same text as what we stored for it at load? */
export const sameModel = (a: TableModel, b: TableModel) =>
  a.rows.length === b.rows.length &&
  a.aligns.join("") === b.aligns.join("") &&
  a.rows.every((r, i) => r.length === b.rows[i].length && r.every((c, j) => c === b.rows[i][j]));

