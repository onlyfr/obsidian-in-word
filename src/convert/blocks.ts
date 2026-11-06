import type { Sidecar } from "./sidecar";
import { normalizeInlineFormatting } from "./inline-format";

/** Stable 8-hex-digit id (FNV-1a) so the same object always gets the same id. */
export function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const ABSOLUTE_RE = /position:\s*absolute/i;

/** Attribute set on a paragraph holding an equation that has no LaTeX form; value = index into the OOXML packages. */
export const EQ_ATTR = "data-owb-eq";

/** A picture that floats (anchored with wrapping): `<img align=left|right>` or inside a `position:absolute` span. */
export function isFloatingImg(img: Element): boolean {
  if (/^(left|right)$/i.test(img.getAttribute("align") ?? "")) return true;
  for (let e: Element | null = img; e && e.tagName !== "BODY"; e = e.parentElement) {
    if (ABSOLUTE_RE.test(e.getAttribute("style") ?? "")) return true;
  }
  return false;
}

/**
 * True if `el` (or anything inside it) is a floating object as real Word getHtml renders them:
 * square-wrapped pictures are `<img align=left hspace=12>`; behind/in-front pictures, text boxes and shapes are
 * `<span style='position:absolute;z-index;margin-left;margin-top'><img alt=...></span>`.
 */
export function hasFloating(el: Element): boolean {
  if (ABSOLUTE_RE.test(el.getAttribute("style") ?? "")) return true;
  for (const d of Array.from(el.querySelectorAll("[style]"))) if (ABSOLUTE_RE.test(d.getAttribute("style") ?? "")) return true;
  return Array.from(el.querySelectorAll("img")).some(isFloatingImg) || (el.tagName === "IMG" && isFloatingImg(el));
}

export interface FloatBlock {
  /** "p" for a paragraph with a floating object, "table" for a (top-level) table containing one. */
  tag: "p" | "table";
  /** Whitespace-normalized text of the block, used to find the matching Office.js paragraph. */
  text: string;
  /** For tables: index among all top-level tables of the selection. */
  tableIndex: number;
}

export const normText = (s: string) => s.replace(/[\s ]+/g, " ").trim();

/** Top-level blocks that contain floating objects, in document order (same order protectOpaque consumes them). */
export function findFloatingInDoc(doc: Document): FloatBlock[] {
  const out: FloatBlock[] = [];
  let tables = 0;
  const walk = (parent: Element): void => {
    for (const el of Array.from(parent.children)) {
      if (el.tagName === "DIV" && /^WordSection/i.test(el.className)) {
        walk(el);
        continue;
      }
      const isTable = el.tagName === "TABLE";
      const tableIndex = isTable ? tables++ : -1;
      if (hasFloating(el)) out.push({ tag: isTable ? "table" : "p", text: normText(el.textContent ?? ""), tableIndex });
    }
  };
  walk(doc.body);
  return out;
}

/**
 * Decide whether a top-level block has no faithful markdown form.
 * Returns the object kind (lowercase letters only) or null if it can be edited as markdown.
 */
export function classifyOpaque(el: Element): string | null {
  if (hasFloating(el)) return "float";
  if (el.hasAttribute(EQ_ATTR) || el.querySelector(`[${EQ_ATTR}]`)) return "equation";
  const tag = el.tagName.toLowerCase();
  if (tag === "table") return "table";
  if (tag === "svg" || tag === "figure" || tag === "object") return "drawing";
  if (tag === "img") return "image";
  if (el.querySelector("table")) return "table";
  if (el.querySelector("ins, del")) return "tracked";
  if (el.querySelector('a[href^="#_ftn"], a[name^="_ftn"], a[href^="#_edn"]')) return "footnote";
  if (el.querySelector('[style*="mso-element:field"], [style*="mso-field"]')) return "field";
  if (el.querySelector("img")) return "image";
  if (el.querySelector("svg, object, canvas")) return "drawing";
  // Namespaced tags such as <v:shape>, <w:sdt>, <m:oMath> are Word-only content.
  for (const d of Array.from(el.querySelectorAll("*"))) {
    if (d.tagName.includes(":")) return "object";
  }
  return null;
}

const TOKEN_RE = /^OWBOBJ([0-9a-f]{8})K([a-z]+)END$/gm;
const STYLE_TOKEN_RE = /^OWBSTYLE([0-9a-f]*)N([0-9a-f]*)END$/gm;
/** `<!-- word:style class=a3 name=%EB%B3%B8... -->`: the Word paragraph style of the next paragraph. */
export const STYLE_MARKER_RE = /^<!-- word:style class=([\w-]+) name=(\S+) -->\s*$/;

const toHex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => new TextDecoder().decode(Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16)));

export const styleMarker = (cls: string, name: string) =>
  `<!-- word:style class=${cls} name=${encodeURIComponent(name)} -->`;

/** Map CSS class -> Word style name from the `<style>` block of Word's getHtml output (`mso-style-name`). */
export function parseStyleNames(html: string): Map<string, string> {
  const map = new Map<string, string>();
  // Only look inside <style> blocks: running the rule regex over the whole document is quadratic, because every
  // start position of a long brace-free run (i.e. all of the body text) is scanned to its end before failing.
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const m of block[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const name = /mso-style-name:\s*"?([^";]+?)"?\s*(?:;|$)/.exec(m[2])?.[1];
      if (!name) continue;
      for (const c of m[1].matchAll(/\.([\w-]+)/g)) map.set(c[1], name);
    }
  }
  return map;
}

/** Paragraph classes that need no marker: Word's default style and list paragraphs (turned into md lists). */
const isDefaultParagraphClass = (cls: string) => cls === "" || cls === "MsoNormal";
/**
 * getHtml output contains per-call noise: images get a temp name (~WRS{GUID}.files/...) and Word
 * assigns fresh paragraph GUID ids. Strip both so an object keeps the same placeholder id across loads/applies.
 */
export function stableHtml(html: string): string {
  return html
    .replace(/~WRS%7b[0-9a-f-]+%7d/gi, "~WRS")
    .replace(/\sid=(["']?)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\1/gi, "");
}

/** 1x1 transparent PNG used when a picture's bytes cannot be read through Office.js (e.g. floating pictures). */
export const BLANK_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** Base64 image data -> data URI (format sniffed from the magic bytes). */
export function toDataUri(b64: string): string {
  if (b64.startsWith("data:")) return b64;
  const mime = b64.startsWith("/9j/") ? "image/jpeg" : b64.startsWith("R0lGOD") ? "image/gif" : "image/png";
  return `data:${mime};base64,${b64}`;
}

/** Ids of all `<!-- word:obj id=... -->` placeholders in a markdown string. */
export function placeholderIds(markdown: string): Set<string> {
  return new Set(Array.from(markdown.matchAll(/<!-- word:obj id=([0-9a-f]{8}) kind=[a-z]+ -->/g), (m) => m[1]));
}

export const PLACEHOLDER_SPLIT_RE = /^<!-- word:obj id=([0-9a-f]{8}) kind=([a-z]+) -->[ \t]*$/m;

/**
 * Word's getHtml renders lists as `<p class=MsoListBullet...>` with a Wingdings marker span instead of
 * <ul>/<li>. Rebuild real lists (dropping the marker) so they convert to markdown list items.
 */
function normalizeLists(parent: Element): void {
  const doc = parent.ownerDocument;
  const items = Array.from(parent.children).map((el) => ({ el, marker: listMarker(el) }));
  let group: { el: Element; marker: Element }[] = [];
  const flush = () => {
    if (group.length) buildLists(doc, group);
    group = [];
  };
  for (const it of items) {
    if (it.marker) group.push({ el: it.el, marker: it.marker });
    else flush();
  }
  flush();
}

/** The bullet/number span at the start of a Word list paragraph, or undefined if `el` is not a list item. */
function listMarker(el: Element): Element | undefined {
  if (el.tagName !== "P" || !/^MsoList/.test(el.className)) return undefined;
  return Array.from(el.children).find(
    (c) =>
      c.tagName === "SPAN" &&
      (/Wingdings|Symbol|mso-list:\s*Ignore/i.test(c.getAttribute("style") ?? "") || c.querySelector('span[style*="7.0pt"]')),
  );
}

const marginLeft = (el: Element) => Number(/margin-left:\s*([\d.]+)pt/i.exec(el.getAttribute("style") ?? "")?.[1] ?? 0);

/**
 * Real Word shape (getHtml): consecutive `<p class=MsoListBullet.../MsoListNumber.../MsoListParagraph>` whose
 * nesting level is only visible in `margin-left`, with the marker text ("3.", "1)", "·") in a leading span.
 * Rebuild nested <ul>/<ol>/<li> (ordered lists keep their start number).
 */
function buildLists(doc: Document, group: { el: Element; marker: Element }[]): void {
  const margins = [...new Set(group.map((g) => marginLeft(g.el)))].sort((a, b) => a - b);
  const stack: { list: Element; level: number; ordered: boolean }[] = [];
  const anchor = group[0].el;
  let lastTop: Element | null = null; // previous top-level list built for this group
  for (const { el, marker } of group) {
    const level = margins.indexOf(marginLeft(el));
    const markerText = (marker.firstChild?.textContent ?? marker.textContent ?? "").replace(/\s| /g, "");
    const ordered = /^[0-9a-zA-Z]+[.)]$/.test(markerText);
    marker.remove();
    while (stack.length && stack[stack.length - 1].level > level) stack.pop();
    // Same level but another list type (bullet <-> number) starts a new sibling list.
    if (stack.length && stack[stack.length - 1].level === level && stack[stack.length - 1].ordered !== ordered) stack.pop();
    if (!stack.length || stack[stack.length - 1].level < level) {
      const list = doc.createElement(ordered ? "ol" : "ul");
      const start = ordered ? parseInt(markerText, 10) : NaN;
      if (start > 1) list.setAttribute("start", String(start));
      const host = stack.length ? stack[stack.length - 1].list.lastElementChild : null;
      if (host) host.append(list);
      else {
        if (lastTop) lastTop.after(list);
        else anchor.before(list);
        lastTop = list;
        // List Bullet / List Number are not the default list style (List Paragraph): remember them with a marker.
        const base = /^(MsoList(?:Bullet|Number)\d?)/.exec(el.className)?.[1];
        if (base) {
          const mk = doc.createElement("p");
          mk.textContent = `OWBSTYLE${toHex(base)}N${toHex(base)}END`;
          list.before(mk);
        }
      }
      stack.push({ list, level, ordered });
    }
    const li = doc.createElement("li");
    li.innerHTML = el.innerHTML;
    stack[stack.length - 1].list.append(li);
    el.remove();
  }
}

export interface FloatReport {
  total: number;
  preserved: number;
}

/** Replace opaque top-level blocks with a text token and stash their original HTML in the sidecar. */
export function protectOpaque(
  bodyHtml: string,
  sidecar: Sidecar,
  styleNames: Map<string, string> = new Map(),
  /** Base64 image data (document order) from Office.js; replaces the temp `~WRS...` src that getHtml emits. */
  images?: string[],
  /** OOXML (document order, aligned with findFloatingInDoc) for blocks that contain floating objects. */
  floatOoxml?: (string | undefined)[],
  /** Out: how many floating blocks were found / could be preserved losslessly. */
  report?: FloatReport,
  /** gz OOXML packages of paragraphs with unconvertible equations (indexed by the `data-owb-eq` attribute). */
  eqPackages: { pkg: string; count: number }[] = [],
): string {
  const doc = new DOMParser().parseFromString(`<body>${bodyHtml}</body>`, "text/html");
  // Floating pictures are not part of Office.js inlinePictures, so only inline ones are paired with image bytes.
  const isFloating = isFloatingImg;
  const inlineCount = Array.from(doc.body.querySelectorAll("img")).filter((i) => !isFloating(i)).length;
  let floatIndex = 0;
  const embed = images !== undefined && images.length === inlineCount; // only trust a 1:1 match
  let imgIndex = 0;
  // Word wraps content in <div class="WordSection1">; look inside plain divs so that one table
  // does not make the whole section opaque.
  const walk = (parent: Element): void => {
    normalizeLists(parent);
    for (const el of Array.from(parent.children)) {
      if (el.tagName === "DIV" && /^WordSection/i.test(el.className)) {
        walk(el);
        continue;
      }
      const kind = classifyOpaque(el);
      if (!kind) {
        const cls = el.tagName === "P" ? el.className.trim() : "";
        if (cls && !isDefaultParagraphClass(cls) && /^[\w-]+$/.test(cls)) {
          const marker = doc.createElement("p");
          marker.textContent = `OWBSTYLE${toHex(cls)}N${toHex(styleNames.get(cls) ?? cls)}END`;
          el.before(marker);
        }
        continue;
      }
      const eqIdx = el.getAttribute(EQ_ATTR) ?? el.querySelector(`[${EQ_ATTR}]`)?.getAttribute(EQ_ATTR);
      const stable = stableHtml(el.outerHTML)
        .replace(new RegExp(`\\s${EQ_ATTR}="\\d+"`, "g"), "")
        .replace(/OWBEQ\d+END/g, "OWBEQ");
      const id = hashId(kind === "equation" ? stable + (eqPackages[Number(eqIdx)]?.pkg ?? "") : stable);
      if (images !== undefined) {
        const inner = el.tagName === "IMG" ? [el] : Array.from(el.querySelectorAll("img"));
        for (const img of inner) {
          // The temp ~WRS src does not survive (restoring it hangs Word on the next getHtml), so never keep it.
          const bytes = embed && !isFloating(img) ? images[imgIndex++] : undefined;
          img.setAttribute("src", bytes ? toDataUri(bytes) : BLANK_PNG);
          if (!bytes) img.setAttribute("alt", "picture not preserved");
        }
      }
      const html = el.outerHTML.replace(new RegExp(`\\s${EQ_ATTR}="\\d+"`, "g"), "");
      if (kind === "equation") {
        const pk = eqPackages[Number(eqIdx)];
        sidecar.set(id, pk ? { kind, html, ooxml: pk.pkg, count: pk.count } : { kind, html });
      } else if (kind === "float") {
        const ooxml = floatOoxml?.[floatIndex++];
        if (report) {
          report.total++;
          if (ooxml) report.preserved++;
        }
        sidecar.set(id, ooxml ? { kind, html, ooxml } : { kind, html });
      } else sidecar.set(id, { kind, html });
      const p = doc.createElement("p");
      p.textContent = `OWBOBJ${id}K${kind}END`;
      el.replaceWith(p);
    }
  };
  walk(doc.body);
  normalizeInlineFormatting(doc.body);
  return doc.body.innerHTML;
}

/** Turn the tokens that survived HTML->markdown conversion into visible placeholder comments. */
export function tokensToPlaceholders(md: string): string {
  return md
    .replace(TOKEN_RE, (_m, id: string, kind: string) => `<!-- word:obj id=${id} kind=${kind} -->`)
    .replace(STYLE_TOKEN_RE, (_m, cls: string, name: string) => styleMarker(fromHex(cls), fromHex(name)));
}
