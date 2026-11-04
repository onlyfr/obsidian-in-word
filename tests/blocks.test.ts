// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findFloatingBlocks, htmlToMarkdown, renderWithSidecar, styleHintsFromParagraphs } from "../src/convert/obsidian";
import { MemorySidecar, pruneSidecar, sidecarFromXml, sidecarToXml } from "../src/convert/sidecar";
import { hasFloating, hashId, parseStyleNames, placeholderIds } from "../src/convert/blocks";

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

describe("stable ids and pruning", () => {
  const img = (guid: string, pid: string) =>
    `<html><body><div class=WordSection1><p id=${pid} class=MsoNormal><span><img width=80 height=40 id="그림 1" src="~WRS%7b${guid}%7d.files/image001.png"></span></p></div></body></html>`;

  it("gives the same placeholder id to an image across loads (temp name and paragraph GUID change)", () => {
    const a = htmlToMarkdown(img("EB93D778-BF5F-4583-B5D5-3183916D2A5E", "9C51EDAA-3C60-4DF5-9CFE-ADD27EEB0288"));
    const b = htmlToMarkdown(img("11111111-2222-3333-4444-555555555555", "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"));
    expect(a).toMatch(/kind=image/);
    expect(a).toBe(b);
  });

  it("prunes sidecar entries that the applied markdown no longer references", () => {
    const sc = new MemorySidecar();
    sc.set("aaaaaaaa", { kind: "table", html: "<table></table>" });
    sc.set("bbbbbbbb", { kind: "image", html: "<img>" });
    const kept = pruneSidecar(sc, placeholderIds("x\n\n<!-- word:obj id=aaaaaaaa kind=table -->\n"));
    expect([...kept.entries()].map(([id]) => id)).toEqual(["aaaaaaaa"]);
  });
});

describe("paragraph style round trip", () => {
  it("collects styled paragraphs for the Office.js fallback and omits junk style blocks for unnamed built-ins", () => {
    const sc = new MemorySidecar();
    const html = `<html><body><p class=MsoNormal>plain</p><p class=MsoQuote>quoted</p><p class=a>custom</p></body></html>`;
    const md = htmlToMarkdown(html, sc, new Map([["MsoQuote", "인용"], ["a", "내 스타일"]]));
    expect(md).toContain("word:style class=MsoQuote name=%EC%9D%B8%EC%9A%A9");
    const { html: out, styled } = renderWithSidecar(md, sc);
    expect(styled).toEqual([
      { text: "quoted", style: "인용" },
      { text: "custom", style: "내 스타일" },
    ]);
    expect(out).toContain('<p class="MsoNormal">plain</p>');
  });

  it("derives class -> style name hints from Office.js paragraphs by text", () => {
    const hints = styleHintsFromParagraphs("<body><p class=MsoQuote>a  quote</p><p class=MsoNormal>x</p></body>", [
      { text: "a quote", style: "인용" },
      { text: "x", style: "표준" },
    ]);
    expect(hints.get("MsoQuote")).toBe("인용");
  });
});

describe("image embedding", () => {
  it("stores the real image bytes (data URI) in the sidecar and keeps the placeholder id stable", () => {
    const html = (guid: string) =>
      `<html><body><div class=WordSection1><p class=MsoNormal><span><img width=80 height=40 src="~WRS%7b${guid}%7d.files/image001.png"></span></p></div></body></html>`;
    const sc = new MemorySidecar();
    const md = htmlToMarkdown(html("AAAAAAAA-0000-0000-0000-000000000000"), sc, new Map(), ["iVBORw0KGgo="]);
    const same = htmlToMarkdown(html("BBBBBBBB-0000-0000-0000-000000000000"), new MemorySidecar(), new Map(), ["iVBORw0KGgo="]);
    expect(md).toBe(same);
    const [, entry] = [...sc.entries()][0];
    expect(entry.html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(entry.html).not.toContain("~WRS");
  });

  it("never keeps the temp ~WRS src: unmatched and floating pictures get a blank placeholder", () => {
    const sc = new MemorySidecar();
    htmlToMarkdown(
      '<html><body><p><img src="~WRS%7bX%7d.files/a.png" align=left><span>Anchor</span></p></body></html>',
      sc,
      new Map(),
      [],
    );
    const html = [...sc.entries()][0][1].html;
    expect(html).not.toContain("~WRS");
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain('alt="picture not preserved"');
  });

  it("pairs only non-floating pictures with the inline picture bytes", () => {
    const sc = new MemorySidecar();
    htmlToMarkdown(
      '<html><body><p><img src="~WRS%7bX%7d.files/a.png" align=left><span>t</span></p><table><tr><td><img src="~WRS%7bX%7d.files/a.png"></td></tr></table></body></html>',
      sc,
      new Map(),
      ["iVBORw0KGgo="],
    );
    const htmls = [...sc.entries()].map(([, e]) => e.html);
    expect(htmls.some((h) => h.includes('src="data:image/png;base64,iVBORw0KGgo="'))).toBe(true);
    expect(htmls.every((h) => !h.includes("~WRS"))).toBe(true);
  });
});

describe("real Word list shapes (getHtml)", () => {
  const num = (cls: string, ml: number, mark: string, t: string) =>
    `<p class=${cls} style='margin-left:${ml}.0pt;text-indent:-18.0pt'><span lang=EN-US>${mark}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><span lang=EN-US>${t}</span></p>`;
  const bul = (cls: string, ml: number, t: string) =>
    `<p class=${cls} style='margin-left:${ml}.0pt;text-indent:-18.0pt'><span lang=EN-US style='font-family:Symbol'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span><span lang=EN-US>${t}</span></p>`;
  const wrap = (body: string) => `<html><body><div class=WordSection1>${body}</div></body></html>`;

  it("keeps the start number of a numbered list and separates lists split by a paragraph", () => {
    const md = htmlToMarkdown(
      wrap(
        num("MsoListNumberCxSpFirst", 44, "3.", "three") +
          num("MsoListNumberCxSpLast", 44, "4.", "four") +
          "<p class=MsoNormal>Between</p>" +
          num("MsoListNumberCxSpFirst", 44, "1.", "alpha") +
          num("MsoListNumberCxSpLast", 44, "2.", "beta"),
      ),
    );
    const m = "<!-- word:style class=MsoListNumber name=MsoListNumber -->\n";
    expect(md).toBe(`${m}3. three\n4. four\n\nBetween\n\n${m}1. alpha\n2. beta`);
  });

  it("produces indented markdown for mixed 3-level nesting (margin-left = level)", () => {
    const md = htmlToMarkdown(
      wrap(
        num("MsoListParagraph", 18, "1.", "one") +
          bul("MsoListParagraph", 36, "a") +
          num("MsoListParagraph", 54, "1)", "x") +
          num("MsoListParagraph", 54, "2)", "y") +
          bul("MsoListParagraph", 36, "b") +
          num("MsoListParagraph", 18, "2.", "two"),
      ),
    );
    expect(md).toBe("1. one\n    - a\n        1. x\n        2. y\n    - b\n2. two");
  });

  it("renders nested markdown back to nested lists", () => {
    const { html } = renderWithSidecar("1. one\n    - a\n        1. x\n2. two", new MemorySidecar());
    expect(html.replace(/\s+/g, "").replace(/ class="MsoListParagraph"/g, "").replace(/liclass="MsoListParagraph"/g, "li")).toBe(
      "<ol><li>one<ul><li>a<ol><li>x</li></ol></li></ul></li><li>two</li></ol>",
    );
  });
});

describe("list styles round trip", () => {
  const li = (cls: string, mark: string, t: string, ml = 44) =>
    `<p class=${cls} style='margin-left:${ml}.0pt;text-indent:-22.0pt'><span lang=EN-US>${mark}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><span lang=EN-US>${t}</span></p>`;
  const wrap = (b: string) => `<html><body><div class=WordSection1>${b}</div></body></html>`;

  it("renders markdown lists with the List Paragraph class by default", () => {
    const { html } = renderWithSidecar("- a\n- b", new MemorySidecar());
    expect(html).toContain('<li class="MsoListParagraph">a</li>');
  });

  it("round-trips List Number / List Bullet through a marker, but not List Paragraph", () => {
    const num = htmlToMarkdown(wrap(li("MsoListNumberCxSpFirst", "1.", "one") + li("MsoListNumberCxSpLast", "2.", "two")));
    expect(num).toBe("<!-- word:style class=MsoListNumber name=MsoListNumber -->\n1. one\n2. two");
    const { html } = renderWithSidecar(num, new MemorySidecar());
    expect(html.split("\n").join("")).toContain('<ol><li class="MsoListNumber">one</li><li class="MsoListNumber">two</li></ol>');
    const plain = htmlToMarkdown(wrap(li("MsoListParagraph", "1.", "one", 18)));
    expect(plain).toBe("1. one");
  });

  it("applies the marker's class to nested items of that list only", () => {
    const { html } = renderWithSidecar(
      "<!-- word:style class=MsoListBullet name=MsoListBullet -->\n- a\n    - b\n- c",
      new MemorySidecar(),
    );
    expect(html).toContain('<li class="MsoListBullet">a');
    expect(html).toContain('<li class="MsoListBullet">b</li>');
  });
});

describe("floating objects (real getHtml shapes)", () => {
  const SQUARE =
    '<p id=A class=MsoNormal><img width=80 height=40 src="~WRS%7bG%7d.files/image001.png" align=left hspace=12><span lang=EN-US>Intro paragraph.</span></p>';
  const TEXTBOX =
    '<p id=B class=MsoNormal><span style=\'position:absolute;z-index:251660288;margin-left:371px;margin-top:111px;width:161px;height:54px\'><img width=161 height=54 src="~WRS%7bG%7d.files/image002.png" alt="Text box content"></span><span lang=EN-US>Text box paragraph.</span></p>';
  const INLINE =
    '<p class=MsoNormal><span lang=EN-US>Inline: <img width=80 height=40 id="그림 1" src="~WRS%7bG%7d.files/image001.png"></span></p>';
  const PLAIN_TABLE = "<table><tr><td><p>plain</p></td></tr></table>";
  const FLOAT_TABLE =
    "<table><tr><td><p class=MsoNormal><span style='position:absolute;z-index:1;margin-left:467px;margin-top:440px'><img width=80 height=40 src=\"~WRS%7bG%7d.files/image001.png\"></span><span>cell with floating picture</span></p></td></tr></table>";
  const wrap = (b: string) => `<html><body><div class=WordSection1>${b}</div></body></html>`;
  const el = (h: string) => new DOMParser().parseFromString(`<body>${h}</body>`, "text/html").body.firstElementChild!;

  it("detects square-wrapped and absolutely positioned objects but not inline pictures", () => {
    expect(hasFloating(el(SQUARE))).toBe(true);
    expect(hasFloating(el(TEXTBOX))).toBe(true);
    expect(hasFloating(el(FLOAT_TABLE))).toBe(true);
    expect(hasFloating(el(INLINE))).toBe(false);
    expect(hasFloating(el(PLAIN_TABLE))).toBe(false);
  });

  it("lists floating blocks in document order with the top-level table index", () => {
    const blocks = findFloatingBlocks(wrap(SQUARE + INLINE + PLAIN_TABLE + FLOAT_TABLE + TEXTBOX));
    expect(blocks).toEqual([
      { tag: "p", text: "Intro paragraph.", tableIndex: -1 },
      { tag: "table", text: "cell with floating picture", tableIndex: 1 },
      { tag: "p", text: "Text box paragraph.", tableIndex: -1 },
    ]);
  });

  it("stores OOXML for floating blocks and reports what could be preserved", () => {
    const sc = new MemorySidecar();
    const report = { total: 0, preserved: 0 };
    const md = htmlToMarkdown(wrap(SQUARE + "<p>mid</p>" + TEXTBOX), sc, new Map(), [], ["OX-1", undefined], report);
    expect(md.match(/kind=float/g)).toHaveLength(2);
    expect(report).toEqual({ total: 2, preserved: 1 });
    const entries = [...sc.entries()].map(([, e]) => e);
    expect(entries.filter((e) => e.ooxml === "OX-1")).toHaveLength(1);
    expect(entries.every((e) => !e.html.includes("~WRS"))).toBe(true);
  });

  it("renders OOXML-backed blocks as marker paragraphs in order, and lists blocks without OOXML as lost", () => {
    const sc = new MemorySidecar();
    sc.set("aaaaaaaa", { kind: "float", html: "<p>x</p>", ooxml: "OX-A" });
    sc.set("bbbbbbbb", { kind: "float", html: "<p>y</p>" });
    sc.set("cccccccc", { kind: "float", html: "<p>z</p>", ooxml: "OX-C" });
    const md = [
      "before",
      "<!-- word:obj id=aaaaaaaa kind=float -->",
      "middle",
      "<!-- word:obj id=bbbbbbbb kind=float -->",
      "<!-- word:obj id=cccccccc kind=float -->",
      "after",
    ].join("\n\n");
    const { html, floats, lost } = renderWithSidecar(md, sc);
    expect(floats).toEqual([
      { marker: "OWBFLOAT0Xaaaaaaaa", ooxml: "OX-A" },
      { marker: "OWBFLOAT1Xcccccccc", ooxml: "OX-C" },
    ]);
    expect(lost).toEqual(["bbbbbbbb"]);
    const order = ["before", "OWBFLOAT0Xaaaaaaaa", "middle", "<p>y</p>", "OWBFLOAT1Xcccccccc", "after"].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("top-and-bottom wrapped picture (layout table hack)", () => {
  const HACK = `<html><body><div class=WordSection1><p id=X class=MsoNormal><span
style='position:absolute;z-index:-1;margin-left:400px;margin-top:0px'><img width=80 height=40 src="~WRS%7bG%7d.files/image001.png"></span></p>
<p class=MsoNormal><span lang=EN-US>Before.</span></p>
<p class=MsoNormal>
<table cellpadding=0 cellspacing=0>
 <tr>
  <td width=400 height=0></td>
 </tr>
 <tr>
  <td></td>
  <td><img width=80 height=40
  src="~WRS%7bG%7d.files/image001.png"></td>
 </tr>
</table>

<br clear=ALL>
<span lang=EN-US>Target paragraph.</span></p>
<p class=MsoNormal><span lang=EN-US>Other paragraph.</span></p></div></body></html>`;

  it("is detected as a floating paragraph with its own text and does not create a phantom table", () => {
    const blocks = findFloatingBlocks(HACK);
    expect(blocks.map((b) => b.tag)).toEqual(["p", "p"]);
    expect(blocks[1].text).toBe("Target paragraph.");
    expect(blocks.every((b) => b.tableIndex === -1)).toBe(true);
  });
});

describe("parseStyleNames", () => {
  it("reads class -> Word style names from <style> blocks only", () => {
    const html = `<html><head><style>
      p.MsoNormal, li.MsoNormal {mso-style-name:"표준";}
      p.a3, div.a3 {mso-style-name:"본문 들여쓰기"; margin-left:20pt;}
    </style></head><body><p class=a3>x {mso-style-name:"bogus"} y</p></body></html>`;
    const names = parseStyleNames(html);
    expect(names.get("MsoNormal")).toBe("표준");
    expect(names.get("a3")).toBe("본문 들여쓰기");
    expect(names.size).toBe(2);
  });

  it("is linear on large brace-free bodies (was quadratic)", () => {
    const body = "<p class=MsoNormal>some text without any braces at all</p>".repeat(30000); // ~1.7 MB
    const t0 = performance.now();
    parseStyleNames(`<html><head><style>p.a{mso-style-name:"A";}</style></head><body>${body}</body></html>`);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
