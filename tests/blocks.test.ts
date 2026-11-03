// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { htmlToMarkdown, renderWithSidecar } from "../src/convert/obsidian";
import { MemorySidecar, sidecarFromXml, sidecarToXml } from "../src/convert/sidecar";
import { hashId } from "../src/convert/blocks";

const TABLE = '<table style="mso-yfti-tbllook:1"><tr><td colspan="2">merged</td></tr></table>';
const wordHtml = `<html><body><p>before</p>${TABLE}<p>after</p></body></html>`;

describe("opaque Word objects", () => {
  it("replaces a table with a placeholder and stores the original", () => {
    const sc = new MemorySidecar();
    const md = htmlToMarkdown(wordHtml, sc);
    const id = hashId(TABLE.replace('style="mso-yfti-tbllook:1"', 'style="mso-yfti-tbllook:1"'));
    expect(md).toMatch(/<!-- word:obj id=[0-9a-f]{8} kind=table -->/);
    expect(md).toContain("before");
    expect(md).toContain("after");
    expect([...sc.entries()].map(([, e]) => e.kind)).toEqual(["table"]);
    expect(id).toHaveLength(8);
  });

  it("restores the table after editing the surrounding text", () => {
    const sc = new MemorySidecar();
    const md = htmlToMarkdown(wordHtml, sc).replace("before", "**edited** before");
    const { html, missing } = renderWithSidecar(md, sc);
    expect(missing).toEqual([]);
    expect(html).toContain("<strong>edited</strong> before");
    expect(html).toContain('colspan="2"');
    expect(html.indexOf("edited")).toBeLessThan(html.indexOf("<table"));
    expect(html.indexOf("<table")).toBeLessThan(html.indexOf("after"));
  });

  it("keeps the object when its placeholder is moved", () => {
    const sc = new MemorySidecar();
    const md = htmlToMarkdown(wordHtml, sc);
    const ph = /<!-- word:obj [^>]+ -->/.exec(md)![0];
    const moved = `${ph}\n\nfirst\n\nsecond`;
    const { html } = renderWithSidecar(moved, sc);
    expect(html.indexOf("<table")).toBeLessThan(html.indexOf("first"));
  });

  it("drops the object when the placeholder is deleted", () => {
    const sc = new MemorySidecar();
    const md = htmlToMarkdown(wordHtml, sc).replace(/<!-- word:obj [^>]+ -->/, "");
    expect(renderWithSidecar(md, sc).html).not.toContain("<table");
  });

  it("reports unknown placeholder ids", () => {
    const { html, missing } = renderWithSidecar("<!-- word:obj id=deadbeef kind=table -->", new MemorySidecar());
    expect(missing).toEqual(["deadbeef"]);
    expect(html).toContain("missing Word object deadbeef");
  });

  it.each([
    ["image", '<p>x <img src="a.png"></p>'],
    ["tracked", "<p>a <ins>b</ins></p>"],
    ["footnote", '<p>a<a href="#_ftn1">1</a></p>'],
    ["object", "<p><v:shape>s</v:shape></p>"],
  ])("detects %s", (kind, body) => {
    const sc = new MemorySidecar();
    expect(htmlToMarkdown(`<body>${body}</body>`, sc)).toContain(`kind=${kind} -->`);
  });

  it("gives identical objects identical ids and different objects different ids", () => {
    expect(hashId(TABLE)).toBe(hashId(TABLE));
    expect(hashId(TABLE)).not.toBe(hashId(TABLE + " "));
  });

  it("leaves plain text blocks editable", () => {
    const sc = new MemorySidecar();
    expect(htmlToMarkdown("<body><h1>T</h1><p>p</p></body>", sc)).toBe("# T\n\np");
    expect([...sc.entries()]).toHaveLength(0);
  });
});

describe("sidecar xml", () => {
  it("round-trips arbitrary html", () => {
    const sc = new MemorySidecar();
    sc.set("aa", { kind: "table", html: '<td>]]> & "quotes" 한글</td>' });
    const back = sidecarFromXml(sidecarToXml(sc));
    expect(back.get("aa")).toEqual(sc.get("aa"));
  });
});

describe("Word's WordSection wrapper", () => {
  it("keeps non-table content editable when the section contains a table", () => {
    const sc = new MemorySidecar();
    const html = `<html><body><div class=WordSection1><h1>Title</h1><p class=MsoNormal>plain</p>${TABLE}<p>after</p></div></body></html>`;
    const md = htmlToMarkdown(html, sc);
    expect(md).toContain("# Title");
    expect(md).toContain("plain");
    expect(md).toContain("after");
    expect(md).toMatch(/<!-- word:obj id=[0-9a-f]{8} kind=table -->/);
    expect([...sc.entries()]).toHaveLength(1);
  });
});

describe("real Word getHtml quirks", () => {
  const LI = (cls: string, t: string) =>
    `<p class=${cls} style='margin-left:44.0pt'><span lang=EN-US style='font-family:Wingdings'>l<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><span lang=EN-US>${t}</span></p>`;

  it("turns MsoListBullet paragraphs into markdown list items without the Wingdings marker", () => {
    const html = `<html><body><div class=WordSection1>${LI("MsoListBulletCxSpFirst", "one")}${LI("MsoListBulletCxSpLast", "two")}<p>after</p></div></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("- one\n- two");
    expect(md).not.toMatch(/^l /m);
  });

  it("does not escape plain-text wikilinks", () => {
    const md = htmlToMarkdown("<html><body><p>See [[Some Note]] and [[Other|alias]].</p></body></html>");
    expect(md).toContain("See [[Some Note]] and [[Other|alias]].");
  });
});

describe("paragraph styles", () => {
  const word = `<html><head><style>
    p.MsoNormal, li.MsoNormal {mso-style-name:"표준";}
    p.a3, li.a3, div.a3 {mso-style-name:"본문 들여쓰기"; margin-left:20pt;}
  </style></head><body>
    <h1>Title</h1>
    <p class=MsoNormal>plain</p>
    <p class=a3>indented text</p>
    <p class=MsoQuote>quoted</p>
  </body></html>`;

  it("emits a style marker only for non-default paragraph styles", () => {
    const md = htmlToMarkdown(word);
    expect(md).toContain("<!-- word:style class=a3 name=%EB%B3%B8%EB%AC%B8%20%EB%93%A4%EC%97%AC%EC%93%B0%EA%B8%B0 -->\nindented text");
    expect(md).toContain("<!-- word:style class=MsoQuote name=MsoQuote -->\nquoted");
    expect(md).not.toMatch(/word:style class=MsoNormal/);
    expect(md).toContain("# Title");
  });

  it("restores the style class and mso-style-name on apply", () => {
    const { html } = renderWithSidecar(htmlToMarkdown(word), new MemorySidecar());
    expect(html).toContain('<p class="a3">indented text</p>');
    expect(html).toContain('mso-style-name:"본문 들여쓰기"');
    expect(html).toContain('<p class="MsoNormal">plain</p>');
    expect(html).toContain('<p class="MsoQuote">quoted</p>');
  });

  it("a style marker does not leak to the following paragraph", () => {
    const md = "<!-- word:style class=a3 name=X -->\nfirst\n\nsecond";
    const { html } = renderWithSidecar(md, new MemorySidecar());
    expect(html).toContain('<p class="a3">first</p>');
    expect(html).toContain('<p class="MsoNormal">second</p>');
  });

  it("round-trips wikilinks as plain text", () => {
    const md = htmlToMarkdown("<body><p>see [[Some Note]] and [[A|b]]</p></body>");
    expect(md).toBe("see [[Some Note]] and [[A|b]]");
    expect(htmlToMarkdown(renderWithSidecar(md, new MemorySidecar()).html)).toBe(md);
  });
});
