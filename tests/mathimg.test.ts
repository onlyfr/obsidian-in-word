import { describe, expect, it } from "vitest";
import * as realTemml from "temml";
import { MemorySidecar, pruneSidecar, sidecarFromXml, sidecarToXml } from "../src/convert/sidecar";
import {
  MATHIMG_VERSION,
  findMath,
  mathIds,
  mathImgIds,
  mathImgKey,
  scanOoxml,
  wrapPackage,
} from "../src/convert/equations";
import { htmlToMarkdown, renderWithSidecar, type MathReport } from "../src/convert/obsidian";
import { latexToOmml } from "../src/convert/math";
import {
  LIMITS,
  RasterError,
  applyMathImages,
  literalMathHtml,
  mathImageRun,
  mathImagePackageParts,
  mathImgAlt,
  parseMathImgAlt,
  placedSize,
  planMathImages,
  resolveMathImages,
  type MathRasterizer,
  type RasterResult,
} from "../src/convert/mathimg";
import { MathRenderer } from "../src/plugins/math-impl";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const ok = (over: Partial<RasterResult> = {}): RasterResult => ({ png: PNG, w: 60, h: 24, baseline: 17, scale: 3, ...over });

/** Fake rasterizer: records calls, optionally fails. */
function fake(impl: (latex: string, display: boolean) => Promise<RasterResult> | RasterResult = () => ok()) {
  const calls: string[] = [];
  const r: MathRasterizer = {
    async render(latex, display) {
      calls.push((display ? "D:" : "I:") + latex);
      return impl(latex, display);
    },
  };
  return { r, calls, loader: async () => r };
}

const BOXED = String.raw`\boxed{E=mc^2}`;
const XRA = String.raw`A \xrightarrow{f} B`;

describe("corpus: what OMML cannot do but Temml can draw", () => {
  const cases: [string, boolean][] = [
    // [latex, converts to OMML]
    [String.raw`A \xrightarrow[g]{f+h} B`, false],
    [String.raw`\boxed{E=mc^2}`, false],
    [String.raw`\cancel{x}+\bcancel{abc}`, false],
    [String.raw`\color{red} x + y`, false],
    [String.raw`\textcolor{blue}{a}+b`, false],
    [String.raw`\operatorname*{argmax}_{x} f(x)`, false],
    [String.raw`\mathcal{L}\{f\}`, false],
    [String.raw`\mathfrak{g}`, false],
    [String.raw`\widehat{xyz}+\widetilde{abc}`, false],
    [String.raw`\overrightarrow{AB}`, false],
    [String.raw`a \not\equiv b`, false],
    [String.raw`a \stackrel{!}{=} b`, false],
    [String.raw`\sum_{\substack{0<i<m \\ 0<j<n}} P(i,j)`, false],
    [String.raw`\cfrac{1}{1+\cfrac{1}{x}}`, false],
    [String.raw`a \equiv b \pmod{n}`, false],
    [String.raw`\phantom{yy}x`, false],
    [String.raw`\fbox{abc}`, false],
    [String.raw`\colorbox{yellow}{abc}`, false],
    [String.raw`\sideset{_a^b}{_c^d}\sum`, false],
    [String.raw`x=y \tag{1}`, false],
    // sanity: these do convert (rung 1)
    [String.raw`\frac{a}{b}+\sqrt{x}`, true],
    [String.raw`\underbrace{a+b+c}_{n}`, true],
    [String.raw`\begin{cases} 1 & x>0 \\ 0 & x\le 0 \end{cases}`, true],
  ];
  const real = { temml: async () => (realTemml as any).default, css: async () => "" };

  it("OMML result is as pinned; every non-OMML one is drawable by Temml (so it gets a picture)", async () => {
    const r = new MathRenderer(real);
    expect(await r.load()).toBe(true);
    for (const [latex, omml] of cases) {
      expect(latexToOmml(latex, true) !== null, latex).toBe(omml);
      if (!omml) expect(r.mathml(latex, true).html, latex).toMatch(/^<math/);
    }
  });

  it("LaTeX Temml cannot draw either has no MathML (-> literal rung)", async () => {
    const r = new MathRenderer(real);
    await r.load();
    for (const bad of [String.raw`\foobar{x}`, String.raw`\begin{tikzpicture}\end{tikzpicture}`, String.raw`\href{http://x}{a}`]) {
      const m = r.mathml(bad, false);
      expect(m.html, bad).toBeUndefined();
      expect(m.err, bad).toBeTruthy();
    }
  });
});

describe("alt text marker", () => {
  const id = mathImgKey(BOXED, false);
  it("round-trips, display flag included", () => {
    expect(parseMathImgAlt(mathImgAlt(id, BOXED, false))).toEqual({ id, display: false, latex: BOXED });
    expect(parseMathImgAlt(mathImgAlt(id, "a\n  b", true))).toEqual({ id, display: true, latex: "a b" });
  });
  it("truncates long LaTeX (the pair in the sidecar keeps the whole)", () => {
    const alt = mathImgAlt(id, "x".repeat(500), false);
    expect(alt.length).toBeLessThan(LIMITS.altLatex + 30);
    expect(parseMathImgAlt(alt)).toEqual({ id, display: false, latex: undefined });
  });
  it("is not confused with ordinary alt texts", () => {
    for (const a of ["", "a picture", "owb:math:xyz", "owb:mermaid:12345678", "~WRS", "Owb:math:12345678"]) expect(parseMathImgAlt(a), a).toBeNull();
  });
  it("id depends on latex, display and the render version", () => {
    expect(mathImgKey("x", false)).toBe(mathImgKey("x", false));
    expect(mathImgKey("x", false)).not.toBe(mathImgKey("x", true));
    expect(mathImgKey("x", false)).not.toBe(mathImgKey("y", false));
    expect(mathImgKey("x", false)).not.toBe(mathIds("$x$").values().next().value); // distinct from the OMML pair's id
    expect(MATHIMG_VERSION).toBeGreaterThan(0);
  });
});

describe("ladder decision", () => {
  const items = (src: string) => renderWithSidecar(src, new MemorySidecar()).equations;

  it("rung 1: convertible LaTeX stays OMML (no picture flag)", () => {
    const [q] = items(String.raw`$\frac{a}{b}$`);
    expect(q.omml).not.toBe("");
    expect(q.img).toBeUndefined();
  });

  it("rung 2: LaTeX without OMML is flagged for a picture", () => {
    const eq = items(`$${BOXED}$ and $x^2$ and\n\n$$${XRA}$$`);
    expect(eq.map((q) => !!q.img)).toEqual([true, false, true]);
    expect(eq.map((q) => q.display)).toEqual([false, false, true]);
  });

  it("renders once per distinct formula and stores the pair", async () => {
    const f = fake();
    const sc = new MemorySidecar();
    const out = await resolveMathImages(items(`$${BOXED}$ $${BOXED}$ $${XRA}$`).filter((q) => q.img), sc, f.loader);
    expect(out.map((o) => o.kind)).toEqual(["image", "image", "image"]);
    expect(f.calls).toEqual([`I:${BOXED}`, `I:${XRA}`]);
    const e = sc.get(mathImgKey(BOXED, false))!;
    expect(e).toMatchObject({ kind: "mathimg", latex: BOXED, display: false, png: PNG, w: 60, h: 24, baseline: 17, v: MATHIMG_VERSION });
  });

  it("unchanged -> the stored picture, byte for byte, and no render at all", async () => {
    const sc = new MemorySidecar();
    const first = fake((_l, _d) => ok({ png: "AAAA" }));
    await resolveMathImages(items(`$${BOXED}$`), sc, first.loader);
    const second = fake(() => {
      throw new Error("must not render");
    });
    let loaded = 0;
    const out = await resolveMathImages(items(`$${BOXED}$`), sc, async () => (loaded++, second.r));
    expect(out[0]).toMatchObject({ kind: "image", stored: true });
    expect((out[0] as any).entry.png).toBe("AAAA");
    expect(loaded).toBe(0); // the rasterizer is not even loaded
  });

  it("edited -> a new picture (new id); the old entry is not kept", async () => {
    const sc = new MemorySidecar();
    const f = fake();
    await resolveMathImages(items(`$${BOXED}$`), sc, f.loader);
    const edited = String.raw`\boxed{E=mc^3}`;
    await resolveMathImages(items(`$${edited}$`), sc, f.loader);
    expect(f.calls).toEqual([`I:${BOXED}`, `I:${edited}`]);
    const keep = new Set([...mathIds(`$${edited}$`), ...mathImgIds(`$${edited}$`)]);
    const pruned = pruneSidecar(sc, keep);
    expect([...pruned.entries()].map(([id]) => id)).toEqual([mathImgKey(edited, false)]);
  });

  it("edited into something OMML can do -> rung 1 (no picture, the old pair is pruned)", () => {
    const [q] = items(String.raw`$\frac{a}{b}$`);
    expect(q.img).toBeUndefined();
    const sc = new MemorySidecar();
    sc.set(mathImgKey(BOXED, false), { kind: "mathimg", html: "", latex: BOXED, png: PNG });
    const keep = new Set([...mathIds(String.raw`$\frac{a}{b}$`), ...mathImgIds(String.raw`$\frac{a}{b}$`)]);
    expect([...pruneSidecar(sc, keep).entries()]).toEqual([]);
  });

  it("a stored entry for the same text but another render version / display flag is not reused", async () => {
    const sc = new MemorySidecar();
    const id = mathImgKey(BOXED, false);
    sc.set(id, { kind: "mathimg", html: "", latex: BOXED, display: false, png: "OLD", w: 1, h: 1, baseline: 1, v: MATHIMG_VERSION - 1 });
    const f = fake();
    const out = await resolveMathImages(items(`$${BOXED}$`), sc, f.loader);
    expect(f.calls).toHaveLength(1);
    expect((out[0] as any).entry.png).toBe(PNG);
    // damaged entry (no png) is re-rendered too
    sc.set(id, { kind: "mathimg", html: "", latex: BOXED, display: false, v: MATHIMG_VERSION });
    await resolveMathImages(items(`$${BOXED}$`), sc, f.loader);
    expect(f.calls).toHaveLength(2);
  });

  describe("rung 3: literal source", () => {
    const run = async (impl: Parameters<typeof fake>[0], src = `$${BOXED}$`) => {
      const f = fake(impl);
      const sc = new MemorySidecar();
      const out = await resolveMathImages(items(src), sc, f.loader);
      return { out, sc, f };
    };
    it("renderer cannot be loaded", async () => {
      const sc = new MemorySidecar();
      let loads=0;
      const loader=async () => {
        loads++;
        throw new Error("chunk failed");
      };
      const out = await resolveMathImages(items(`$${BOXED}$ $${XRA}$`), sc, loader);
      expect(out.map((o) => (o.kind === "literal" ? o.reason : "image"))).toEqual(["unavailable", "unavailable"]);
      expect([...sc.entries()]).toEqual([]);
      expect(loads).toBe(1);
      await resolveMathImages(items(`$${BOXED}$`), sc, loader);
      expect(loads).toBe(2); // Failure is not permanent across applies.
    });
    it("render error / unsupported", async () => {
      const { out } = await run(() => {
        throw new RasterError("unsupported", "no");
      });
      expect(out[0]).toMatchObject({ kind: "literal", reason: "unsupported" });
      expect((await run(() => Promise.reject(new Error("boom")))).out[0]).toMatchObject({ kind: "literal", reason: "error" });
    });
    it("timeout", async () => {
      const keep = LIMITS.timeoutMs;
      LIMITS.timeoutMs = 20;
      try {
        const { out, sc } = await run(() => new Promise<RasterResult>(() => {}));
        expect(out[0]).toMatchObject({ kind: "literal", reason: "timeout" });
        expect([...sc.entries()]).toEqual([]);
      } finally {
        LIMITS.timeoutMs = keep;
      }
    });
    it("too long LaTeX is not even rendered", async () => {
      const { out, f } = await run(() => ok(), `$x${"+x".repeat(LIMITS.maxLatex)}$`);
      expect(out[0]).toMatchObject({ kind: "literal", reason: "too-long" });
      expect(f.calls).toEqual([]);
    });
    it("too large picture / png, invalid results", async () => {
      expect((await run(() => ok({ w: LIMITS.maxWidth + 1 }))).out[0]).toMatchObject({ kind: "literal", reason: "too-large" });
      expect((await run(() => ok({ h: LIMITS.maxHeight + 1 }))).out[0]).toMatchObject({ kind: "literal", reason: "too-large" });
      expect((await run(() => ok({ png: "A".repeat(Math.ceil((LIMITS.maxPng * 4) / 3) + 8) }))).out[0]).toMatchObject({ kind: "literal", reason: "too-large" });
      for (const bad of [ok({ w: 0 }), ok({ png: "" }), ok({ baseline: NaN }), ok({ scale: 0 }), null as unknown as RasterResult])
        expect((await run(() => bad)).out[0], JSON.stringify(bad)).toMatchObject({ kind: "literal", reason: "error" });
    });
    it("time budget: the rest of a long list falls to literal", async () => {
      let t = 0;
      const f = fake();
      const out = await resolveMathImages(items(`$${BOXED}$ $${XRA}$`), new MemorySidecar(), f.loader, () => (t += LIMITS.budgetMs));
      expect(out.map((o) => o.kind)).toEqual(["image", "literal"]);
    });
    it("a failure of one formula does not stop the others", async () => {
      const f = fake((l) => {
        if (l === BOXED) throw new RasterError("blank");
        return ok();
      });
      const out = await resolveMathImages(items(`$${BOXED}$ $${XRA}$`), new MemorySidecar(), f.loader);
      expect(out.map((o) => o.kind)).toEqual(["literal", "image"]);
    });
  });
});

describe("plan: literal text, notes, packages", () => {
  it("images mode renders native-capable math too, without mutating the original plan", async () => {
    const sc=new MemorySidecar();
    const r=renderWithSidecar(`$x^2$ and $${BOXED}$`,sc);
    const before=structuredClone(r.equations);
    const f=fake();
    const plan=await applyMathImages(r.html,r.equations,sc,f.loader,'images');
    expect(plan.pictures.size).toBe(2);expect(plan.active.every(q=>q.img && !q.omml)).toBe(true);
    expect(plan.notes[0]).toContain('설정에 따라');expect(plan.notes[0]).not.toContain('만들 수 없어');
    expect(r.equations).toEqual(before);
    const repeat=fake();await applyMathImages(r.html,r.equations,sc,repeat.loader,'images');expect(repeat.calls).toEqual([]);
    const hybrid=await applyMathImages(r.html,r.equations,sc,fake().loader,'hybrid');
    expect(hybrid.pictures.size).toBe(1);expect(hybrid.active[0].omml).toContain('oMath');
  });

  it("images mode preserves source text with a warning if a render fails",async()=>{
    const sc=new MemorySidecar();const r=renderWithSidecar('$x^2$',sc);
    const plan=await applyMathImages(r.html,r.equations,sc,fake(()=>{throw new RasterError('unavailable');}).loader,'images');
    expect(plan.pictures.size).toBe(0);expect(plan.html).toContain('$x^2$');expect(plan.notes[0]).toContain('경고');
  });
  it("literal fallbacks are written into the HTML (highlighted, escaped), pictures keep their marker", async () => {
    const src = `a $${BOXED}$ b $x<y\\foobar$ c\n\n$$${XRA}$$`;
    const r = renderWithSidecar(src, new MemorySidecar());
    const f = fake((l) => {
      if (l.includes("foobar")) throw new RasterError("unsupported");
      return ok();
    });
    const plan = await applyMathImages(r.html, r.equations, new MemorySidecar(), f.loader);
    expect(plan.counts).toEqual({ pictures: 2, stored: 0, literal: 1 });
    expect(plan.active.map((q) => q.latex)).toEqual([BOXED, XRA]);
    expect(plan.html).toContain(literalMathHtml("x<y\\foobar", false));
    expect(plan.html).toContain("$x&lt;y\\foobar$");
    expect(plan.html).toContain("mso-highlight:yellow");
    for (const q of plan.active) expect(plan.html).toContain(q.marker);
    expect(plan.html).not.toContain(r.equations[1].marker);
    expect(plan.notes).toHaveLength(2);
    expect(plan.notes[0]).toContain("그림으로 넣었습니다");
    expect(plan.notes[1]).toMatch(/^경고: 수식 1개는 그림으로도 만들 수 없어/);
    expect([...plan.pictures.keys()]).toEqual(plan.active.map((q) => q.marker));
  });

  it("OMML-only content is untouched by the picture rung", async () => {
    const r = renderWithSidecar("$x^2$ and $$\\int_0^1 x\\,dx$$", new MemorySidecar());
    const f = fake();
    const plan = await applyMathImages(r.html, r.equations, new MemorySidecar(), f.loader);
    expect(plan.html).toBe(r.html);
    expect(plan.active).toEqual(r.equations);
    expect(plan.notes).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  it("stored pictures are reported as such", async () => {
    const sc = new MemorySidecar();
    const r = renderWithSidecar(`$${BOXED}$`, sc);
    await applyMathImages(r.html, r.equations, sc, fake().loader);
    const plan = await applyMathImages(r.html, r.equations, sc, fake().loader);
    expect(plan.counts).toEqual({ pictures: 1, stored: 1, literal: 0 });
  });
});

describe("OOXML of the picture", () => {
  const entry = { kind: "mathimg", html: "", latex: BOXED, display: false, png: PNG, w: 60, h: 24, baseline: 17, v: 1 };
  const id = mathImgKey(BOXED, false);

  it("inline: lowered by the descent, alt text with marker + latex, size in EMU", () => {
    const run = mathImageRun(id, entry, 1001, false);
    // descent = 24-17 = 7 px = 5.25 pt = 10.5 half-points -> 11 (rounded)
    expect(run).toContain('<w:position w:val="-11"/>');
    expect(run).toContain(`descr="owb:math:${id} \\boxed{E=mc^2}"`);
    expect(run).toContain(`<wp:extent cx="${60 * 9525}" cy="${24 * 9525}"/>`);
    expect(run).toContain('<wp:docPr id="1001"');
    expect(run).toContain('r:embed="rIdOwbMath1"');
    expect(run).not.toContain("wp:anchor");
  });

  it("display: centered paragraph, no shift, `:d` in the alt", () => {
    const e = { ...entry, display: true };
    const dId = mathImgKey(BOXED, true);
    const p = mathImagePackageParts(dId, e, 1002, true);
    expect(p.body.startsWith('<w:p><w:pPr><w:jc w:val="center"/></w:pPr>')).toBe(true);
    expect(p.body).not.toContain("w:position");
    expect(p.body).toContain(`descr="owb:math:${dId}:d `);
  });

  it("no shift when the baseline is at the bottom; wide pictures are scaled to a text column", () => {
    expect(mathImageRun(id, { ...entry, baseline: 24 }, 1, false)).not.toContain("w:position");
    const wide = placedSize(1200, 100);
    expect(wide).toEqual({ w: LIMITS.placeWidth, h: 50, f: 0.5 });
    expect(placedSize(100, 20).f).toBe(1);
    const run = mathImageRun(id, { ...entry, w: 1200, h: 100, baseline: 60 }, 1, false);
    expect(run).toContain(`cx="${LIMITS.placeWidth * 9525}"`);
    expect(run).toContain('w:val="-30"'); // 40 px descent * 0.5 * 1.5
  });

  it("special characters in LaTeX are escaped in the attribute", () => {
    const l = String.raw`a<b>"c"&d`;
    const run = mathImageRun(id, { ...entry, latex: l }, 1, false);
    expect(run).toContain("a&lt;b&gt;&quot;c&quot;&amp;d");
    const pkg = wrapPackage(`<w:p>${run}</w:p>`);
    expect(new DOMParser().parseFromString(pkg, "application/xml").querySelector("parsererror")).toBeNull();
  });

  it("package is well-formed flat OPC with the media part and its relationship", () => {
    const p = mathImagePackageParts(id, entry, 1001, false);
    const pkg = wrapPackage(p.body, p.rels, p.parts);
    const doc = new DOMParser().parseFromString(pkg, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(pkg).toContain(`<pkg:binaryData>${PNG}</pkg:binaryData>`);
    expect(pkg).toContain('Target="media/owbmath.png"');
    expect(pkg).toContain('r:embed="rIdOwbMath1"');
    // flat-OPC without media still works as before
    expect(wrapPackage("<w:p/>")).not.toContain("media");
  });

  it("what we write is what scanOoxml reads back: a math picture, not an ordinary picture or an equation", () => {
    const body = wrapPackage(`<w:p>${mathImageRun(id, entry, 1001, false)}</w:p>`);
    const scan = scanOoxml(body);
    expect(scan.items).toEqual([{ kind: "mathimg", id, display: false, latex: BOXED }]);
    expect(scan.equations).toBe(0);
    expect(scan.mathImages).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// load direction: the picture becomes $latex$ again

const wordImg = (n: number, alt?: string) =>
  `<img width=60 height=24 src="~WRS%7bAAAA%7d.files/image00${n}.png"${alt === undefined ? "" : ` alt="${alt.replace(/"/g, "&quot;")}"`}>`;
const picXml = (descr?: string) =>
  `<w:r><w:drawing><wp:inline><wp:extent cx="1" cy="1"/><wp:docPr id="1" name="Picture"${descr === undefined ? "" : ` descr="${descr}"`}/></wp:inline></w:drawing></w:r>`;
const OMML = latexToOmml("x^2")!;
const ooxmlOf = (...runs: string[]) => `<w:body>${runs.map((r) => `<w:p>${r}</w:p>`).join("")}</w:body>`;

function load(html: string, ooxml: string, sidecar = new MemorySidecar(), images?: string[]) {
  const report: MathReport = { total: 0, latex: 0, opaque: 0, unpaired: 0 };
  const md = htmlToMarkdown(html, sidecar, new Map(), images, undefined, undefined, scanOoxml(ooxml).items, report);
  return { md, report, sidecar };
}

describe("load: pictures with the marker become LaTeX again", () => {
  const id = mathImgKey(BOXED, false);
  const alt = mathImgAlt(id, BOXED, false);
  const sidecar = () => {
    const sc = new MemorySidecar();
    sc.set(id, { kind: "mathimg", html: "", latex: BOXED, display: false, png: PNG, w: 60, h: 24, baseline: 17, v: 1 });
    return sc;
  };

  it("inline picture -> $latex$ (from the sidecar pair)", () => {
    const { md, report } = load(`<p class=MsoNormal>energy ${wordImg(1, alt)} here</p>`, ooxmlOf(picXml(alt)), sidecar());
    expect(md).toBe(`energy $${BOXED}$ here`);
    expect(report.images).toBe(1);
    expect(report.unpaired).toBe(0);
  });

  it("display picture -> $$ block", () => {
    const dId = mathImgKey(XRA, true);
    const sc = new MemorySidecar();
    sc.set(dId, { kind: "mathimg", html: "", latex: XRA, display: true, png: PNG, w: 60, h: 24, baseline: 17, v: 1 });
    const a = mathImgAlt(dId, XRA, true);
    const { md } = load(`<p class=MsoNormal>before</p><p class=MsoNormal align=center>${wordImg(1, a)}</p>`, ooxmlOf("<w:r><w:t>before</w:t></w:r>", picXml(a)), sc);
    expect(md).toBe(`before\n\n$$\n${XRA}\n$$`);
  });

  it("without a sidecar entry the untruncated alt text still gives the LaTeX (and the display flag)", () => {
    const { md } = load(`<p class=MsoNormal>${wordImg(1, alt)}</p>`, ooxmlOf(picXml(alt)));
    expect(md).toBe(`$${BOXED}$`);
    const d = mathImgAlt(mathImgKey(XRA, true), XRA, true);
    expect(load(`<p class=MsoNormal>${wordImg(1, d)}</p>`, ooxmlOf(picXml(d))).md).toBe(`$$\n${XRA}\n$$`);
  });

  it("truncated alt and no sidecar entry: stays a picture (nothing invented), counted as unpaired", () => {
    const long = mathImgAlt(mathImgKey("x".repeat(500), false), "x".repeat(500), false);
    const { md, report } = load(`<p class=MsoNormal>${wordImg(1, long)}</p>`, ooxmlOf(picXml(long)));
    expect(md).toContain("kind=image");
    expect(report.images ?? 0).toBe(0);
    expect(report.unpaired).toBe(1);
  });

  it("an ordinary picture, even one with another alt text, is left alone", () => {
    for (const a of [undefined, "a cat", "owb:mermaid:12345678 graph"]) {
      const { md, report } = load(`<p class=MsoNormal>${wordImg(1, a)}</p>`, ooxmlOf(picXml(a)), sidecar());
      expect(md).toContain("kind=image");
      expect(report.images ?? 0).toBe(0);
    }
  });

  it("mixed in one selection, in document order: picture, Word equation, math picture, picture", () => {
    const html =
      `<p class=MsoNormal>${wordImg(1, "cat")}</p><p class=MsoNormal>then ${wordImg(2)} and ${wordImg(3, alt)} end</p><p class=MsoNormal>${wordImg(4, "dog")}</p>`;
    const ooxml = ooxmlOf(picXml("cat"), OMML + picXml(alt), picXml("dog"));
    const { md, report, sidecar: sc } = load(html, ooxml, sidecar(), ["Q0FU", "RE9H"]);
    expect(report.total).toBe(1); // only the Word equation counts as an equation
    expect(report.latex).toBe(1);
    expect(report.images).toBe(1);
    expect(md).toContain("then $x^2$ and $" + BOXED + "$ end");
    expect(md.match(/kind=image/g)).toHaveLength(2);
    // the neighbours keep their own bytes (the math picture's bytes were dropped from the list, not theirs)
    const stored = [...sc.entries()].filter(([, e]) => e.kind === "image").map(([, e]) => e.html);
    expect(stored[0]).toContain("Q0FU");
    expect(stored[1]).toContain("RE9H");
  });

  it("the other pictures still get their bytes when a math picture sits between them", () => {
    const html = `<p class=MsoNormal>${wordImg(1, "cat")}</p><p class=MsoNormal>${wordImg(2, alt)}</p><p class=MsoNormal>${wordImg(3, "dog")}</p>`;
    const sc = sidecar();
    load(html, ooxmlOf(picXml("cat"), picXml(alt), picXml("dog")), sc, ["Q0FU", "RE9H"]);
    const stored = [...sc.entries()].filter(([, e]) => e.kind === "image").map(([, e]) => e.html);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toContain("Q0FU");
    expect(stored[1]).toContain("RE9H");
    expect(stored.join("")).not.toContain("picture not preserved");
  });

  it("count mismatch between HTML images and OOXML objects: nothing is converted, reported as unpaired", () => {
    const { md, report } = load(`<p class=MsoNormal>${wordImg(1, alt)}</p>`, ooxmlOf(picXml(alt) + picXml("x")), sidecar());
    expect(md).toContain("kind=image");
    expect(report.unpaired).toBe(1);
  });

  it("picture inside a table is not converted (the table stays as it is)", () => {
    const html = `<table><tr><td><p>${wordImg(1, alt)}</p></td></tr></table>`;
    const { report } = load(html, ooxmlOf(picXml(alt)), sidecar());
    expect(report.images ?? 0).toBe(0);
    expect(report.unpaired).toBe(1);
  });
});

describe("load -> apply -> load is stable", () => {
  it("markdown is identical after a cycle, the stored picture is reused", async () => {
    const md0 = `Inline $${BOXED}$ text, a Word one $x^2$ and\n\n$$\n${XRA}\n$$\n\nend`;
    // apply
    const sc = new MemorySidecar();
    const r = renderWithSidecar(md0, sc);
    const f = fake();
    const plan = await applyMathImages(r.html, r.equations, sc, f.loader);
    expect(plan.active).toHaveLength(3);
    expect(f.calls.sort()).toEqual([`D:${XRA}`, `I:${BOXED}`]);
    // what Word would now contain: the two pictures with their alt text + one equation, then load again
    const ids = [mathImgKey(BOXED, false), mathImgKey(XRA, true)];
    const alts = [mathImgAlt(ids[0], BOXED, false), mathImgAlt(ids[1], XRA, true)];
    const html =
      `<p class=MsoNormal>Inline ${wordImg(1, alts[0])} text, a Word one ${wordImg(2)} and</p>` +
      `<p class=MsoNormal align=center>${wordImg(3, alts[1])}</p><p class=MsoNormal>end</p>`;
    const ooxml = ooxmlOf(
      `<w:r><w:t>Inline </w:t></w:r>${picXml(alts[0])}<w:r><w:t> text, a Word one </w:t></w:r>${OMML}`,
      picXml(alts[1]),
      "<w:r><w:t>end</w:t></w:r>",
    );
    const l1 = load(html, ooxml, sc);
    expect(l1.md).toBe(md0);
    // apply the loaded markdown again: nothing is rendered, the very same pictures come back
    const r2 = renderWithSidecar(l1.md, sc);
    const f2 = fake();
    const plan2 = await applyMathImages(r2.html, r2.equations, sc, f2.loader);
    expect(f2.calls).toEqual([]);
    expect(plan2.counts).toEqual({ pictures: 2, stored: 2, literal: 0 });
    expect([...plan2.pictures.values()].map((p) => p.parts)).toEqual([...plan.pictures.values()].map((p) => p.parts));
  });

  it("the sidecar (with the PNGs) survives its XML serialization", async () => {
    const sc = new MemorySidecar();
    const r = renderWithSidecar(`$${BOXED}$`, sc);
    await applyMathImages(r.html, r.equations, sc, fake().loader);
    const back = sidecarFromXml(sidecarToXml(pruneSidecar(sc, mathImgIds(`$${BOXED}$`))));
    expect(back.get(mathImgKey(BOXED, false))).toEqual(sc.get(mathImgKey(BOXED, false)));
  });

  it("math spans: markdown ids cover both rungs (pruning keeps the picture pair of every span)", () => {
    const md = `$${BOXED}$ and $x$`;
    expect(findMath(md)).toHaveLength(2);
    expect(mathImgIds(md).size).toBe(2);
    expect(mathImgIds(md).has(mathImgKey(BOXED, false))).toBe(true);
  });
});

describe("display pictures are centered through the marker paragraph", () => {
  it("html of a display picture marker is align=center; inline ones and literal text are untouched", async () => {
    const r = renderWithSidecar(`a $${BOXED}$ b\n\n$$\n${XRA}\n$$\n\n$$\n\\foobar\n$$`, new MemorySidecar());
    const f = fake((l) => {
      if (l.includes("foobar")) throw new RasterError("unsupported");
      return ok();
    });
    const plan = await applyMathImages(r.html, r.equations, new MemorySidecar(), f.loader);
    const [inline, disp] = r.equations;
    expect(plan.html).toContain(`<p class="MsoNormal" align="center">${disp.marker}</p>`);
    expect(plan.html).not.toContain(`align="center">${inline.marker}`);
    expect(plan.html).not.toContain(`<p class="MsoNormal" align="center">$$`);
  });
});
