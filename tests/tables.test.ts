import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { htmlToMarkdown, renderWithSidecar, type TableReport } from "../src/convert/obsidian";
import { MemorySidecar } from "../src/convert/sidecar";
import {
  analyzeHtmlTable,
  buildTableOoxml,
  countTables,
  findTableBlocks,
  inlineToRuns,
  modelToLines,
  normalizeIds,
  scanTables,
  tableId,
  tableRels,
  type TableModel,
} from "../src/convert/tables";
import { wrapPackage } from "../src/convert/equations";

// Real shapes captured from desktop Word: getHtml (tables carry <thead> for a header row, colspan/rowspan, nested
// tables, several <p> per cell) and the OOXML of the same range (raw <w:tbl>, hyperlink relationship).
const html = readFileSync("tests/fixtures/tables-getHtml.html", "utf8");
const pkg = readFileSync("tests/fixtures/tables-ooxml.xml", "utf8");

const caps = () => scanTables(pkg).map((raw) => ({ raw, gz: "gz:" + raw.length, rels: tableRels(raw, pkg) }));
const load = () => {
  const sidecar = new MemorySidecar();
  const report: TableReport = { total: 0, simple: 0, opaque: 0, unpaired: 0, reasons: {} };
  const md = htmlToMarkdown(html, sidecar, new Map(), undefined, undefined, undefined, undefined, undefined, caps(), report);
  return { md, sidecar, report };
};
const sources = (sidecar: MemorySidecar) => {
  const m = new Map<string, { raw: string; rels?: string }>();
  for (const [id, e] of sidecar.entries()) if (e.kind === "table") m.set(id, { raw: scanTables(pkg)[Number(e.ooxml!.slice(3)) ? 0 : 0], rels: e.rels });
  return m;
};
// the fake gz above is the raw length: map back to the raw by that length
const rawByGz = (gz: string) => scanTables(pkg).find((r) => "gz:" + r.length === gz)!;
const srcMap = (sidecar: MemorySidecar) => {
  const m = new Map<string, { raw: string; rels?: string }>();
  for (const [id, e] of sidecar.entries()) if (e.kind === "table") m.set(id, { raw: rawByGz(e.ooxml!), rels: e.rels });
  return m;
};
void sources;

const idOf = (md: string, header: string) => new RegExp(`<!-- word:table id=(\\w+) -->\\n\\| ${header.replace(/[|*]/g, "\\$&")}`).exec(md)?.[1];

describe("OOXML tables (real Word shape)", () => {
  it("finds the top-level tables in order, nested ones stay inside their parent", () => {
    const raws = scanTables(pkg);
    expect(raws).toHaveLength(11);
    expect(countTables(pkg)).toBe(11);
    expect(raws[7]).toContain("outer");
    expect(raws[7].match(/<w:tbl>/g)).toHaveLength(2);
  });
  it("hyperlink relationships are carried along", () => {
    const raws = scanTables(pkg);
    expect(tableRels(raws[3], pkg)).toContain('Target="https://example.com/p"');
    expect(tableRels(raws[0], pkg)).toBe("");
  });
  it("ids ignore the noise Word adds per call, not the content", () => {
    const raw = scanTables(pkg)[0];
    expect(tableId(raw)).toBe(tableId(raw.replace(/w14:paraId="[^"]*"/g, 'w14:paraId="DEADBEEF"').replace(/<w:tblPrEx>[\s\S]*?<\/w:tblPrEx>/g, "")));
    expect(tableId(raw)).not.toBe(tableId(raw.replace(">a<", ">A<")));
  });
});

describe("load: simple tables become GFM tables", () => {
  const { md, report, sidecar } = load();

  it("classifies the corpus (what stays opaque and why)", () => {
    expect(report.total).toBe(11);
    expect(report.simple).toBe(7);
    expect(report.reasons).toEqual({ "merged cells": 2, "nested table": 1, "several paragraphs in a cell": 1 });
  });

  it("plain, header (<thead>), aligned, formatted, pipe + line break, empty cells, one column", () => {
    const tbl = (h: string) => md.slice(md.indexOf(h)).split("\n\n")[0];
    expect(tbl("| a | b | c |")).toBe("| a | b | c |\n| --- | --- | --- |\n| d | e | f |\n| g | h | i |");
    expect(tbl("| H1 | H2 |")).toBe("| H1 | H2 |\n| --- | --- |\n| x | y |"); // header bold/shading do not show as markdown
    expect(tbl("| L | C | R |")).toBe("| L | C | R |\n| --- | :---: | ---: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |");
    expect(tbl("| fmt | val |")).toBe("| fmt | val |\n| --- | --- |\n| **bold** _ital_ ~~strike~~ code | [link](https://example.com/p) |");
    expect(tbl("| p | q |")).toBe("| p | q |\n| --- | --- |\n| a \\| b | line1<br>line2 |");
    expect(tbl("|   | x |")).toBe("|   | x |\n| --- | --- |\n| y |   |");
    expect(tbl("| only |")).toBe("| only |\n| --- |\n| one |\n| col |");
  });

  it("keeps merged / nested / multi-paragraph tables as the opaque placeholders they were", () => {
    expect(md.match(/<!-- word:obj id=[0-9a-f]{8} kind=table -->/g)).toHaveLength(4);
  });

  it("stores the original table in the sidecar under the marker id", () => {
    const entries = [...sidecar.entries()].filter(([, e]) => e.kind === "table");
    // 7 markdown tables + the 4 opaque placeholders (kind=table too)
    expect(entries.filter(([, e]) => e.md).length).toBe(7);
    const id = idOf(md, "a | b | c");
    expect(sidecar.get(id!)).toMatchObject({ kind: "table", md: "| a | b | c |\n| --- | --- | --- |\n| d | e | f |\n| g | h | i |" });
  });

  it("without OOXML captures every table stays opaque (nothing lost)", () => {
    const m = htmlToMarkdown(html, new MemorySidecar());
    expect(m).not.toContain("word:table");
    expect(m.match(/kind=table/g)).toHaveLength(11);
  });

  it("an HTML/OOXML count mismatch keeps everything opaque and says so", () => {
    const rep: TableReport = { total: 0, simple: 0, opaque: 0, unpaired: 0, reasons: {} };
    const m = htmlToMarkdown(html, new MemorySidecar(), new Map(), undefined, undefined, undefined, undefined, undefined, caps().slice(1), rep);
    expect(rep.unpaired).toBe(11);
    expect(m).not.toContain("word:table");
  });
});

describe("apply: lossless first", () => {
  const { md, sidecar } = load();
  const src = srcMap(sidecar);

  it("an unchanged table restores the original OOXML byte for byte", () => {
    const res = renderWithSidecar(md, sidecar, src);
    expect(res.badTables).toEqual([]);
    expect(res.tables).toHaveLength(7);
    const raws = scanTables(pkg);
    const want = [0, 1, 2, 3, 4, 8, 9].map((i) => raws[i]);
    expect(res.tables.map((t) => t.ooxml)).toEqual(want);
    expect(res.tables.every((t) => !t.edited)).toBe(true);
    expect(res.tables[3].rels).toContain("https://example.com/p");
    expect(res.html).toContain(`>${res.tables[0].marker}</p>`);
    expect(res.html).not.toContain("word:table");
  });

  it("an edited cell: that cell is rewritten, every other cell is the original markup", () => {
    const edited = md.replace("| d | e | f |", "| d | E2 | f |");
    const res = renderWithSidecar(edited, sidecar, src);
    const t = res.tables[0];
    expect(t.edited).toBe(true);
    const orig = scanTables(pkg)[0];
    const cells = (x: string) => Array.from(x.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g), (m) => normalizeIds(m[0]));
    const o = cells(orig);
    const n = cells(t.ooxml);
    expect(n).toHaveLength(9);
    n.forEach((c, i) => {
      if (i === 4) expect(c).toContain(">E2<");
      else expect(c).toBe(o[i]);
    });
    // table-level properties survive
    expect(t.ooxml).toContain("<w:tblBorders>");
    expect(t.ooxml).toContain('<w:gridCol w:w="3000"/>');
  });

  it("header formatting survives an edited header row (shading, tblHeader, bold)", () => {
    const res = renderWithSidecar(md.replace("| H1 | H2 |", "| Head | H2 |"), sidecar, src);
    const x = res.tables[1].ooxml;
    expect(x).toContain('w:fill="D9E2F3"');
    expect(x).toContain("<w:tblHeader/>");
    expect(x).toMatch(/<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>Head</);
  });

  it("new rows copy the last row, deleted columns shrink the grid and the table width", () => {
    const res = renderWithSidecar(md.replace("| a | b | c |\n| --- | --- | --- |\n| d | e | f |\n| g | h | i |", "| a | b |\n| --- | --- |\n| d | e |\n| g | h |\n| NEW | row |"), sidecar, src);
    const x = res.tables[0].ooxml;
    expect((x.match(/<w:tr[ >]/g) ?? []).length).toBe(4);
    expect(x.match(/<w:gridCol /g)).toHaveLength(2);
    expect(x).toContain('<w:tblW w:w="6000" w:type="dxa"/>');
    expect(x).toContain(">NEW<");
    // no duplicated paragraph ids from cloned rows
    const ids = Array.from(x.matchAll(/w14:paraId="([^"]+)"/g), (m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("changing a column alignment rewrites that column's paragraphs only", () => {
    const res = renderWithSidecar(md.replace("| L | C | R |\n| --- | :---: | ---: |", "| L | C | R |\n| :---: | :---: | ---: |"), sidecar, src);
    const x = res.tables[2].ooxml;
    expect(Array.from(x.matchAll(/<w:jc w:val="(\w+)"\/>/g), (m) => m[1])).toEqual(["center", "center", "right", "center", "center", "right", "center", "center", "right"]);
  });

  it("markdown formatting becomes runs (bold, italic, strike, code, links, breaks)", () => {
    const res = renderWithSidecar(md.replace("| **bold** _ital_ ~~strike~~ code | [link](https://example.com/p) |", "| **b** _i_ ~~s~~ `c` x<br>y | [t](https://e.example/x) |"), sidecar, src);
    const x = res.tables[3].ooxml;
    expect(x).toMatch(/<w:b\/>[\s\S]*>b</);
    expect(x).toContain("<w:i/>");
    expect(x).toContain("<w:strike/>");
    expect(x).toContain("Consolas");
    expect(x).toContain("<w:br/>");
    expect(x).toContain('HYPERLINK &quot;https://e.example/x&quot;');
  });

  it("a table without marker is built as a new bordered table with a bold header row", () => {
    const res = renderWithSidecar("| Name | Qty |\n|:--|--:|\n| apple | **3** |\n", new MemorySidecar());
    const x = res.tables[0].ooxml;
    expect(x).toContain("<w:tblHeader/>");
    expect(x).toContain("<w:tblBorders>");
    expect(x).toMatch(/<w:rPr><w:b\/><\/w:rPr><w:t[^>]*>Name</);
    expect(Array.from(x.matchAll(/<w:jc w:val="(\w+)"\/>/g), (m) => m[1])).toEqual(["left", "right", "left", "right"]);
  });
});

describe("apply: safety net", () => {
  const { md, sidecar } = load();
  const src = srcMap(sidecar);
  const first = "| d | e | f |\n| g | h | i |";

  it("a row with more cells than the header is refused (it would drop text)", () => {
    const res = renderWithSidecar(md.replace(first, "| d | e | f | EXTRA |\n| g | h | i |"), sidecar, src);
    expect(res.badTables).toHaveLength(1);
    expect(res.badTables[0]).toContain("2번째");
  });
  it("a short row is padded and the user is told", () => {
    const res = renderWithSidecar(md.replace(first, "| d | e |\n| g | h | i |"), sidecar, src);
    expect(res.badTables).toEqual([]);
    expect(res.tableNotes).toEqual(["표의 짧은 행 1개를 빈 칸으로 채웠습니다"]);
    expect(Array.from(res.tables[0].ooxml.matchAll(/<w:tc>/g))).toHaveLength(9);
  });
  it("a marker without a valid table below it is refused", () => {
    const res = renderWithSidecar(md.replace("| --- | --- | --- |\n", ""), sidecar, src);
    expect(res.badTables).toHaveLength(1);
  });
  it("a marker whose original is gone still produces the table (text kept), with a note", () => {
    const res = renderWithSidecar(md, sidecar, new Map());
    expect(res.tables).toHaveLength(7);
    expect(res.tableNotes.length).toBeGreaterThan(0);
    expect(res.tables[0].ooxml).toContain(">e<");
  });
  it("counts the opaque tables so deleting one is detected", () => {
    const res = renderWithSidecar(md, sidecar, src);
    expect(res.opaqueTables).toBe(4);
    expect(res.tables.length + res.opaqueTables).toBe(11);
  });
  it("tables inside fenced code are not tables", () => {
    expect(findTableBlocks("```\n| a | b |\n| - | - |\n| 1 | 2 |\n```")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("escaping corpus: Word text -> markdown cell -> runs gives the same text back", () => {
  const CORPUS = [
    "plain", "a | b", "back\\slash", "tick ` tick", "*star* and _under_", "[x](y) not a link", "<b>html-looking</b>", "<script>alert(1)</script>",
    "한국어 텍스트", "emoji 😀 mix", "a & b < c > d", "# not a heading", "1. not a list", "- not a bullet", "$5 and $6", "x".repeat(500),
    "tilde ~~not strike~~", "trailing backslash\\", "pipe at end |", "| pipe at start", "![img](x)", "[[wikilink]]", "line  with   spaces",
  ];
  const wordHtml = (header: string[], row: string[]) => {
    const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const tr = (cells: string[], tag = "td") => `<tr>${cells.map((c) => `<${tag} width=100 valign=top><p class=MsoNormal><span lang=EN-US>${e(c)}</span></p></${tag}>`).join("")}</tr>`;
    return `<body><table class=MsoNormalTable><thead>${tr(header)}</thead>${tr(row)}</table></body>`;
  };
  const textOf = (runs: string) => Array.from(runs.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g), (m) => m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"')).join("");

  for (const text of CORPUS) {
    it(JSON.stringify(text.length > 40 ? text.slice(0, 40) + "…" : text), () => {
      const sidecar = new MemorySidecar();
      const cap = { raw: "<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w=\"1\"/></w:tblGrid></w:tbl>", gz: "gz:0" };
      const md = htmlToMarkdown(wordHtml(["h"], [text]), sidecar, new Map(), undefined, undefined, undefined, undefined, undefined, [cap]);
      const block = findTableBlocks(md)[0];
      expect(block.error).toBeUndefined();
      expect(block.model.rows).toHaveLength(2);
      expect(block.model.rows[0]).toHaveLength(1);
      // what Word would show after apply: the runs built from the markdown cell
      const shown = textOf(inlineToRuns(block.model.rows[1][0]));
      expect(shown.replace(/\s+/g, " ").trim()).toBe(text.replace(/\s+/g, " ").trim());
      // and the markdown table is stable: render -> parse -> render
      expect(modelToLines(block.model)).toEqual(md.split("\n").filter((l) => l.startsWith("|")));
    });
  }
});

describe("property: random simple tables are stable (markdown -> table -> markdown)", () => {
  let seed = 12345;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  const words = ["a", "b", "x y", "foo", "한글", "😀", "1", "a\\|b", "**b**", "_i_", "`c`", "[l](https://e.example)", "q<br>r", "", "$x"];
  const aligns = ["", "l", "c", "r"] as const;
  for (let t = 0; t < 40; t++) {
    it(`random table ${t}`, () => {
      const cols = 1 + rnd(6);
      const rows = 1 + rnd(6);
      const model: TableModel = {
        aligns: Array.from({ length: cols }, () => aligns[rnd(4)]),
        rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => words[rnd(words.length)])),
      };
      const lines = modelToLines(model);
      const [b] = findTableBlocks(lines.join("\n"));
      expect(b.error).toBeUndefined();
      expect(b.model).toEqual(model);
      expect(modelToLines(b.model)).toEqual(lines);
      // building OOXML from it never throws and keeps every cell's text
      const x = buildTableOoxml(null, model).xml;
      expect((x.match(/<w:tc>/g) ?? []).length).toBe(cols * rows);
      expect(wrapPackage(x)).toContain("<w:tbl>");
      // and rebuilding from the generated table with the same model is a no-op on the text
      const again = buildTableOoxml(x, model, model).xml;
      const texts = (z: string) => Array.from(z.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g), (m) => Array.from(m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g), (t) => t[1]).join(""));
      expect(texts(again)).toEqual(texts(x));
      expect(again.match(/<w:tr[ >]/g)).toHaveLength(rows);
    });
  }
});

describe("analyzeHtmlTable limits", () => {
  const parse = (h: string) => new DOMParser().parseFromString(`<body>${h}</body>`, "text/html").querySelector("table")!;
  const cell = (s: string) => s;
  it("rejects ragged grids, footers, several header rows, huge tables", () => {
    expect(analyzeHtmlTable(parse("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>"), cell)).toMatchObject({ simple: false, reason: "not rectangular" });
    expect(analyzeHtmlTable(parse("<table><thead><tr><td>a</td></tr><tr><td>b</td></tr></thead></table>"), cell)).toMatchObject({ simple: false });
    expect(analyzeHtmlTable(parse(`<table><tr>${"<td>x</td>".repeat(31)}</tr></table>`), cell)).toMatchObject({ simple: false, reason: "too many columns" });
    expect(analyzeHtmlTable(parse("<table><tr><td>" + "x".repeat(2001) + "</td></tr></table>"), (s) => s)).toMatchObject({ simple: false, reason: "cell too long" });
  });
  it("rejects images, tracked changes, comments, fields, footnotes, lists inside cells", () => {
    for (const inner of ['<img src="x">', "<ins>a</ins>", "<del>a</del>", '<a href="#_ftn1">1</a>', '<span style="mso-element:field-begin"></span>', "<ul><li>a</li></ul>", '<span class="MsoCommentReference">x</span>']) {
      expect(analyzeHtmlTable(parse(`<table><tr><td><p class=MsoNormal>${inner}</p></td></tr></table>`), cell).simple, inner).toBe(false);
    }
  });
  it("accepts a single-column table and empty cells", () => {
    expect(analyzeHtmlTable(parse("<table><tr><td><p class=MsoNormal>&nbsp;</p></td></tr></table>"), (s) => s)).toMatchObject({ simple: true });
  });
});
