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
export function protectOpaque(bodyHtml: string, sidecar: Sidecar): string {
  const doc = new DOMParser().parseFromString(`<body>${bodyHtml}</body>`, "text/html");
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
      if (!kind) continue;
      const html = el.outerHTML;
      const id = hashId(html);
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
  return md.replace(TOKEN_RE, (_m, id: string, kind: string) => `<!-- word:obj id=${id} kind=${kind} -->`);
}
