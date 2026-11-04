import { describe, expect, it } from "vitest";
import {
  BLANK_TOKEN,
  MAX_BLANK_RUN,
  blankMarker,
  expandBlankMarkers,
  htmlToMarkdown,
  renderWithSidecar,
} from "../src/convert/obsidian";
import { MemorySidecar } from "../src/convert/sidecar";
import { regionSignature } from "../src/taskpane/word";

const P = (t: string, cls = "MsoNormal") => `<p class=${cls}><span lang=EN-US>${t}</span></p>`;
const BLANK = P("&nbsp;");
const doc = (...parts: string[]) => `<html><body><div class=WordSection1>${parts.join("\n")}</div></body></html>`;
const toMd = (h: string, trailing?: number) =>
  htmlToMarkdown(h, new MemorySidecar(), new Map(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, trailing);

describe("load: empty paragraphs become <!-- word:blank --> markers", () => {
  it("single, run, none", () => {
    const md = toMd(doc(P("A"), BLANK, P("B"), BLANK, BLANK, BLANK, P("C"), P("D")));
    expect(md).toBe("A\n\n<!-- word:blank -->\n\nB\n\n<!-- word:blank n=3 -->\n\nC\n\nD");
  });

  it("only plain empty paragraphs count: styled, with objects, with text, in tables or lists do not", () => {
    expect(toMd(doc(P("A"), `<p class=MsoNormal><span>&nbsp;</span><br></p>`, P("B")))).not.toContain("word:blank"); // line break
    expect(toMd(doc(P("A"), `<p class=MsoNormal><a name=x></a></p>`, P("B")))).not.toContain("word:blank"); // bookmark
    expect(toMd(doc(P("A"), `<p class=MsoQuote><span>&nbsp;</span></p>`, P("B")))).not.toContain("word:blank"); // other style
    expect(toMd(doc(P("A"), `<p class=MsoNormal><span> x </span></p>`, P("B")))).not.toContain("word:blank");
    expect(toMd(doc(P("A"), `<ul><li>one</li><li>&nbsp;</li></ul>`))).not.toContain("word:blank");
  });

  it("a paragraph without a class and bare nbsp is blank too; blank at the start works", () => {
    expect(toMd(doc(`<p><span>&nbsp;</span></p>`, P("A")))).toBe("<!-- word:blank -->\n\nA");
  });

  it("an equation fixture-like selection end: kept when Office.js is not consulted", () => {
    expect(toMd(doc(P("A"), BLANK))).toBe("A\n\n<!-- word:blank -->");
  });

  describe("the empty paragraph getHtml adds when the selection includes its last paragraph mark", () => {
    // measured in Word: 3 empty paragraphs at the end of a document arrive as 4
    const html = doc(P("A"), BLANK, BLANK, BLANK, BLANK);
    it("is dropped when the html has exactly one more than Office.js counts", () => {
      expect(toMd(html, 3)).toBe("A\n\n<!-- word:blank n=3 -->");
      expect(toMd(doc(P("A"), BLANK), 0)).toBe("A");
    });
    it("is kept when the numbers agree or differ by more", () => {
      expect(toMd(html, 4)).toBe("A\n\n<!-- word:blank n=4 -->"); // selection without the last mark
      expect(toMd(html, 1)).toBe("A\n\n<!-- word:blank n=4 -->");
      expect(toMd(html)).toBe("A\n\n<!-- word:blank n=4 -->");
    });
    it("only looks at the end of the document", () => {
      expect(toMd(doc(P("A"), BLANK, P("B"), BLANK), 0)).toBe("A\n\n<!-- word:blank -->\n\nB");
    });
  });
});

describe("apply: markers become empty paragraphs", () => {
  const blanks = (html: string) => (html.match(new RegExp(`<p class="MsoNormal">${BLANK_TOKEN}</p>`, "g")) ?? []).length;
  const render = (md: string) => renderWithSidecar(md, new MemorySidecar());

  it("expands to that many marker paragraphs, in place", () => {
    const r = render("A\n\n<!-- word:blank n=3 -->\n\nB\n\n<!-- word:blank -->\n\nC");
    expect(blanks(r.html)).toBe(4);
    expect(r.html.replace(/\n/g, "")).toBe(
      `<p class="MsoNormal">A</p><p class="MsoNormal">${BLANK_TOKEN}</p>`.repeat(1) +
        `<p class="MsoNormal">${BLANK_TOKEN}</p><p class="MsoNormal">${BLANK_TOKEN}</p><p class="MsoNormal">B</p>` +
        `<p class="MsoNormal">${BLANK_TOKEN}</p><p class="MsoNormal">C</p>`,
    );
  });

  it("caps a run and tolerates bad counts", () => {
    expect(blanks(render(`A\n\n<!-- word:blank n=${MAX_BLANK_RUN + 500} -->\n\nB`).html)).toBe(MAX_BLANK_RUN);
    expect(blanks(render("A\n\n<!-- word:blank n=0 -->\n\nB").html)).toBe(1);
    expect(expandBlankMarkers("<!-- word:blank n=2 -->").match(new RegExp(BLANK_TOKEN, "g"))).toHaveLength(2);
  });

  it("old markdown without markers is unchanged (nothing is added)", () => {
    const r = render("A\n\nB\n\n- x\n- y\n\nC");
    expect(blanks(r.html)).toBe(0);
    expect(r.html).not.toContain(BLANK_TOKEN);
  });

  it("works next to a table block and keeps the table", () => {
    const r = render("| a | b |\n| --- | --- |\n| c | d |\n\n<!-- word:blank -->\n\nafter");
    expect(r.tables).toHaveLength(1);
    expect(blanks(r.html)).toBe(1);
    // order: table marker, blank, text
    const order = [r.tables[0].marker, BLANK_TOKEN, "after"].map((s) => r.html.indexOf(s));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("a marker is not confused with other comment markers", () => {
    const r = render("<!-- word:style class=a3 name=Quote -->\ntext\n\n<!-- word:blank -->\n\nmore");
    expect(blanks(r.html)).toBe(1);
    expect(r.styled).toEqual([{ text: "text", style: "Quote" }]);
  });
});

describe("load -> apply -> load is stable for empty paragraphs", () => {
  // what Word would contain after applying: every marker paragraph cleared, i.e. a real empty paragraph
  const asWord = (html: string) => doc(...html.split("\n").filter(Boolean).map((l) => l.replace(new RegExp(`<p class="MsoNormal">${BLANK_TOKEN}</p>`), BLANK).replace(/^<p class="MsoNormal">([^<]*)<\/p>$/, (_m, t) => P(t))));
  for (const md of [
    "A\n\n<!-- word:blank -->\n\nB",
    "<!-- word:blank n=2 -->\n\nA\n\n<!-- word:blank n=3 -->\n\nB\n\n<!-- word:blank -->",
    "A\n\nB",
  ]) {
    it(JSON.stringify(md), () => {
      const r = renderWithSidecar(md, new MemorySidecar());
      const trailing = (md.match(/word:blank(?: n=(\d+))? -->$/)?.[1] ?? (md.endsWith("-->") ? "1" : "0")) as string;
      // the real document has `trailing` empty paragraphs at the end; getHtml shows one more when the mark is selected
      const html = asWord(r.html).replace("</div>", (md.endsWith("-->") ? BLANK : "") + "</div>");
      expect(toMd(html, Number(trailing))).toBe(md);
    });
  }
});

describe("blankMarker / regionSignature", () => {
  it("marker text", () => {
    expect(blankMarker(1)).toBe("<!-- word:blank -->");
    expect(blankMarker(7)).toBe("<!-- word:blank n=7 -->");
  });
  it("the signature ignores whitespace noise but not content, count or order", () => {
    const a = regionSignature(["Hello  world", "", "x"]);
    expect(regionSignature(["Hello world", "", "x"])).toBe(a);
    expect(regionSignature(["Hello world", "x"])).not.toBe(a);
    expect(regionSignature(["Hello world!", "", "x"])).not.toBe(a);
    expect(regionSignature(["x", "", "Hello world"])).not.toBe(a);
  });
});
