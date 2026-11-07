import { afterEach, describe, expect, it, vi } from "vitest";
import * as temml from "temml";
import { mathMLToElement, mathRenderer, sanitizeMathML } from "../src/plugins/math-impl";
import { createRasterizer } from "../src/convert/mathraster";
import {renderMathSvg} from '../src/convert/math-svg';

const NS = "http://www.w3.org/1998/Math/MathML";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("MathML nodes built from an inert parse", () => {
  it("rechecks raw input rather than trusting an upstream sanitizer", () => {
    const node = mathMLToElement(`<math onclick="alert(1)" xmlns="bad"><mi class="cursor" style="color:red;background:url(https://example.test/x)">x</mi><mtext><img src=x onerror="alert(1)"><svg><script>bad()</script></svg></mtext><annotation-xml encoding="text/html"><div>bad</div></annotation-xml><mi href="javascript:x" onmouseover="bad()">y</mi></math>`)!;
    expect(node.namespaceURI).toBe(NS);
    expect(node.getAttribute("xmlns")).toBeNull();
    expect(node.querySelector("script,img,svg,div,annotation-xml")).toBeNull();
    expect(node.querySelector("mi")!.getAttribute("style")).toBe("color:red");
    expect(node.querySelector("mi")!.getAttribute("class")).toBe("cursor");
    for (const el of [node, ...node.querySelectorAll("*")]) {
      expect(el.namespaceURI).toBe(NS);
      expect([...el.attributes].some(a => /^on|href/i.test(a.name))).toBe(false);
    }
    expect(node.textContent).toBe("xy");
  });

  it("keeps escaped markup as text, with no HTML reparse", () => {
    const node = mathMLToElement('<math><mtext>&lt;img src=x onerror=bad()&gt; &amp; &lt;/style&gt;</mtext></math>')!;
    expect(node.querySelector("mtext")!.textContent).toBe('<img src=x onerror=bad()> & </style>');
    expect(node.querySelector("img,style")).toBeNull();
    const serialized = new XMLSerializer().serializeToString(node);
    expect(serialized).toContain("&lt;img");
    expect(new DOMParser().parseFromString(serialized, "application/xml").querySelector("parsererror")).toBeNull();
  });

  it.each(['<p>not math</p>', '<svg><math><mi>x</mi></math></svg>'])("rejects missing or foreign-namespace roots: %s", markup => {
    expect(mathMLToElement(markup)).toBeNull();
  });

  it.each([
    String.raw`\boxed{E=mc^2}`, String.raw`A\xrightarrow[g]{f}B`, String.raw`\cancel{x}+\bcancel{abc}`,
    String.raw`\begin{pmatrix}1&0\\0&1\end{pmatrix}`, String.raw`\sum_{i=1}^n\frac{x_i}{\sqrt{y}}`,
    String.raw`\widehat{xyz}+\text{<b>\&}`, String.raw`\class{cursor}{x}`,
  ])("preserves sanitized Temml structure for %s", latex => {
    for (const displayMode of [false, true]) {
      const renderer = (temml as any).default ?? temml;
      const raw = renderer.renderToString(latex, {displayMode, throwOnError:true, trust:true});
      const sanitized = sanitizeMathML(raw);
      const parsed = new DOMParser().parseFromString(sanitized, "text/html").querySelector("math")!;
      const node = mathMLToElement(sanitized)!;
      const shape = (el: Element): unknown => ({
        tag:el.localName, ns:el.namespaceURI,
        attrs:[...el.attributes].filter(a=>a.name!=="xmlns").map(a=>[a.name,a.value]),
        children:[...el.childNodes].map(c=>c.nodeType===3?c.textContent:shape(c as Element)),
      });
      expect(shape(node)).toEqual(shape(parsed));
    }
  });
});


vi.mock('../src/convert/math-svg',()=>({renderMathSvg:vi.fn()}));
function rasterHost(viewBox='0 -1000 2000 1200'){
 const sources:string[]=[];
 vi.spyOn(mathRenderer,'load').mockResolvedValue(true);
 vi.spyOn(mathRenderer,'mathml').mockReturnValue({html:'<math><mi>x</mi></math>'});
 vi.mocked(renderMathSvg).mockImplementation(()=>{
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',viewBox);return svg;
 });
 vi.stubGlobal('Image',class{onload?:()=>void;set src(url:string){sources.push(url);queueMicrotask(()=>this.onload?.());}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray([0,0,0,255])})} as any);
 vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
 return sources;
}
describe('MathJax raster output',()=>{
 it('uses SVG font metrics for 11pt dimensions, padding and baseline without live HTML layout',async()=>{
  const sources=rasterHost();
  vi.spyOn(Element.prototype,'innerHTML','set').mockImplementation(()=>{throw new Error('HTML sink used');});
  const result=await(await createRasterizer()).render('x',true);
  expect(result.png).toBe('AAAA');expect(result.w).toBe(36);expect(result.h).toBe(24);
  expect(result.baseline).toBeCloseTo(17.6666667);expect(result.scale).toBe(3);
  const svg=new DOMParser().parseFromString(decodeURIComponent(sources[0].split(',').slice(1).join(',')),'application/xml').documentElement;
  expect(svg.getAttribute('width')).toBe('36');expect(svg.getAttribute('height')).toBe('24');
  expect(svg.getAttribute('color')).toBe('#000');expect(svg.querySelector('foreignObject')).toBeNull();
  expect(renderMathSvg).toHaveBeenCalledWith(expect.stringContaining('<mi>x</mi>'),true);
 });
 it.each(['0 0 0 20','0 0 NaN 20','0 0 1000000 1000'])('refuses empty, invalid or excessive SVG geometry: %s',async viewBox=>{
  rasterHost(viewBox);await expect((await createRasterizer()).render('x',false)).rejects.toThrow();
 });
});
