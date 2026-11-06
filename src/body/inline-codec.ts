import { htmlToMarkdown, markdownToHtml } from "../convert/obsidian";
import { MemorySidecar } from "../convert/sidecar";
import { findMath } from "../convert/equations";
import type { BodyCodec } from "./session";

/** Deliberately narrow experiment: one ordinary paragraph, no objects, math, lists or multiline blocks. */
export const inlineBodyCodec: BodyCodec = {
  markdown(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const semanticTags: Record<string, string> = {B: "strong", STRONG: "strong", I: "em", EM: "em", S: "strike", DEL: "strike", STRIKE: "strike"};
    const kind = (el: Element) => semanticTags[el.tagName];
    // Run-level font/language spans have no representation in this deliberately narrow Markdown codec. Flatten
    // them so an enclosing language span cannot hide adjacent semantic emphasis from the merge below.
    for (const span of Array.from(doc.body.querySelectorAll("span")).reverse()) span.replaceWith(...Array.from(span.childNodes));
    // Word splits adjacent bold/italic runs at language/font boundaries. Separate Markdown delimiters (****)
    // can become literal text or mean a different emphasis tree. Join equivalent adjacent semantic wrappers first.
    for (const parent of [doc.body, ...doc.body.querySelectorAll("*")].reverse()) {
      for (const el of Array.from(parent.children)) {
        const semantic = kind(el);
        while (semantic && el.nextSibling instanceof Element && kind(el.nextSibling) === semantic) {
          const next = el.nextSibling;
          el.append(...Array.from(next.childNodes)); next.remove();
        }
      }
    }
    return htmlToMarkdown(doc.documentElement.outerHTML, new MemorySidecar());
  },
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
