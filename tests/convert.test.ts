import { describe, expect, it } from "vitest";
import { htmlToMarkdown, markdownToHtml } from "../src/convert/obsidian";

describe("markdown -> html", () => {
  it("renders headings and emphasis", () => {
    const html = markdownToHtml("# Title\n\nsome **bold** and *italic*");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("turns wikilinks into marked links", () => {
    expect(markdownToHtml("see [[Note A]] and [[Note B|alias]]")).toContain('href="wikilink:Note%20A"');
  });
});

describe("round trip", () => {
  const roundTrip = (s: string) => htmlToMarkdown(markdownToHtml(s));

  it("keeps headings, emphasis and lists", () => {
    const src = "# Title\n\nsome **bold** and *italic*\n\n-   a\n-   b";
    expect(roundTrip(src)).toBe("# Title\n\nsome **bold** and _italic_\n\n- a\n- b");
  });

  it("keeps wikilinks", () => {
    expect(roundTrip("see [[Note A]] and [[Note B|alias]]")).toBe("see [[Note A]] and [[Note B|alias]]");
  });

  it("keeps callouts", () => {
    expect(roundTrip("> [!note] Heads up\n> body")).toContain("> [!note] Heads up");
  });

  it("strips Word noise", () => {
    const word = "<html><body><!--StartFragment--><p>hi<o:p></o:p></p><!--EndFragment--></body></html>";
    expect(htmlToMarkdown(word)).toBe("hi");
  });
});
