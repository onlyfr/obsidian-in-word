/**
 * Math rendering behind Obsidian's `loadMathJax()` / `renderMath()` / `finishRenderMath()`.
 * Temml (MIT) turns LaTeX into native MathML; it is loaded lazily with a dynamic import so the main bundle does not
 * grow. If it cannot be loaded the LaTeX source is shown as text (and the caller can report that). Never throws.
 */

type TemmlLike = {
  renderToString(tex: string, options?: Record<string, unknown>): string;
};

export type MathStatus = "idle" | "loading" | "ready" | "fallback";

export interface MathImporter {
  temml: () => Promise<TemmlLike>;
  css: () => Promise<string>;
}

const defaultImporter: MathImporter = {
  temml: async () => {
    const m = (await import("temml")) as unknown as { default?: TemmlLike } & TemmlLike;
    return m.default ?? m;
  },
  css: async () => (await import("temml/dist/Temml-Local.css?inline")).default as string,
};

const MATHML_TAGS = new Set([
  "math", "mrow", "mi", "mn", "mo", "mtext", "mspace", "ms", "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot",
  "munder", "mover", "munderover", "mtable", "mtr", "mtd", "mlabeledtr", "mpadded", "mphantom", "mstyle", "menclose",
  "semantics", "annotation", "mmultiscripts", "mprescripts", "none", "merror",
]);
const MATHML_ATTRS = new Set([
  "class", "style", "mathvariant", "displaystyle", "scriptlevel", "stretchy", "fence", "separator", "lspace", "rspace",
  "form", "accent", "accentunder", "movablelimits", "symmetric", "largeop", "minsize", "maxsize", "width", "height",
  "depth", "voffset", "columnalign", "rowalign", "columnspacing", "rowspacing", "columnlines", "rowlines", "frame",
  "framespacing", "linethickness", "notation", "display", "xmlns", "dir", "mathsize", "mathcolor", "mathbackground",
  "columnspan", "rowspan", "encoding", "scriptminsize", "scriptsizemultiplier", "subscriptshift", "superscriptshift",
]);
const BAD_STYLE = /url\s*\(|expression\s*\(|javascript:|@import|\\|<|>/i;

function cleanStyle(style: string): string {
  return style
    .split(";")
    .map((d) => d.trim())
    .filter((d) => /^[a-z-]+\s*:/i.test(d) && !BAD_STYLE.test(d))
    .join(";");
}

/** Keep only MathML elements/attributes; drops scripts, event handlers, links, anything unknown. */
export function sanitizeMathML(markup: string): string {
  const doc = new DOMParser().parseFromString(`<body>${markup}</body>`, "text/html");
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      const name = c.localName.toLowerCase();
      if (!MATHML_TAGS.has(name)) {
        c.remove();
        continue;
      }
      for (const a of Array.from(c.attributes)) {
        const n = a.name.toLowerCase();
        if (!MATHML_ATTRS.has(n) || n.startsWith("on")) c.removeAttribute(a.name);
        else if (n === "style") {
          const s = cleanStyle(a.value);
          s ? c.setAttribute("style", s) : c.removeAttribute("style");
        } else if (n === "class" && !/^[\w\- ]*$/.test(a.value)) c.removeAttribute("class");
      }
      walk(c);
    }
  };
  walk(doc.body);
  // Only <math> roots are allowed at the top level.
  for (const c of Array.from(doc.body.childNodes)) {
    if (c.nodeType === 3) continue;
    if (!(c instanceof Element) || c.localName.toLowerCase() !== "math") c.remove();
  }
  return doc.body.innerHTML;
}

/** The bundled font is only for \mathscr; it is never fetched. */
const stripFontFace = (css: string) => css.replace(/@font-face\s*\{[^}]*\}/g, "");

/** `\class{name}{...}` (used by plugins to mark the cursor/highlight) is the only trusted command, with a plain name. */
const trust = (ctx: { command?: string; class?: string }) => ctx.command === "\\class" && /^[\w-]+$/.test(ctx.class ?? "");

export class MathRenderer {
  status: MathStatus = "idle";
  error?: string;
  private temml: TemmlLike | null = null;
  private loading: Promise<boolean> | null = null;
  private readonly cache = new Map<string, { html?: string; err?: string }>();

  constructor(
    private readonly importer: MathImporter = defaultImporter,
    private readonly maxCache = 300,
  ) {}

  /** Load Temml (once). Resolves true when ready, false when the source-text fallback is in use. */
  load(): Promise<boolean> {
    if (this.status === "ready") return Promise.resolve(true);
    this.loading ??= (async () => {
      this.status = "loading";
      try {
        this.temml = await this.importer.temml();
        try {
          const css = await this.importer.css();
          this.injectCss(css);
          this.cssText = stripFontFace(css);
        } catch {
          /* styles are optional: MathML renders without them */
        }
        this.status = "ready";
        this.cache.clear();
        return true;
      } catch (e) {
        this.status = "fallback";
        this.error = (e as Error)?.message ?? String(e);
        this.loading = null; // allow a later retry
        return false;
      }
    })();
    return this.loading;
  }

  private injectCss(css: string): void {
    if (document.getElementById("owb-temml-css")) return;
    const el = document.createElement("style");
    el.id = "owb-temml-css";
    // The bundled font is only for \mathscr; do not fetch it.
    el.textContent = stripFontFace(css);
    document.head.append(el);
  }

  private cssText = "";

  /** Temml's stylesheet without the web-font rule (for rendering MathML into a picture, see convert/mathraster.ts). */
  get css(): string {
    return this.cssText;
  }

  /** Sanitized MathML for `source` (or the error), once {@link load} succeeded. Never throws. */
  mathml(source: string, display: boolean): { html?: string; err?: string } {
    if (this.status !== "ready") return { err: "math renderer not loaded" };
    return this.convert(source, display);
  }

  private convert(source: string, display: boolean): { html?: string; err?: string } {
    const key = `${display ? 1 : 0}:${source}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key); // refresh recency
      this.cache.set(key, hit);
      return hit;
    }
    let res: { html?: string; err?: string };
    try {
      res = { html: sanitizeMathML(this.temml!.renderToString(source, { displayMode: display, throwOnError: true, trust, strict: false })) };
    } catch (e) {
      res = { err: (e as Error)?.message ?? String(e) };
    }
    this.cache.set(key, res);
    if (this.cache.size > this.maxCache) this.cache.delete(this.cache.keys().next().value as string);
    return res;
  }

  /**
   * Obsidian's `renderMath(source, display)`: a container element (`span.math.math-inline` / `div.math.math-block`).
   * Before Temml is ready, or when it failed to load, the source is shown as text.
   */
  render(source: string, display: boolean): HTMLElement {
    const el = document.createElement(display ? "div" : "span");
    el.className = `math ${display ? "math-block" : "math-inline"}`;
    if (this.status !== "ready") {
      el.textContent = source;
      void this.load(); // later renders get real math
      return el;
    }
    const r = this.convert(source, display);
    if (r.html !== undefined) {
      el.innerHTML = r.html; // sanitized MathML only
      el.classList.add("is-loaded");
    } else {
      el.classList.add("math-error");
      el.title = r.err ?? "math error";
      el.textContent = source;
    }
    return el;
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}

export const mathRenderer = new MathRenderer();
