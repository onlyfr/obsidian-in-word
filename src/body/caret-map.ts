import {parser, Strikethrough} from "@lezer/markdown";
import type {SyntaxNode} from "@lezer/common";

const markdown = parser.configure(Strikethrough);
interface Piece { from: number; to: number; text: string; }

/** Map rendered UTF-16 positions into a single inline Markdown paragraph. Refuse mismatches instead of guessing. */
export function sourceCaret(source: string, rendered: string, offset: number): number {
  const root = markdown.parse(source).topNode;
  if (root.firstChild?.name !== "Paragraph" || root.firstChild.nextSibling || /[\r\n]/.test(source))
    throw new Error("커서 매핑은 일반 문단 한 개만 지원합니다");
  const pieces: Piece[] = [];
  const text = (from: number, to: number) => { if (to > from) pieces.push({from, to, text: source.slice(from, to)}); };
  const walkRange = (node: SyntaxNode, from: number, to: number) => {
    let at = from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue;
      text(at, child.from); walk(child); at = child.to;
    }
    text(at, to);
  };
  const walk = (node: SyntaxNode): void => {
    if (["EmphasisMark", "StrikethroughMark", "CodeMark"].includes(node.name)) return;
    if (node.name === "Escape") { pieces.push({from: node.from + 1, to: node.to, text: source.slice(node.from + 1, node.to)}); return; }
    if (node.name === "Entity") {
      const decoded = new DOMParser().parseFromString(`<body>${source.slice(node.from, node.to)}</body>`, "text/html").body.textContent ?? "";
      pieces.push({from: node.from, to: node.to, text: decoded}); return;
    }
    if (node.name === "InlineCode") {
      let from = node.firstChild!.to, to = node.lastChild!.from;
      const inner = source.slice(from, to);
      if (inner.startsWith(" ") && inner.endsWith(" ") && inner.trim()) { from++; to--; }
      text(from, to); return;
    }
    if (node.name === "Link") {
      const open = node.firstChild;
      let close = open?.nextSibling;
      while (close && !(close.name === "LinkMark" && source.slice(close.from, close.to) === "]")) close = close.nextSibling;
      if (!open || !close) throw new Error("링크의 커서 위치를 판단할 수 없습니다");
      walkRange(node, open.to, close.from); return;
    }
    if (node.name === "Autolink") { text(node.from + 1, node.to - 1); return; }
    if (node.name === "HTMLTag") { text(node.from, node.to); return; } // html:false in the renderer
    walkRange(node, node.from, node.to);
  };
  walk(root.firstChild);
  const visible = pieces.map(p => p.text).join("");
  const spaces = (s: string) => s.replace(/\u00a0/g, " ");
  if (spaces(visible) !== spaces(rendered) || !Number.isInteger(offset) || offset < 0 || offset > rendered.length)
    throw new Error("문단 텍스트와 커서 매핑이 일치하지 않아 전환을 중단했습니다");
  if (offset === 0) return 0;
  if (offset === rendered.length) return source.length;
  let at = 0;
  for (const piece of pieces) {
    if (offset < at + piece.text.length) {
      const local = offset - at;
      if (piece.to - piece.from === piece.text.length) return piece.from + local;
      if (local === 0) return piece.from;
      throw new Error("문자 내부의 커서 위치는 변환하지 않습니다");
    }
    at += piece.text.length;
  }
  throw new Error("커서 위치를 찾지 못했습니다");
}
