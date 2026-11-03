import type { Sidecar } from "./sidecar";

/** Stable 8-hex-digit id (FNV-1a) so the same object always gets the same id. */
export function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Decide whether a top-level block has no faithful markdown form.
 * Returns the object kind (lowercase letters only) or null if it can be edited as markdown.
 */
export function classifyOpaque(el: Element): string | null {
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
  for (const m of html.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const name = /mso-style-name:\s*"?([^";]+?)"?\s*(?:;|$)/.exec(m[2])?.[1];
    if (!name) continue;
    for (const c of m[1].matchAll(/\.([\w-]+)/g)) map.set(c[1], name);
  }
  return map;
}

/** Paragraph classes that need no marker: Word's default style and list paragraphs (turned into md lists). */
const isDefaultParagraphClass = (cls: string) => cls === "" || cls === "MsoNormal" || cls.startsWith("MsoList");
/**
 * getHtml output contains per-call noise: images get a temp name (~WRS{GUID}.files/...) and Word
 * assigns fresh paragraph GUID ids. Strip both so an object keeps the same placeholder id across loads/applies.
 */
export function stableHtml(html: string): string {
  return html
    .replace(/~WRS%7b[0-9a-f-]+%7d/gi, "~WRS")
    .replace(/\sid=(["']?)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\1/gi, "");
}

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
  let cur: Element | null = null;
  let curTag = "";
  for (const el of Array.from(parent.children)) {
    const m = el.tagName === "P" ? /MsoList(Bullet|Number)/.exec(el.className) : null;
    if (!m) {
      cur = null;
      continue;
    }
    const tag = m[1] === "Number" ? "ol" : "ul";
    const marker = Array.from(el.children).find(
      (c) => c.tagName === "SPAN" && (/Wingdings|Symbol|mso-list:\s*Ignore/i.test(c.getAttribute("style") ?? "") || c.querySelector('span[style*="7.0pt"]')),
    );
    marker?.remove();
    if (!cur || curTag !== tag) {
      cur = doc.createElement(tag);
      curTag = tag;
      el.before(cur);
    }
    const li = doc.createElement("li");
    li.innerHTML = el.innerHTML;
    cur.append(li);
    el.remove();
  }
}

/** Replace opaque top-level blocks with a text token and stash their original HTML in the sidecar. */
export function protectOpaque(
  bodyHtml: string,
  sidecar: Sidecar,
  styleNames: Map<string, string> = new Map(),
  /** Base64 image data (document order) from Office.js; replaces the temp `~WRS...` src that getHtml emits. */
  images: string[] = [],
): string {
  const doc = new DOMParser().parseFromString(`<body>${bodyHtml}</body>`, "text/html");
  const imgs = Array.from(doc.body.querySelectorAll("img"));
  const embed = images.length > 0 && images.length === imgs.length; // only trust a 1:1 match
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
      const id = hashId(stableHtml(el.outerHTML));
      if (embed) {
        const inner = el.tagName === "IMG" ? [el] : Array.from(el.querySelectorAll("img"));
        for (const img of inner) img.setAttribute("src", toDataUri(images[imgIndex++]));
      }
      const html = el.outerHTML;
      sidecar.set(id, { kind, html });
      const p = doc.createElement("p");
      p.textContent = `OWBOBJ${id}K${kind}END`;
      el.replaceWith(p);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** Turn the tokens that survived HTML->markdown conversion into visible placeholder comments. */
export function tokensToPlaceholders(md: string): string {
  return md
    .replace(TOKEN_RE, (_m, id: string, kind: string) => `<!-- word:obj id=${id} kind=${kind} -->`)
    .replace(STYLE_TOKEN_RE, (_m, cls: string, name: string) => styleMarker(fromHex(cls), fromHex(name)));
}
