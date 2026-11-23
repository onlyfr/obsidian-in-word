import {describe, expect, it} from "vitest";
import {plainParagraphEdit} from "../src/taskpane/paragraph-edit";

describe("partial paragraph edit", () => {
  it("identifies a single independent plain paragraph", () => {
    expect(plainParagraphEdit("# 제목\n\nBefore", "# 제목\n\nAfter")).toEqual({before:"Before", after:"After"});
  });
  it.each([
    ["Same\n\nSame","Same\n\nOther"],
    ["Sentence","**Sentence**"],
    ["~~~\ncode\n~~~","~~~\nword\n~~~"],
    ["a\nb","a\nc"],
    ["line","line\n\nadded"],
    ["one\n\ntwo","ONE\n\nTWO"],
    ["- item","- changed"],
  ])("refuses ambiguous or structural changes (%s)", (before, after) => {
    expect(() => plainParagraphEdit(before, after)).toThrow();
  });
});
