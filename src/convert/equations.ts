import { hashId } from "./blocks";
import { OMML_PKG_NAMESPACES, latexToOmml, ommlToLatex } from "./math";
import type { Sidecar } from "./sidecar";
import {parseMathImgAlt} from './math-marker';

/**
 * Real Word `getHtml` renders every equation as a bare `<img src="~WRS{GUID}.files/imageNNN.gif">` (inline ones in a
 * `position:relative;top:Npt` span) - no OMML, no conditional comment. So the equations are taken from the selection's
 * OOXML (`getOoxml`) and paired with the HTML images by order: every inline image-like object in the OOXML
 * (`m:oMath`/`m:oMathPara`, `wp:inline`, non-floating `w:pict`) corresponds to one non-floating `<img>`.
 */
export interface EqCapture {
  kind: "eq";
  /** Raw `<m:oMath>` / `<m:oMathPara>` markup exactly as Word wrote it. */
  omml: string;
  display: boolean;
  /** gz-encoded single-paragraph OOXML package of the containing paragraph (for equations without a LaTeX form). */
  paraPkg?: string;
  /** Raw `<w:p>` markup (before packaging). */
  paraXml: string;
}
export interface PicCapture {
  kind: "pic";
}
/** A picture carrying our `owb:math:<id>` alt marker: LaTeX rendered as an image (see mathimg.ts). */
export interface MathImgCapture {
  kind: "mathimg";
  id: string;
  display: boolean;
  /** LaTeX read from the alt text (only when it was not truncated); used when the sidecar has no entry. */
  latex?: string;
}
export type ImgCapture = EqCapture | PicCapture | MathImgCapture;

export interface OoxmlScan {
  /** One entry per non-floating image-like object, in document order. */
  items: ImgCapture[];
  /** Number of equations (display or inline) in the selection, including ones that are not paired. */
  equations: number;
  /** Number of pictures carrying our math alt marker (LaTeX rendered as an image). */
  mathImages: number;
}

/** `descr="owb:math:<id>[:d][ latex…]"` of a picture's docPr (see mathImgAlt in mathimg.ts). */
const MATHIMG_ALT_RE = /<wp:docPr\b[^>]*?\bdescr=(?:"([^"]*)"|'([^']*)')/;
const unescapeXml = (v: string) =>
  v.replace(/&(lt|gt|quot|amp|apos|#x[0-9a-f]+|#\d+);/gi, (match,entity:string)=>{
    if(entity[0]!=='#')return ({lt:'<',gt:'>',quot:'"',amp:'&',apos:"'"} as Record<string,string>)[entity.toLowerCase()];
    const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
    return code>0 && code<=0x10ffff?String.fromCodePoint(code):match;
  });

const TAG_RE =
  /<m:oMathPara[\s>][\s\S]*?<\/m:oMathPara>|<m:oMath[\s>][\s\S]*?<\/m:oMath>|<wp:inline[\s>/]|<wp:anchor[\s>/]|<w:pict[\s>/]|<w:object[\s>/]/g;

export function scanOoxml(ooxml: string): OoxmlScan {
  const items: ImgCapture[] = [];
  let equations = 0;
  let mathImages = 0;
  const bodyStart = ooxml.indexOf("<w:body");
  const bodyEnd=bodyStart<0?-1:ooxml.indexOf('</w:body>',bodyStart);
  const body = (bodyStart < 0 ? ooxml : ooxml.slice(bodyStart,bodyEnd<0?undefined:bodyEnd+9))
    .replace(/<mc:AlternateContent\b[^>]*>[\s\S]*?<\/mc:AlternateContent>/g,block=>/<mc:Choice\b[^>]*>([\s\S]*?)<\/mc:Choice>/.exec(block)?.[1]??block);
  // Find paragraph bounds once; two lastIndexOf searches per equation were quadratic on common Word markup.
  const paragraphs:{start:number;end:number}[]=[],stack:number[]=[];
  for(const tag of body.matchAll(/<w:p(?:\s[^>]*|)>|<\/w:p>/g)){
    if(tag[0]==='</w:p>'){const index=stack.pop();if(index!==undefined)paragraphs[index].end=tag.index!+tag[0].length;}
    else{paragraphs.push({start:tag.index!,end:tag[0].endsWith('/>')?tag.index!+tag[0].length:-1});if(!tag[0].endsWith('/>'))stack.push(paragraphs.length-1);}
  }
  let paragraph=-1;
  for (const m of body.matchAll(TAG_RE)) {
    const t = m[0];
    if (t.startsWith("<m:oMath")) {
      equations++;
      while(paragraph+1<paragraphs.length && paragraphs[paragraph+1].start<=m.index!)paragraph++;
      const bounds=paragraphs[paragraph];
      const paraXml = bounds && bounds.end>m.index! ? body.slice(bounds.start,bounds.end) : '';
      items.push({ kind: "eq", omml: t, display: t.startsWith("<m:oMathPara"), paraXml });
    } else if (t.startsWith("<wp:inline")) {
      const end = body.indexOf("</wp:inline>", m.index);
      const descriptor = MATHIMG_ALT_RE.exec(body.slice(m.index, end < 0 ? undefined : end));
      const alt=descriptor?parseMathImgAlt(unescapeXml(descriptor[1]??descriptor[2])):null;
      if (alt) {
        mathImages++;
        items.push({ kind: "mathimg",...alt });
      } else items.push({ kind: "pic" });
    } else if (t.startsWith("<w:object")) items.push({ kind: "pic" });
    else if (t.startsWith("<w:pict")) {
      // VML picture: floating when positioned absolutely.
      const end = body.indexOf("</w:pict>", m.index);
      if (!/position:\s*absolute/i.test(body.slice(m.index, end < 0 ? undefined : end))) items.push({ kind: "pic" });
    }
    // wp:anchor: floating, has no counterpart among the non-floating <img>s
  }
  return { items, equations, mathImages };
}

/** Number of equations (display + inline) in an OOXML string. */
export const countEquations = (ooxml: string) => scanOoxml(ooxml).equations;

/** Flat-OPC package holding just `bodyXml`, accepted by `insertOoxml`. */
export function wrapPackage(bodyXml: string, rels = "", parts = ""): string {
  return (
    '<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">' +
    '<pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml">' +
    '<pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships></pkg:xmlData></pkg:part>" +
    '<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">' +
    `<pkg:xmlData><w:document ${OMML_PKG_NAMESPACES}><w:body>${bodyXml}</w:body></w:document></pkg:xmlData></pkg:part>` +
    (rels
      ? '<pkg:part pkg:name="/word/_rels/document.xml.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml">' +
        `<pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships></pkg:xmlData></pkg:part>`
      : "") +
    parts +
    "</pkg:package>"
  );
}

/** Package that inserts one equation: display -> its own paragraph, inline -> a paragraph holding only the equation. */
export function equationPackage(omml: string): string {
  return wrapPackage(`<w:p>${omml}</w:p>`);
}

// ---------------------------------------------------------------------------------------------------------------
// markdown side

export const mathKey = (latex: string, display: boolean) => hashId(`math:${display ? "D" : "I"}:${latex}`);

export interface MathSpan {
  latex: string;
  display: boolean;
  /** Offsets into the scanned text. */
  start: number;
  end: number;
}

/**
 * Find `$...$` (inline) and `$$...$$` (display) spans, Obsidian style: the opening `$` is not followed by a space,
 * the closing `$` is not preceded by a space and not followed by a digit, inline math stays on one line.
 * `\$`, fenced code blocks and inline code spans are skipped.
 */
export function findMath(src: string): MathSpan[] {
  const out: MathSpan[] = [];
  let i = 0;
  let atLineStart = true;
  let fence: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (atLineStart) {
      const line = /^( {0,3})(`{3,}|~{3,})/.exec(src.slice(i, i + 200));
      if (line) {
        const mark = line[2][0].repeat(3);
        if (fence === null) fence = mark;
        else if (fence === mark) fence = null;
      }
    }
    if (c === "\n") {
      atLineStart = true;
      i++;
      continue;
    }
    atLineStart = false;
    if (fence !== null) {
      i++;
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") {
      const ticks = /^`+/.exec(src.slice(i))![0];
      const close = src.indexOf(ticks, i + ticks.length);
      i = close < 0 ? i + ticks.length : close + ticks.length;
      continue;
    }
    if (c === "$") {
      if (src[i + 1] === "$") {
        const close = src.indexOf("$$", i + 2);
        if (close > i + 2 && /\S/.test(src.slice(i + 2, close))) {
          out.push({ latex: src.slice(i + 2, close).trim(), display: true, start: i, end: close + 2 });
          i = close + 2;
          continue;
        }
        i += 2;
        continue;
      }
      let j = i + 1;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "$") break;
        j++;
      }
      if (j < src.length && src[j] === "$" && j > i + 1 && !/\s/.test(src[i + 1]) && !/\s/.test(src[j - 1]) && !/\d/.test(src[j + 1] ?? "")) {
        out.push({ latex: src.slice(i + 1, j), display: false, start: i, end: j + 1 });
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** Id of a LaTeX-as-image pair (`kind=mathimg`); the render version is part of it, so a new renderer re-renders. */
export const MATHIMG_VERSION = 4; // Direct MathJax TeX input; invalidate Temml-intermediate alignment.
export const mathImgKey = (latex: string, display: boolean,profile='') => hashId(`mathimg:v${MATHIMG_VERSION}:${display ? "D" : "I"}:${latex}${profile?'\0'+profile:''}`);

/** Sidecar ids the image rung would use for the math spans of `markdown` (to keep them when pruning). */
export const mathImgIds = (markdown: string): Set<string> => new Set(findMath(markdown).map((m) => mathImgKey(m.latex, m.display)));

/** Sidecar ids of all math spans in `markdown` (to keep them when pruning). */
export function mathIds(markdown: string): Set<string> {
  return new Set(findMath(markdown).map((m) => mathKey(m.latex, m.display)));
}

export const TOKEN_PREFIX = "OWBEQ";
export const EQ_TOKEN_RE = /OWBEQ(\d+)END/g;

export interface MathResolved {
  marker: string;
  omml: string;
  display: boolean;
  latex: string;
  /** No OMML (`omml` is empty): the caller makes a picture of it, or literal text when that fails (see mathimg.ts). */
  img?: boolean;
}

/**
 * Replace the math spans in `src` by marker tokens (display ones on their own paragraph) so that markdown-it does
 * not touch them. `offset` makes marker numbers unique across chunks.
 */
export function tokenizeMath(
  src: string,
  sidecar: Sidecar,
  used: Map<string, number>,
  offset: number,
  resolved: MathResolved[],
): string {
  const spans = findMath(src);
  let out = "";
  let pos = 0;
  for (const s of spans) {
    out += src.slice(pos, s.start);
    pos = s.end;
    const id = mathKey(s.latex, s.display);
    const entry = sidecar.get(id);
    let omml: string | null = null;
    if (entry?.kind === "math" && entry.latex === s.latex && entry.omml) {
      const variants = [entry.omml, ...(entry.alts ?? [])];
      const n = used.get(id) ?? 0;
      used.set(id, n + 1);
      omml = n < variants.length ? variants[n] : null;
    }
    omml ??= latexToOmml(s.latex, s.display);
    const marker = `${TOKEN_PREFIX}${offset + resolved.length}END`;
    resolved.push({ marker, omml: omml ?? "", display: s.display, latex: s.latex, img: omml === null || undefined });
    out += s.display ? `\n\n${marker}\n\n` : marker;
  }
  return out + src.slice(pos);
}

/** Record an equation read from Word: returns its LaTeX (and stores the lossless OMML pair), or null if unsupported. */
export function captureMath(eq: EqCapture, sidecar: Sidecar): { latex: string; id: string } | null {
  const conv = ommlToLatex(eq.omml);
  if (!conv || !conv.latex || conv.display !== eq.display) return null;
  // Only trust a pair that survives the round trip through our own LaTeX parser (otherwise editing would be wrong).
  if (latexToOmml(conv.latex, conv.display) === null) return null;
  // `$` markers and line breaks would corrupt the markdown span.
  if (/\n|\$/.test(conv.latex)) return null;
  const id = mathKey(conv.latex, conv.display);
  const prev = sidecar.get(id);
  if (prev?.kind === "math" && prev.latex === conv.latex) {
    if (prev.omml !== eq.omml && !(prev.alts ?? []).includes(eq.omml)) prev.alts = [...(prev.alts ?? []), eq.omml];
  } else sidecar.set(id, { kind: "math", html: "", latex: conv.latex, omml: eq.omml });
  return { latex: conv.latex, id };
}
