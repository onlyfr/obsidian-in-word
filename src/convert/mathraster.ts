/**
 * The real {@link MathRasterizer}: Temml's sanitized MathML is drawn with MathJax's default TeX SVG glyphs
 * and drawn onto a canvas, then exported as a transparent PNG.
 *
 * MathJax SVG includes its own glyph paths; it needs no installed font or external font files.
 * an SVG that is loaded as an `<img>` cannot
 * run scripts or fetch resources and does not taint the canvas (measured, see docs/unsupported-syntax.md).
 * Text colour policy: black (#000) on a transparent background, whatever the page colour is.
 *
 * Browser only (DOM + canvas). LaTeX goes through the preview's Temml options and MathML sanitizer.
 * Generated SVG is rebuilt with a geometry/text allowlist. Throws {@link RasterError}.
 */
import { RasterError, type MathRasterizer, type RasterResult } from "./mathimg";
import {renderMathSvg} from './math-svg';

/** Body text size the picture is drawn for: Word's default 11 pt. */
const FONT_PX = (11 * 96) / 72;
const SCALE = 3;
/** Transparent margin around the formula (CSS px), so glyph overhang and `\cancel` strokes are not clipped. */
const PAD = 3;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new RasterError("error", "the picture could not be loaded"));
    img.src = url;
  });
}

export async function createRasterizer(): Promise<MathRasterizer> {
  const { mathRenderer, mathMLToElement } = await import("../plugins/math-impl");
  if (!(await mathRenderer.load())) throw new RasterError("unavailable", mathRenderer.error);
  return {
    async render(latex: string, display: boolean): Promise<RasterResult> {
      const r = mathRenderer.mathml(latex, display);
      if (r.html === undefined) throw new RasterError("unsupported", r.err);
      const parsed = mathMLToElement(r.html);
      if (!parsed) throw new RasterError("unsupported", "no <math>");
      const svg=renderMathSvg(new XMLSerializer().serializeToString(parsed),display);
      // MathJax SVG uses 1000 units per em. Its y=0 is the formula baseline.
      const [x,y,width,height]=(svg.getAttribute('viewBox')??'').trim().split(/\s+/).map(Number);
      if(![x,y,width,height].every(Number.isFinite) || !(width>0 && height>0))throw new RasterError('blank','empty layout');
      const unit=FONT_PX/1000;
      const w = Math.ceil(width*unit) + 2 * PAD;
      const h = Math.ceil(height*unit) + 2 * PAD;
      const baseline = -y*unit + PAD;
      if (w > 4000 || h > 2000) throw new RasterError("too-large", `${w}x${h}px`);

      // Match viewBox and physical dimensions to keep 1em at FONT_PX, including the transparent margin.
      svg.setAttribute('viewBox',`${x-PAD/unit} ${y-PAD/unit} ${w/unit} ${h/unit}`);
      svg.setAttribute('color','#000');
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
      const xml = new XMLSerializer().serializeToString(svg);
      const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml));

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
