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
export const PLACEHOLDER_SPLIT_RE = /^<!-- word:obj id=([0-9a-f]{8}) kind=([a-z]+) -->[ \t]*$/m;

/** Replace opaque top-level blocks with a text token and stash their original HTML in the sidecar. */
export function protectOpaque(bodyHtml: string, sidecar: Sidecar): string {
  const doc = new DOMParser().parseFromString(`<body>${bodyHtml}</body>`, "text/html");
  for (const el of Array.from(doc.body.children)) {
    const kind = classifyOpaque(el);
    if (!kind) continue;
    const html = el.outerHTML;
    const id = hashId(html);
    sidecar.set(id, { kind, html });
    const p = doc.createElement("p");
    p.textContent = `OWBOBJ${id}K${kind}END`;
    el.replaceWith(p);
  }
  return doc.body.innerHTML;
}

/** Turn the tokens that survived HTML->markdown conversion into visible placeholder comments. */
export function tokensToPlaceholders(md: string): string {
  return md.replace(TOKEN_RE, (_m, id: string, kind: string) => `<!-- word:obj id=${id} kind=${kind} -->`);
}
