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
