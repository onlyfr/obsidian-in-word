import { htmlToMarkdown, markdownToHtml } from "../convert/obsidian";
import { MemorySidecar } from "../convert/sidecar";
import { findMath } from "../convert/equations";
import type { BodyCodec } from "./session";

/** Deliberately narrow experiment: one ordinary paragraph, no objects, math, lists or multiline blocks. */
export const inlineBodyCodec: BodyCodec = {
  markdown(html) { return htmlToMarkdown(html, new MemorySidecar()); },
  html(markdown) {
    if (markdown.length > 4000 || /[\r\n]/.test(markdown) || findMath(markdown).length)
      throw new Error("실험 단계에서는 수식 없는 일반 문단 한 개만 편집합니다");
    const html = markdownToHtml(markdown);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const roots = Array.from(doc.body.children);
    const allowed = new Set(["P", "SPAN", "STRONG", "EM", "S", "DEL", "CODE", "A", "BR"]);
    if (roots.length !== 1 || roots[0].tagName !== "P" || Array.from(doc.body.querySelectorAll("*")).some(el => !allowed.has(el.tagName)))
      throw new Error("표·그림·목록·여러 문단은 아직 본문 편집 실험에 포함하지 않습니다");
    return html;
  },
};
