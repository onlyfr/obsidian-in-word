import { afterEach, describe, expect, it, vi } from "vitest";
import * as temml from "temml";
import { mathMLToElement, mathRenderer, sanitizeMathML } from "../src/plugins/math-impl";
import { createRasterizer } from "../src/convert/mathraster";

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

function rasterHost(html = '<math display="block" class="tml-display"><mi>x</mi></math>', css = 'math{color:black}') {
  const sources: string[] = [];
  vi.spyOn(mathRenderer, "load").mockResolvedValue(true);
  vi.spyOn(mathRenderer, "mathml").mockReturnValue({html});
  vi.spyOn(mathRenderer, "css", "get").mockReturnValue(css);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
    if (this.localName === "math") return {x:10,y:20,left:10,top:20,right:40.4,bottom:35.2,width:30.4,height:15.2,toJSON(){}};
    if (this.localName === "span") return {x:40,y:32,left:40,top:32,right:40,bottom:32,width:0,height:0,toJSON(){}};
    return {x:8,y:18,left:8,top:18,right:48,bottom:38,width:40,height:20,toJSON(){}};
  });
  vi.stubGlobal("Image", class {
    onload?: () => void;
    set src(value: string) { sources.push(value); queueMicrotask(() => this.onload?.()); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray([0,0,0,255])})} as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue('data:image/png;base64,AAAA');
  return sources;
}

describe("rasterizer DOM assembly", () => {
  it("renders without assigning innerHTML and serializes a namespaced SVG", async () => {
    const sources = rasterHost();
    vi.spyOn(Element.prototype,"innerHTML","set").mockImplementation(()=>{throw new Error('HTML sink used');});
    const count = document.body.childElementCount;
    const result = await (await createRasterizer()).render('x',true);
    expect(result).toEqual({png:'AAAA',w:37,h:22,baseline:15,scale:3});
    expect(document.body.childElementCount).toBe(count);
    const xml = decodeURIComponent(sources[0].slice(sources[0].indexOf(',')+1));
    const doc = new DOMParser().parseFromString(xml,"application/xml");
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(doc.querySelector('foreignObject > div')!.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(doc.querySelector('math')!.namespaceURI).toBe(NS);
    expect(doc.querySelector('math')!.getAttribute('display')).toBeNull();
    expect(doc.querySelector('math')!.getAttribute('class')).not.toContain('tml-display');
  });

  it("keeps CSS closing tags and CDATA delimiters as text, even with unsanitized renderer output", async () => {
    const css='math{color:black}/* ]]></style><img src=x onerror=bad()> */';
    const sources=rasterHost('<math onload="bad()"><mtext>&lt;img src=x&gt;</mtext><script>bad()</script></math>',css);
    await (await createRasterizer()).render('x',false);
    const xml=decodeURIComponent(sources[0].slice(sources[0].indexOf(',')+1));
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('style')!.textContent).toBe(css);
    expect(doc.querySelector('script,img,[onload],[onerror]')).toBeNull();
    expect(doc.querySelector('mtext')!.textContent).toBe('<img src=x>');
  });

  it("removes the measuring host if layout fails", async () => {
    rasterHost();
    vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(()=>{throw new Error('layout failure');});
    const count=document.body.childElementCount;
    await expect((await createRasterizer()).render('x',false)).rejects.toThrow('layout failure');
    expect(document.body.childElementCount).toBe(count);
  });
});
