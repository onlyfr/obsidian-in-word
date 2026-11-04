import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countEquations, equationPackage, findMath, mathIds, scanOoxml } from "../src/convert/equations";
import { htmlToMarkdown, renderWithSidecar, type MathReport } from "../src/convert/obsidian";
import { latexToOmml } from "../src/convert/math";
import { MemorySidecar } from "../src/convert/sidecar";

// Real shapes captured from desktop Word: getHtml renders every equation as a bare <img> (no OMML anywhere in the
// HTML), and the OMML is only available in the OOXML of the same range.
const html = readFileSync("tests/fixtures/eq-getHtml.html", "utf8");
const body = readFileSync("tests/fixtures/eq-body.xml", "utf8");

const r = String.raw;
const report = (): MathReport => ({ total: 0, latex: 0, opaque: 0, unpaired: 0 });

const EXPECTED = [
  "Inline one: $x^2$ and two: $\\frac{a}{b}$ end.", // Word emits &nbsp; around the equations
  "",
  "$$",
  "\\sum_{i=1}^n{i}",
  "$$",
  "",
  "Plain paragraph without math.",
  "",
  "$$",
  "\\sqrt{x+1}",
  "$$",
  "",
  "Head $E=mc$",
].join("\n");

describe("OOXML scan (real Word shape)", () => {
  const scan = scanOoxml(body);
  it("finds inline and display equations in order", () => {
    expect(scan.equations).toBe(5);
    expect(scan.items.map((i) => i.kind)).toEqual(["eq", "eq", "eq", "eq", "eq"]);
    expect(scan.items.map((i) => (i.kind === "eq" ? i.display : null))).toEqual([false, false, true, true, false]);
  });
  it("keeps the OMML byte-for-byte as Word wrote it", () => {
    const omml = scan.items.map((i) => (i.kind === "eq" ? i.omml : ""));
    for (const o of omml) expect(body.includes(o)).toBe(true);
    expect(omml[0]).toMatch(/^<m:oMath><m:sSup>/);
    expect(omml[2]).toMatch(/^<m:oMathPara><m:oMath><m:nary>/);
  });
  it("counts equations", () => expect(countEquations(body)).toBe(5));
  it("ignores floating anchors and counts inline pictures", () => {
    const x = `<w:body><w:p><w:r><w:drawing><wp:anchor/></w:drawing></w:r><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p></w:body>`;
    expect(scanOoxml(x).items.map((i) => i.kind)).toEqual(["pic"]);
  });
});

describe("load: equations become LaTeX", () => {
  it("turns the equation images of real getHtml into $...$ / $$ blocks", () => {
    const rep = report();
    const sidecar = new MemorySidecar();
    const md = htmlToMarkdown(html, sidecar, new Map(), undefined, undefined, undefined, scanOoxml(body).items, rep);
    // the captured selection ends with an (empty) last paragraph: it is kept as a blank-paragraph marker
    expect(md).toBe(`${EXPECTED}\n\n<!-- word:blank -->`);
    expect(rep).toEqual({ total: 5, latex: 5, opaque: 0, unpaired: 0 });
    // the OMML/LaTeX pairs are stored in the sidecar
    const kinds = [...sidecar.entries()].map(([, e]) => e.kind);
    expect(kinds).toEqual(["math", "math", "math", "math", "math"]);
  });

  it("without OOXML the equation images stay opaque images (old behaviour, nothing silently dropped)", () => {
    const md = htmlToMarkdown(html, new MemorySidecar());
    expect(md).toContain("<!-- word:obj");
    expect(md).not.toContain("$");
  });

  it("refuses to pair when the image counts differ (reported as unpaired)", () => {
    const rep = report();
    const items = scanOoxml(body).items.slice(1);
    const md = htmlToMarkdown(html, new MemorySidecar(), new Map(), undefined, undefined, undefined, items, rep);
    expect(rep.unpaired).toBe(4);
    expect(md).not.toContain("$x^2$");
  });
});

describe("apply: lossless-first", () => {
  const sidecar = new MemorySidecar();
  const items = scanOoxml(body).items;
  const originals = items.map((i) => (i.kind === "eq" ? i.omml : ""));
  htmlToMarkdown(html, sidecar, new Map(), undefined, undefined, undefined, items, report());

  it("an untouched equation restores the original OMML byte-for-byte", () => {
    const res = renderWithSidecar(EXPECTED, sidecar);
    expect(res.equations.map((e) => e.omml)).toEqual(originals);
    expect(res.equations.map((e) => e.display)).toEqual([false, false, true, true, false]);
    // markers sit in the HTML: inline ones inside the paragraph text, display ones alone in a paragraph
    expect(res.html).toContain(`and two: ${res.equations[1].marker}`);
    expect(res.html).toContain(`>${res.equations[2].marker}</p>`);
    expect(res.html).not.toContain("$");
  });

  it("an edited equation is regenerated from LaTeX, the others stay byte-identical", () => {
    const res = renderWithSidecar(EXPECTED.replace("$x^2$", () => "$x^3+\\alpha$"), sidecar);
    expect(res.equations[0].omml).toBe(latexToOmml(r`x^3+\alpha`));
    expect(res.equations.slice(1).map((e) => e.omml)).toEqual(originals.slice(1));
  });

  it("a new equation typed in the editor is converted", () => {
    const res = renderWithSidecar("text $\\frac{1}{2}$ more\n\n$$\\int_0^1 x\\,dx$$", new MemorySidecar());
    expect(res.equations).toHaveLength(2);
    expect(res.equations[0].display).toBe(false);
    expect(res.equations[1].display).toBe(true);
    expect(res.equations[1].omml.startsWith("<m:oMathPara>")).toBe(true);
    expect(res.html).toContain(`>${res.equations[1].marker}</p>`);
  });

  it("LaTeX without OMML is handed to the picture rung (no refusal, no plain text yet)", () => {
    const res = renderWithSidecar("bad $\\foo{x}$ here", new MemorySidecar());
    expect(res.equations).toHaveLength(1);
    expect(res.equations[0]).toMatchObject({ latex: "\\foo{x}", omml: "", img: true, display: false });
    expect(res.html).toContain(res.equations[0].marker);
  });

  it("equation packages are insertable flat-OPC with the OMML verbatim", () => {
    const pkg = equationPackage(originals[0]);
    expect(pkg).toContain(`<w:p>${originals[0]}</w:p>`);
    expect(pkg).toContain("xmlns:m=");
  });

  it("math ids (for sidecar pruning) follow the markdown", () => {
    expect(mathIds(EXPECTED).size).toBe(5);
    expect(mathIds("nothing").size).toBe(0);
  });
});

describe("equations without a LaTeX form stay opaque", () => {
  const rp = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>';
  const box = `<m:oMath><m:borderBox><m:e><m:r>${rp}<m:t>x=1</m:t></m:r></m:e></m:borderBox></m:oMath>`;
  const ox = `<w:body><w:p w14:paraId="1"><w:r><w:t>Boxed: </w:t></w:r>${box}<w:r><w:t> end</w:t></w:r></w:p></w:body>`;
  const h = `<body><p class=MsoNormal><span lang=EN-US>Boxed: </span><span style='position:relative;top:2.5pt'><img width=10 height=10 src="~WRS%7bAAAAAAAA-0000-0000-0000-000000000000%7d.files/image001.gif"></span><span>&nbsp;end</span></p></body>`;

  it("becomes a kind=equation placeholder whose paragraph OOXML is kept in the sidecar", () => {
    const items = scanOoxml(ox).items;
    if (items[0].kind === "eq") items[0].paraPkg = "PKG";
    const sc = new MemorySidecar();
    const rep = report();
    const md = htmlToMarkdown(h, sc, new Map(), undefined, undefined, undefined, items, rep);
    expect(md).toMatch(/^<!-- word:obj id=[0-9a-f]{8} kind=equation -->$/);
    expect(rep).toEqual({ total: 1, latex: 0, opaque: 1, unpaired: 0 });
    const [[, entry]] = [...sc.entries()];
    expect(entry).toMatchObject({ kind: "equation", ooxml: "PKG", count: 1 });

    const res = renderWithSidecar(md, sc);
    expect(res.floats).toHaveLength(1);
    expect(res.floats[0].ooxml).toBe("PKG");
    expect(res.lost).toEqual([]);
    expect(res.opaqueEquations).toBe(1);
  });

  it("an opaque equation whose original was not captured is a lost object (apply refuses)", () => {
    const sc = new MemorySidecar();
    sc.set("0badf00d", { kind: "equation", html: "<p>x</p>" });
    const res = renderWithSidecar("<!-- word:obj id=0badf00d kind=equation -->", sc);
    expect(res.lost).toEqual(["0badf00d"]);
  });

  it("a stable id: loading twice gives the same placeholder", () => {
    const run = () => {
      const items = scanOoxml(ox).items;
      if (items[0].kind === "eq") items[0].paraPkg = "PKG";
      return htmlToMarkdown(h, new MemorySidecar(), new Map(), undefined, undefined, undefined, items, report());
    };
    expect(run()).toBe(run());
  });
});

describe("dollar signs", () => {
  it("literal $ in Word text is escaped so it does not read as math, and survives apply", () => {
    const md = htmlToMarkdown("<body><p class=MsoNormal>cost $5 and $6 total</p></body>");
    expect(md).toBe("cost \\$5 and \\$6 total");
    const res = renderWithSidecar(md, new MemorySidecar());
    expect(res.equations).toEqual([]);
    expect(res.html).toContain("cost $5 and $6 total");
  });

  it("Obsidian rules for what is math", () => {
    const spans = (s: string) => findMath(s).map((m) => `${m.display ? "D" : "I"}:${m.latex}`);
    expect(spans("$a$ and $b$")).toEqual(["I:a", "I:b"]);
    expect(spans("$5 and $6")).toEqual([]);
    expect(spans("pay $ 5$")).toEqual([]);
    expect(spans("\\$a\\$")).toEqual([]);
    expect(spans("`$a$`")).toEqual([]);
    expect(spans("```\n$a$\n```\n$b$")).toEqual(["I:b"]);
    expect(spans("$$\n\\frac{a}{b}\n$$")).toEqual(["D:\\frac{a}{b}"]);
    expect(spans("$a\nb$")).toEqual([]);
    expect(spans("$2$3")).toEqual([]);
  });
});
