/**
 * The real {@link MathRasterizer}: Temml's (sanitized) MathML is put into an SVG `<foreignObject>`, loaded as an image
 * and drawn onto a canvas, then exported as a transparent PNG.
 *
 * Why this and not a pure-SVG renderer: Temml is already in the app (lazy chunk) and the system math font
 * (Cambria Math) is used, so no second renderer / font bundle is needed; an SVG that is loaded as an `<img>` cannot
 * run scripts or fetch resources and does not taint the canvas (measured, see docs/unsupported-syntax.md).
 * Text colour policy: black (#000) on a transparent background, whatever the page colour is.
 *
 * Browser only (DOM + canvas). Never executes plugin/user code: LaTeX goes through the same Temml options and
 * MathML sanitizer as the preview (math-impl.ts). Throws {@link RasterError}.
 */
import { RasterError, type MathRasterizer, type RasterResult } from "./mathimg";

/** Body text size the picture is drawn for: Word's default 11 pt. */
const FONT_PX = (11 * 96) / 72;
const SCALE = 3;
/** Transparent margin around the formula (CSS px), so glyph overhang and `\cancel` strokes are not clipped. */
const PAD = 3;

const XHTML = "http://www.w3.org/1999/xhtml";

function mathElement(html: string, display: boolean): Element {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const math = doc.body.querySelector("math");
  if (!math) throw new RasterError("unsupported", "no <math>");
  // Natural width (no `width:100%` block), but display-style sizing for display math.
  math.removeAttribute("display");
  math.classList.remove("tml-display");
  // Temml puts `display:block math` into the style of display math: lay it out inline instead.
  const style = (math.getAttribute("style") ?? "").replace(/(^|;)\s*display\s*:[^;]*/gi, "$1");
  math.setAttribute("style", `${style};display:inline math;math-style:${display ? "normal" : "compact"};`);
  return math;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new RasterError("error", "the picture could not be loaded"));
    img.src = url;
  });
}

export async function createRasterizer(): Promise<MathRasterizer> {
  const { mathRenderer } = await import("../plugins/math-impl");
  if (!(await mathRenderer.load())) throw new RasterError("unavailable", mathRenderer.error);
  return {
    async render(latex: string, display: boolean): Promise<RasterResult> {
      const r = mathRenderer.mathml(latex, display);
      if (r.html === undefined) throw new RasterError("unsupported", r.err);
      const xml = new XMLSerializer().serializeToString(mathElement(r.html, display));
      const css = mathRenderer.css;
      const box = `font-size:${FONT_PX}px;line-height:normal;white-space:nowrap;color:#000;`;
      // A zero-size inline-block sits on the text baseline: it tells where the formula's baseline is.
      const inner = `${xml}<span style="display:inline-block;width:0;height:0"></span>`;

      // 1. measure in the live document
      const host = document.createElement("div");
      host.style.cssText = `position:fixed;left:-20000px;top:0;visibility:hidden;${box}`;
      host.innerHTML = `<style>${css}</style><div style="position:absolute;left:0;top:0">${inner}</div>`;
      document.body.append(host);
      let m: DOMRect, probe: DOMRect, origin: DOMRect;
      try {
        const wrap = host.lastElementChild as HTMLElement;
        origin = wrap.getBoundingClientRect();
        m = host.querySelector("math")!.getBoundingClientRect();
        probe = (wrap.lastElementChild as HTMLElement).getBoundingClientRect();
      } finally {
        host.remove();
      }
      if (!(m.width > 0 && m.height > 0)) throw new RasterError("blank", "empty layout");
      const w = Math.ceil(m.width) + 2 * PAD;
      const h = Math.ceil(m.height) + 2 * PAD;
      const baseline = probe.bottom - m.top + PAD;
      if (w > 4000 || h > 2000) throw new RasterError("too-large", `${w}x${h}px`);

      // 2. the same markup inside a foreignObject, shifted so the formula starts at (PAD, PAD)
      const dx = PAD - (m.left - origin.left);
      const dy = PAD - (m.top - origin.top);
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
        `<foreignObject x="0" y="0" width="${w}" height="${h}"><div xmlns="${XHTML}" style="${box}">` +
        `<style><![CDATA[${css}]]></style><div style="position:absolute;left:${dx}px;top:${dy}px">${inner}</div>` +
        `</div></foreignObject></svg>`;
      const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));

      // 3. canvas -> PNG (SCALE x the CSS px size)
      const canvas = document.createElement("canvas");
      canvas.width = w * SCALE;
      canvas.height = h * SCALE;
      const g = canvas.getContext("2d");
      if (!g) throw new RasterError("error", "no canvas");
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      let url: string;
      try {
        const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = false;
        for (let i = 3; i < px.length && !ink; i += 4) ink = px[i] > 32;
        if (!ink) throw new RasterError("blank", "nothing was drawn");
        url = canvas.toDataURL("image/png");
      } catch (e) {
        if (e instanceof RasterError) throw e;
        throw new RasterError("tainted", (e as Error)?.message);
      }
      return { png: url.slice(url.indexOf(",") + 1), w, h, baseline, scale: SCALE };
    },
  };
}
