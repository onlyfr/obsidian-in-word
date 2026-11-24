import MarkdownIt from "markdown-it";

const parser = new MarkdownIt();
const plainLine = /^[\p{L}\p{M}\p{N} ,.!?():;·，。！？]+$/u;

export function plainParagraphEdit(original: string, edited: string): {before:string; after:string} {
  const before = original.split("\n"), after = edited.split("\n");
  const error = "서식 없는 독립 문단 한 곳의 텍스트만 수정한 뒤 부분 적용하세요.";
  if (before.length !== after.length) throw new Error(error);
  let i = -1;
  for (let index = 0; index < before.length; index++) {
    if (before[index] === after[index]) continue;
    if (i !== -1) throw new Error(error);
    i = index;
  }
  const standalone = (source:string, lines:string[]) => {
    const line = lines[i];
    if (!line || !plainLine.test(line) || line !== line.trim() || lines.indexOf(line) !== lines.lastIndexOf(line)) return false;
    const tokens = parser.parse(source, {});
    return tokens.some((token, j) => token.type === "paragraph_open" && token.level === 0 &&
      token.map?.[0] === i && token.map[1] === i + 1 && tokens[j+1]?.children?.length === 1 &&
      tokens[j+1].children![0].type === "text" && tokens[j+1].children![0].content === line);
  };
  if (i === -1 || !standalone(original,before) || !standalone(edited,after))
    throw new Error(error);
  return {before:before[i], after:after[i]};
}

export function plainWordContent(xml:string, expected:string): boolean {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const body = doc.getElementsByTagNameNS(w,"body")[0];
  const paragraph = body?.firstElementChild;
  if (paragraph?.namespaceURI !== w || paragraph.localName !== "p") return false;
  const content = Array.from(paragraph.children).filter(el => !(el.namespaceURI === w && el.localName === "pPr"));
  if (content.length !== 1 || content[0].namespaceURI !== w || content[0].localName !== "r") return false;
  const text = Array.from(content[0].children).filter(el => !(el.namespaceURI === w && el.localName === "rPr"));
  return text.length > 0 && text.every(el => el.namespaceURI === w && el.localName === "t") &&
    text.map(el => el.textContent).join("") === expected;
}
