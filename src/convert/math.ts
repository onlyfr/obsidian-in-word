/**
 * Word equations (OMML) <-> LaTeX for a pragmatic subset (no third-party converters; Microsoft's MML2OMML.XSL
 * is not redistributable and mathml2omml is LGPL). Anything outside the subset makes the converter return null,
 * and the caller keeps the equation as an opaque placeholder.
 */

export const OMML_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// ---------------------------------------------------------------------------------------------------------------
// Symbol tables

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
  varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ",
  omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ",
  Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const SYMBOLS: Record<string, string> = {
  ...GREEK,
  times: "×", cdot: "⋅", pm: "±", mp: "∓", div: "÷", ast: "∗", star: "⋆", circ: "∘", bullet: "∙", oplus: "⊕",
  otimes: "⊗", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡", sim: "∼",
  simeq: "≃", cong: "≅", propto: "∝", ll: "≪", gg: "≫", infty: "∞", partial: "∂", nabla: "∇", ell: "ℓ", hbar: "ℏ",
  Re: "ℜ", Im: "ℑ", aleph: "ℵ", emptyset: "∅", varnothing: "∅", to: "→", rightarrow: "→", leftarrow: "←",
  leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", implies: "⟹", iff: "⟺",
  mapsto: "↦", uparrow: "↑", downarrow: "↓", in: "∈", notin: "∉", ni: "∋", subset: "⊂", supset: "⊃",
  subseteq: "⊆", supseteq: "⊇", cup: "∪", cap: "∩", setminus: "∖", forall: "∀", exists: "∃", neg: "¬", lnot: "¬",
  land: "∧", wedge: "∧", lor: "∨", vee: "∨", perp: "⊥", parallel: "∥", angle: "∠", triangle: "△", ldots: "…",
  dots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱", prime: "′", therefore: "∴", because: "∵", degree: "°",
  Box: "□", mid: "∣", sharp: "♯", flat: "♭",
};

const NARY: Record<string, string> = {
  sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭", oint: "∮", oiint: "∯", bigcup: "⋃",
  bigcap: "⋂", bigvee: "⋁", bigwedge: "⋀", bigoplus: "⨁", bigotimes: "⨂",
};
const INT_LIKE = new Set(["∫", "∬", "∭", "∮", "∯", "∰"]);

const FUNC_NAMES = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "coth", "log",
  "ln", "lg", "exp", "det", "dim", "gcd", "deg", "ker", "hom", "arg", "Pr", "lim", "max", "min", "sup", "inf",
  "limsup", "liminf",
]);
const LIMIT_FUNCS = new Set(["lim", "max", "min", "sup", "inf", "limsup", "liminf"]);

const ACCENTS: Record<string, string> = {
  hat: "̂", tilde: "̃", bar: "̅", dot: "̇", ddot: "̈", vec: "⃗", check: "̌",
  breve: "̆", acute: "́", grave: "̀",
};
// Other characters seen for the same accents.
const ACCENT_ALIASES: Record<string, string> = {
  "̄": "̅", "ˆ": "̂", "^": "̂", "~": "̃", "˜": "̃", "→": "⃗",
  "¯": "̅", "´": "́", "`": "̀", "˙": "̇", "¨": "̈", "ˇ": "̌",
};

const SPACES: Record<string, string> = {
  ",": " ", ";": " ", ":": " ", " ": " ", quad: " ", qquad: "  ", "!": "",
};

const DELIMS: Record<string, string> = {
  "(": "(", ")": ")", "[": "[", "]": "]", "|": "|", "\\{": "{", "\\}": "}", "\\|": "‖", "\\langle": "⟨",
  "\\rangle": "⟩", "\\lfloor": "⌊", "\\rfloor": "⌋", "\\lceil": "⌈", "\\rceil": "⌉", "\\vert": "|", "\\Vert": "‖",
  ".": "", "<": "⟨", ">": "⟩", "/": "/", "\\lbrace": "{", "\\rbrace": "}",
};
const DELIM_TO_LATEX: Record<string, string> = {
  "(": "(", ")": ")", "[": "[", "]": "]", "|": "|", "{": "\\{", "}": "\\}", "‖": "\\|", "⟨": "\\langle",
  "⟩": "\\rangle", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "": ".", "/": "/",
};

const BB: Record<string, string> = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ", H: "ℍ" };
const BB_REV = Object.fromEntries(Object.entries(BB).map(([k, v]) => [v, k]));

const reverse = (o: Record<string, string>) => {
  const r = new Map<string, string>();
  for (const [k, v] of Object.entries(o)) if (v && !r.has(v)) r.set(v, k);
  return r;
};
const SYMBOL_REV = reverse(SYMBOLS);
const NARY_REV = reverse(NARY);
const ACCENT_REV = reverse(ACCENTS);


// ---------------------------------------------------------------------------------------------------------------
// OMML -> LaTeX

class Unsupported extends Error {}
const unsupported = (what: string): never => {
  throw new Unsupported(what);
};

interface Piece {
  s: string;
  /** Can take a script (`^`/`_`) directly without wrapping braces. */
  atomic: boolean;
}

const kids = (el: Element) => Array.from(el.children);
const child = (el: Element | undefined, name: string) => (el ? kids(el).find((c) => c.localName === name) : undefined);
const valOf = (el: Element | undefined): string | undefined =>
  el ? (el.getAttributeNS(OMML_NS, "val") ?? el.getAttribute("m:val") ?? undefined) : undefined;
const flag = (el: Element | undefined) => {
  if (!el) return false;
  const v = valOf(el);
  return v === undefined || !/^(0|off|false)$/i.test(v);
};

const SINGLE_TOKEN = /^(?:[A-Za-z0-9]|\\[A-Za-z]+|\\.)$/;

function cat(parts: string[]): string {
  let out = "";
  for (const p of parts) {
    if (!p) continue;
    if (/\\[A-Za-z]+$/.test(out) && /[A-Za-z0-9]/.test(p[0])) out += " ";
    out += p;
  }
  return out;
}

/** Wrap in braces unless `s` is a single token. */
const arg = (s: string) => (SINGLE_TOKEN.test(s) ? s : `{${s}}`);
const group = (s: string) => `{${s}}`;

let rawAmp = false;

function escapeChar(c: string): string {
  switch (c) {
    case "{": return "\\{";
    case "}": return "\\}";
    case "\\": return "\\backslash ";
    case "#": case "%": case "&": case "_": case "$": return rawAmp && c === "&" ? "&" : "\\" + c;
    case "^": return "\\hat{}";
    case "~": return "\\sim ";
    case "\u2212": return "-";
    case "\u2016": return "\\|";
    case " ":
    case "\u00a0": return "\\ ";
    case "\u2009": return "\\,";
    case "\u2005": return "\\;";
    case "\u2003": return "\\quad ";
    case "\u2032": return "'";
  }
  const sym = SYMBOL_REV.get(c);
  if (sym) return "\\" + sym;
  const nary = NARY_REV.get(c);
  if (nary) return "\\" + nary;
  if (BB_REV[c]) return `\\mathbb{${BB_REV[c]}}`;
  return c;
}

function runToLatex(r: Element): Piece {
  const rPr = child(r, "rPr");
  const nor = flag(child(rPr, "nor"));
  const sty = valOf(child(rPr, "sty"));
  const scr = valOf(child(rPr, "scr"));
  if (scr && scr !== "roman") unsupported("script " + scr);
  let text = "";
  for (const c of kids(r)) {
    if (c.localName === "t") text += c.textContent ?? "";
    else if (c.localName !== "rPr") unsupported("run child " + c.localName);
  }
  if (!text) return { s: "", atomic: false };
  if (nor) {
    if (/[\\^~]/.test(text)) unsupported("text with special chars");
    const esc = text.replace(/[{}$%&#_]/g, (c) => "\\" + c);
    return { s: `\\text{${esc}}`, atomic: true };
  }
  const chars = Array.from(text);
  let body = cat(chars.map(escapeChar));
  if (sty === "p" || sty === "b" || sty === "bi") {
    // Letters/digits only: wrap in \mathrm / \mathbf / \boldsymbol.
    const plain = chars.every((c) => /[A-Za-z0-9]/.test(c));
    if (plain) {
      const cmd = sty === "p" ? "mathrm" : sty === "b" ? "mathbf" : "boldsymbol";
      return { s: `\\${cmd}{${text}}`, atomic: true };
    }
    if (sty !== "p") unsupported("bold non-alphanumeric");
  }
  return { s: body, atomic: SINGLE_TOKEN.test(body) };
}

function seqToLatex(el: Element | undefined): Piece {
  if (!el) return { s: "", atomic: false };
  const parts: Piece[] = [];
  for (const c of kids(el)) {
    const n = c.localName;
    if (n.endsWith("Pr") || n === "argPr") continue;
    if (n === "bookmarkStart" || n === "bookmarkEnd" || n === "proofErr") continue;
    parts.push(nodeToLatex(c));
  }
  const nonEmpty = parts.filter((p) => p.s);
  const s = cat(nonEmpty.map((p) => p.s));
  return { s, atomic: nonEmpty.length === 1 && nonEmpty[0].atomic };
}

const sub = (el: Element, name: string) => seqToLatex(child(el, name));

function delimChar(pr: Element | undefined, name: string, dflt: string): string {
  const e = child(pr, name);
  const v = valOf(e);
  if (e === undefined) return dflt;
  return v ?? dflt;
}
function delimLatex(ch: string): string {
  const d = DELIM_TO_LATEX[ch];
  if (d === undefined) return unsupported("delimiter " + ch);
  return d;
}

function matrixBody(m: Element): string {
  const rows = kids(m)
    .filter((r) => r.localName === "mr")
    .map((r) => cat([kids(r).filter((e) => e.localName === "e").map((e) => seqToLatex(e).s).join(" & ")]));
  return rows.join(" \\\\ ");
}

function eqArrBody(m: Element): string {
  rawAmp = true;
  try {
    return kids(m)
      .filter((e) => e.localName === "e")
      .map((e) => seqToLatex(e).s)
      .join(" \\\\ ");
  } finally {
    rawAmp = false;
  }
}

function delimToLatex(el: Element): Piece {
  const pr = child(el, "dPr");
  const beg = delimChar(pr, "begChr", "(");
  const end = delimChar(pr, "endChr", ")");
  const sepE = child(pr, "sepChr");
  const sep = sepE ? (valOf(sepE) ?? "|") : "|";
  const es = kids(el).filter((c) => c.localName === "e");
  const only = es.length === 1 ? kids(es[0]).filter((c) => !c.localName.endsWith("Pr")) : [];
  if (only.length === 1) {
    const o = only[0];
    if (o.localName === "m") {
      const env = ({ "()": "pmatrix", "[]": "bmatrix", "{}": "Bmatrix", "||": "vmatrix", "\u2016\u2016": "Vmatrix" } as Record<string, string>)[beg + end];
      if (env) return { s: `\\begin{${env}} ${matrixBody(o)} \\end{${env}}`, atomic: true };
    }
    if (o.localName === "f" && valOf(child(child(o, "fPr"), "type")) === "noBar" && beg === "(" && end === ")")
      return { s: `\\binom${group(sub(o, "num").s)}${group(sub(o, "den").s)}`, atomic: true };
    if (o.localName === "eqArr" && beg === "{" && end === "")
      return { s: `\\begin{cases} ${eqArrBody(o)} \\end{cases}`, atomic: true };
  }
  const sepL = delimLatex(sep);
  const inner = es.map((e) => seqToLatex(e).s).join(` \\middle${sepL} `);
  return { s: `\\left${delimLatex(beg)} ${inner} \\right${delimLatex(end)}`, atomic: true };
}

function nodeToLatex(el: Element): Piece {
  switch (el.localName) {
    case "r":
      return runToLatex(el);
    case "f": {
      const type = valOf(child(child(el, "fPr"), "type")) ?? "bar";
      if (type !== "bar") unsupported("fraction " + type);
      return { s: `\\frac${group(sub(el, "num").s)}${group(sub(el, "den").s)}`, atomic: true };
    }
    case "sSup":
    case "sSub":
    case "sSubSup": {
      const b = sub(el, "e");
      const base = b.atomic ? b.s : group(b.s);
      const sup = el.localName === "sSub" ? undefined : sub(el, "sup");
      const lo = el.localName === "sSup" ? undefined : sub(el, "sub");
      if (sup && sup.s === "'" && !lo) return { s: base + "'", atomic: false };
      return { s: base + (lo ? "_" + arg(lo.s) : "") + (sup ? "^" + arg(sup.s) : ""), atomic: false };
    }
    case "sPre":
      return { s: `{}_${arg(sub(el, "sub").s)}^${arg(sub(el, "sup").s)}${group(sub(el, "e").s)}`, atomic: false };
    case "nary": {
      const pr = child(el, "naryPr");
      const chr = child(pr, "chr") ? (valOf(child(pr, "chr")) ?? "∫") : "∫";
      const name = NARY_REV.get(chr) ?? unsupported("nary " + chr);
      const natural = INT_LIKE.has(chr) ? "subSup" : "undOvr";
      const loc = valOf(child(pr, "limLoc")) ?? natural;
      const lim = loc !== natural ? (loc === "undOvr" ? "\\limits" : "\\nolimits") : "";
      const lo = flag(child(pr, "subHide")) ? "" : sub(el, "sub").s;
      const hi = flag(child(pr, "supHide")) ? "" : sub(el, "sup").s;
      return {
        s: `\\${name}${lim}${lo ? "_" + arg(lo) : ""}${hi ? "^" + arg(hi) : ""}${group(sub(el, "e").s)}`,
        atomic: false,
      };
    }
    case "rad": {
      const hide = flag(child(child(el, "radPr"), "degHide"));
      const deg = hide ? "" : sub(el, "deg").s;
      return { s: `\\sqrt${deg ? `[${deg}]` : ""}${group(sub(el, "e").s)}`, atomic: true };
    }
    case "d":
      return delimToLatex(el);
    case "m":
      return { s: `\\begin{matrix} ${matrixBody(el)} \\end{matrix}`, atomic: true };
    case "eqArr":
      return { s: `\\begin{aligned} ${eqArrBody(el)} \\end{aligned}`, atomic: true };
    case "acc": {
      const raw = valOf(child(child(el, "accPr"), "chr")) ?? "̂";
      const chr = ACCENT_ALIASES[raw] ?? raw;
      const name = ACCENT_REV.get(chr) ?? unsupported("accent " + raw);
      return { s: `\\${name}${group(sub(el, "e").s)}`, atomic: true };
    }
    case "bar": {
      const pos = valOf(child(child(el, "barPr"), "pos")) ?? "bot";
      return { s: `\\${pos === "top" ? "overline" : "underline"}${group(sub(el, "e").s)}`, atomic: true };
    }
    case "groupChr": {
      const chr = valOf(child(child(el, "groupChrPr"), "chr")) ?? "⏟";
      const name = chr === "⏞" ? "overbrace" : chr === "⏟" ? "underbrace" : unsupported("groupChr " + chr);
      return { s: `\\${name}${group(sub(el, "e").s)}`, atomic: true };
    }
    case "func": {
      const fn = child(el, "fName");
      const head = funcHead(fn) ?? `\\operatorname${group(seqToLatex(fn).s)}`;
      const e = sub(el, "e");
      if (!e.s) return { s: head, atomic: false };
      return { s: head + (e.atomic ? " " + e.s : group(e.s)), atomic: false };
    }
    case "limLow":
    case "limUpp": {
      const e = sub(el, "e");
      const lim = sub(el, "lim");
      const upper = el.localName === "limUpp";
      const nm = limitFuncName(child(el, "e"));
      if (nm && !upper) return { s: `\\${nm}_${arg(lim.s)}`, atomic: false };
      return { s: `\\${upper ? "overset" : "underset"}${group(lim.s)}${group(e.s)}`, atomic: false };
    }
    default:
      return unsupported("element " + el.localName);
  }
}

/** Function-name part of a `m:func`: `\\sin`, `\\sin^2`, `\\operatorname{rank}`, `\\lim_{x \\to 0}`; null if not a plain name. */
function funcHead(fn: Element | undefined): string | null {
  if (!fn) return null;
  const items = kids(fn).filter((c) => !c.localName.endsWith("Pr"));
  if (items.length !== 1) return null;
  const only = items[0];
  const name = (r: Element | undefined): string | null => {
    if (!r || r.localName !== "r") return null;
    const t = kids(r).filter((c) => c.localName === "t").map((c) => c.textContent ?? "").join("");
    return /^[A-Za-z]+$/.test(t) ? t : null;
  };
  const head = (t: string) => (FUNC_NAMES.has(t) ? `\\${t}` : `\\operatorname{${t}}`);
  const direct = name(only);
  if (direct) return head(direct);
  const inner = (x: Element) => {
    const e = child(x, "e");
    const ek = e ? kids(e).filter((c) => !c.localName.endsWith("Pr")) : [];
    return ek.length === 1 ? name(ek[0]) : null;
  };
  if (/^(sSup|sSub|sSubSup)$/.test(only.localName)) {
    const nm = inner(only);
    if (!nm) return null;
    const sup = only.localName === "sSub" ? undefined : sub(only, "sup");
    const lo = only.localName === "sSup" ? undefined : sub(only, "sub");
    return head(nm) + (lo ? "_" + arg(lo.s) : "") + (sup ? "^" + arg(sup.s) : "");
  }
  if (only.localName === "limLow") {
    const nm = inner(only);
    if (nm && LIMIT_FUNCS.has(nm)) return head(nm) + "_" + arg(sub(only, "lim").s);
  }
  return null;
}

function limitFuncName(e: Element | undefined): string | null {
  if (!e) return null;
  const items = kids(e).filter((c) => !c.localName.endsWith("Pr"));
  if (items.length !== 1 || items[0].localName !== "r") return null;
  const t = kids(items[0]).filter((c) => c.localName === "t").map((c) => c.textContent ?? "").join("");
  return LIMIT_FUNCS.has(t) ? t : null;
}

export interface MathLatex {
  latex: string;
  display: boolean;
}

function parseXml(omml: string): Element | null {
  const doc = new DOMParser().parseFromString(
    `<root xmlns:m="${OMML_NS}" xmlns:w="${W_NS}">${omml}</root>`,
    "application/xml",
  );
  if (doc.getElementsByTagName("parsererror").length) return null;
  return doc.documentElement;
}

/** OMML (`<m:oMath>` or `<m:oMathPara>` markup) -> LaTeX, or null if outside the supported subset. */
export function ommlToLatex(omml: string): MathLatex | null {
  const root = parseXml(omml);
  const top = root && kids(root)[0];
  if (!top) return null;
  try {
    if (top.localName === "oMathPara") {
      const maths = kids(top).filter((c) => c.localName === "oMath");
      if (maths.length !== 1) return null;
      return { latex: seqToLatex(maths[0]).s.trim(), display: true };
    }
    if (top.localName === "oMath") return { latex: seqToLatex(top).s.trim(), display: false };
  } catch (e) {
    if (e instanceof Unsupported) return null;
    throw e;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// LaTeX -> OMML

type MNode =
  | { k: "ch"; c: string; sty?: "p" | "b" | "bi" | "nor" }
  | { k: "x"; xml: string; nary?: boolean; func?: boolean };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const RFONT = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>';
const CTRL = `<m:ctrlPr>${RFONT}</m:ctrlPr>`;

function runXml(text: string, sty?: string): string {
  const pr = sty === "nor" ? "<m:rPr><m:nor/></m:rPr>" : sty ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : "";
  const sp = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<m:r>${pr}${RFONT}<m:t${sp}>${esc(text)}</m:t></m:r>`;
}

function emit(nodes: MNode[]): string {
  let out = "";
  for (let i = 0; i < nodes.length; ) {
    const n = nodes[i];
    if (n.k === "x") {
      out += n.xml;
      i++;
      continue;
    }
    let text = n.c;
    let j = i + 1;
    while (j < nodes.length) {
      const m = nodes[j];
      if (m.k !== "ch" || m.sty !== n.sty) break;
      text += m.c;
      j++;
    }
    out += runXml(text, n.sty);
    i = j;
  }
  return out;
}

const wrapE = (tag: string, nodes: MNode[]) => `<m:${tag}>${emit(nodes)}</m:${tag}>`;
const xnode = (xml: string, extra: Partial<Extract<MNode, { k: "x" }>> = {}): MNode => ({ k: "x", xml, ...extra });

class LatexError extends Error {}
const fail = (msg: string): never => {
  throw new LatexError(msg);
};

class Parser {
  i = 0;
  constructor(private readonly s: string) {}

  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  private peekCmd(): string | null {
    const m = /^\\([A-Za-z]+|.)/s.exec(this.s.slice(this.i));
    return m ? m[1] : null;
  }
  private atEnd() {
    return this.i >= this.s.length;
  }

  /** Sequence until `}` / `]` (when `bracket`) / `&` / `\\` / `\right` / `\middle` / `\end` / end of input. */
  seq(bracket = false): MNode[] {
    const out: MNode[] = [];
    for (;;) {
      this.ws();
      if (this.atEnd()) return out;
      const c = this.s[this.i];
      if (c === "}" || c === "&" || (bracket && c === "]")) return out;
      if (c === "\\") {
        const cmd = this.peekCmd();
        if (cmd === "\\" || cmd === "right" || cmd === "middle" || cmd === "end") return out;
      }
      out.push(...this.term());
    }
  }

  /** One atom plus its trailing scripts. */
  term(): MNode[] {
    this.ws();
    let atom = this.atom();
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c === "'") {
        this.i++;
        atom = this.script(atom, undefined, [{ k: "ch", c: "′" }]);
      } else if (c === "^" || c === "_") {
        this.i++;
        const first = this.operand();
        this.ws();
        const c2 = this.s[this.i];
        let lo: MNode[] | undefined;
        let hi: MNode[] | undefined;
        if (c === "^") hi = first;
        else lo = first;
        if ((c === "^" && c2 === "_") || (c === "_" && c2 === "^")) {
          this.i++;
          const second = this.operand();
          if (c === "^") lo = second;
          else hi = second;
        }
        atom = this.script(atom, lo, hi);
      } else break;
    }
    return atom;
  }

  /** A script/argument: a `{group}` or a single atom. */
  operand(): MNode[] {
    this.ws();
    if (this.atEnd()) return fail("missing operand");
    if (this.s[this.i] === "{") return this.braced();
    if (this.s[this.i] === "\\") {
      const cmd = this.peekCmd();
      if (cmd && ["frac", "sqrt", "left", "begin"].includes(cmd)) return this.atom();
    }
    return this.atom();
  }

  braced(): MNode[] {
    if (this.s[this.i] !== "{") fail("expected {");
    this.i++;
    const inner = this.seq();
    this.ws();
    if (this.s[this.i] !== "}") fail("unbalanced {");
    this.i++;
    return inner;
  }

  /** Apply scripts to `base`, converting n-ary operators / limit functions / pre-scripts as needed. */
  private script(base: MNode[], lo?: MNode[], hi?: MNode[]): MNode[] {
    const last = base[base.length - 1];
    if (base.length === 1 && last.k === "x" && last.nary) {
      return [xnode(last.xml.replace("<!--SUB-->", lo ? emit(lo) : "").replace("<!--SUP-->", hi ? emit(hi) : ""), { nary: true })];
    }
    const sp = (tag: string, parts: string) => xnode(`<m:${tag}><m:${tag}Pr>${CTRL}</m:${tag}Pr>${parts}</m:${tag}>`);
    const e = wrapE("e", base);
    if (lo && hi) return [sp("sSubSup", `${e}${wrapE("sub", lo)}${wrapE("sup", hi)}`)];
    if (hi) return [sp("sSup", `${e}${wrapE("sup", hi)}`)];
    return [sp("sSub", `${e}${wrapE("sub", lo!)}`)];
  }

  /** Operand of a function/n-ary operator: next group or term; empty before a closing token or relation. */
  private tail(): MNode[] {
    this.ws();
    const c = this.s[this.i];
    if (this.atEnd() || /[}&\]=+\-,)<>]/.test(c ?? "")) return [];
    if (c === "\\") {
      const cmd = this.peekCmd();
      if (cmd === "\\" || cmd === "right" || cmd === "middle" || cmd === "end") return [];
    }
    if (c === "{") {
      const g = this.braced();
      return g;
    }
    return this.term();
  }

  atom(): MNode[] {
    this.ws();
    if (this.atEnd()) return fail("unexpected end");
    const c = this.s[this.i];
    if (c === "{") {
      const g = this.braced();
      this.ws();
      if (g.length === 0 && /[_^]/.test(this.s[this.i] ?? "")) return this.preScripts();
      // A group is transparent; keep it as a single x-node when it has several parts so scripts apply to all of it.
      if (g.length > 1) return [xnode(emit(g))];
      return g;
    }
    if (c === "\\") return this.command();
    this.i++;
    if (c === "^" || c === "_" || c === "}" || c === "]" && false) return fail("unexpected " + c);
    if (c === "-") return [{ k: "ch", c: "−" }];
    return [{ k: "ch", c }];
  }

  private preScripts(): MNode[] {
    let lo: MNode[] = [];
    let hi: MNode[] = [];
    for (let n = 0; n < 2; n++) {
      this.ws();
      const c = this.s[this.i];
      if (c === "_") {
        this.i++;
        lo = this.operand();
      } else if (c === "^") {
        this.i++;
        hi = this.operand();
      }
    }
    const e = this.tail();
    return [xnode(`<m:sPre><m:sPrePr>${CTRL}</m:sPrePr>${wrapE("sub", lo)}${wrapE("sup", hi)}${wrapE("e", e)}</m:sPre>`)];
  }

  private expectChar(ch: string) {
    this.ws();
    if (this.s[this.i] !== ch) fail("expected " + ch);
    this.i++;
  }

  private readDelim(): string {
    this.ws();
    const m = /^(\\[A-Za-z]+|\\.|.)/s.exec(this.s.slice(this.i));
    if (!m) return fail("delimiter");
    this.i += m[1].length;
    const d = DELIMS[m[1]];
    if (d === undefined) return fail("delimiter " + m[1]);
    return d;
  }

  private rawGroupText(): string {
    this.ws();
    if (this.s[this.i] !== "{") fail("expected {");
    let depth = 0;
    const start = this.i + 1;
    for (; this.i < this.s.length; this.i++) {
      if (this.s[this.i] === "\\") this.i++;
      else if (this.s[this.i] === "{") depth++;
      else if (this.s[this.i] === "}" && --depth === 0) break;
    }
    if (this.i >= this.s.length) fail("unbalanced {");
    const t = this.s.slice(start, this.i);
    this.i++;
    return t;
  }

  private styled(sty: "p" | "b" | "bi" | "nor", raw: boolean): MNode[] {
    if (raw) {
      const t = this.rawGroupText()
        .replace(/\\([{}$%&#_])/g, "$1")
        .replace(/\\ /g, " ");
      if (/\\/.test(t)) fail("command inside \\text");
      return Array.from(t, (c) => ({ k: "ch", c, sty }) as MNode);
    }
    const inner = this.operand();
    return inner.map((n) => (n.k === "ch" ? { ...n, sty } : n));
  }

  /** Rows of cells until `\end{env}`. */
  private rows(env: string): MNode[][][] {
    const rows: MNode[][][] = [[]];
    for (;;) {
      const cell = this.seq();
      rows[rows.length - 1].push(cell);
      this.ws();
      if (this.s[this.i] === "&") {
        this.i++;
        continue;
      }
      if (this.peekCmd() === "\\") {
        this.i += 2;
        rows.push([]);
        continue;
      }
      if (this.peekCmd() === "end") {
        this.i += 4;
        const name = this.rawGroupText();
        if (name !== env) fail("mismatched environment");
        break;
      }
      fail("unterminated environment");
    }
    // trailing `\\`
    const last = rows[rows.length - 1];
    if (rows.length > 1 && last.length === 1 && last[0].length === 0) rows.pop();
    return rows;
  }

  private matrixXml(rows: MNode[][][]): string {
    const cols = Math.max(...rows.map((r) => r.length));
    const mr = rows.map((r) => `<m:mr>${r.map((c) => wrapE("e", c)).join("")}${"<m:e/>".repeat(cols - r.length)}</m:mr>`).join("");
    return `<m:m><m:mPr>${CTRL}</m:mPr>${mr}</m:m>`;
  }

  private delimXml(beg: string, end: string, es: MNode[][], sep?: string): string {
    const pr =
      `<m:dPr><m:begChr m:val="${esc(beg)}"/>${sep !== undefined ? `<m:sepChr m:val="${esc(sep)}"/>` : ""}` +
      `<m:endChr m:val="${esc(end)}"/>${CTRL}</m:dPr>`;
    return `<m:d>${pr}${es.map((e) => wrapE("e", e)).join("")}</m:d>`;
  }

  private command(): MNode[] {
    const m = /^\\([A-Za-z]+|.)/s.exec(this.s.slice(this.i));
    if (!m) return fail("bad command");
    const name = m[1];
    this.i += m[0].length;
    if (name in SPACES) return SPACES[name] ? [{ k: "ch", c: SPACES[name] }] : [];
    if (/^[{}$%&#_|]$/.test(name)) return [{ k: "ch", c: name }];
    if (name === "|") return [{ k: "ch", c: "‖" }];
    if (name in SYMBOLS) return [{ k: "ch", c: SYMBOLS[name] }];
    if (name in NARY) {
      const chr = NARY[name];
      const natural = INT_LIKE.has(chr) ? "subSup" : "undOvr";
      let loc = natural;
      for (;;) {
        this.ws();
        const nx = /^\\(limits|nolimits)(?![A-Za-z])/.exec(this.s.slice(this.i));
        if (!nx) break;
        this.i += nx[0].length;
        loc = nx[1] === "limits" ? "undOvr" : "subSup";
      }
      // Scripts are applied by term(): placeholders, then the operand follows.
      const opStart = this.i;
      let lo: MNode[] | undefined;
      let hi: MNode[] | undefined;
      for (let n = 0; n < 2; n++) {
        this.ws();
        const c = this.s[this.i];
        if (c === "_" && !lo) {
          this.i++;
          lo = this.operand();
        } else if (c === "^" && !hi) {
          this.i++;
          hi = this.operand();
        }
      }
      void opStart;
      const e = this.tail();
      const locXml = loc !== natural || true ? `<m:limLoc m:val="${loc}"/>` : "";
      const pr =
        `<m:naryPr><m:chr m:val="${chr}"/>${locXml}${lo ? "" : '<m:subHide m:val="1"/>'}${hi ? "" : '<m:supHide m:val="1"/>'}${CTRL}</m:naryPr>`;
      return [xnode(`<m:nary>${pr}${wrapE("sub", lo ?? [])}${wrapE("sup", hi ?? [])}${wrapE("e", e)}</m:nary>`)];
    }
    if (FUNC_NAMES.has(name) || name === "operatorname") {
      let fname: string;
      if (name === "operatorname") fname = this.rawGroupText();
      else fname = name;
      if (!/^[A-Za-z]+$/.test(fname)) fail("operatorname");
      const fnameXml = runXml(fname, "p");
      if (LIMIT_FUNCS.has(fname) && /^\s*_/.test(this.s.slice(this.i))) {
        this.ws();
        this.i++;
        const lim = this.operand();
        const ll = `<m:limLow><m:limLowPr>${CTRL}</m:limLowPr><m:e>${fnameXml}</m:e>${wrapE("lim", lim)}</m:limLow>`;
        const e = this.tail();
        return [xnode(`<m:func><m:funcPr>${CTRL}</m:funcPr><m:fName>${ll}</m:fName>${wrapE("e", e)}</m:func>`)];
      }
      let fn = fnameXml;
      this.ws();
      const sc = this.s[this.i];
      if (sc === "^" || sc === "_") {
        let lo: MNode[] | undefined;
        let hi: MNode[] | undefined;
        for (let n = 0; n < 2; n++) {
          this.ws();
          const c = this.s[this.i];
          if (c === "_" && !lo) {
            this.i++;
            lo = this.operand();
          } else if (c === "^" && !hi) {
            this.i++;
            hi = this.operand();
          }
        }
        const tag = lo && hi ? "sSubSup" : hi ? "sSup" : "sSub";
        fn =
          `<m:${tag}><m:${tag}Pr>${CTRL}</m:${tag}Pr><m:e>${fnameXml}</m:e>` +
          `${lo ? wrapE("sub", lo) : ""}${hi ? wrapE("sup", hi) : ""}</m:${tag}>`;
      }
      const e = this.tail();
      return [xnode(`<m:func><m:funcPr>${CTRL}</m:funcPr><m:fName>${fn}</m:fName>${wrapE("e", e)}</m:func>`)];
    }
    switch (name) {
      case "frac":
      case "dfrac":
      case "tfrac": {
        const a = this.operand();
        const b = this.operand();
        return [xnode(`<m:f><m:fPr>${CTRL}</m:fPr>${wrapE("num", a)}${wrapE("den", b)}</m:f>`)];
      }
      case "binom":
      case "dbinom":
      case "tbinom": {
        const a = this.operand();
        const b = this.operand();
        const f = `<m:f><m:fPr><m:type m:val="noBar"/>${CTRL}</m:fPr>${wrapE("num", a)}${wrapE("den", b)}</m:f>`;
        return [xnode(this.delimXml("(", ")", [[xnode(f)]]))];
      }
      case "sqrt": {
        this.ws();
        let deg: MNode[] | undefined;
        if (this.s[this.i] === "[") {
          this.i++;
          deg = this.seq(true);
          this.expectChar("]");
        }
        const e = this.operand();
        const pr = `<m:radPr>${deg ? "" : '<m:degHide m:val="1"/>'}${CTRL}</m:radPr>`;
        return [xnode(`<m:rad>${pr}${wrapE("deg", deg ?? [])}${wrapE("e", e)}</m:rad>`)];
      }
      case "left": {
        const beg = this.readDelim();
        const es: MNode[][] = [];
        let sep: string | undefined;
        for (;;) {
          es.push(this.seq());
          this.ws();
          const cmd = this.peekCmd();
          if (cmd === "middle") {
            this.i += 7;
            const s = this.readDelim();
            if (sep !== undefined && sep !== s) fail("mixed separators");
            sep = s;
            continue;
          }
          if (cmd === "right") {
            this.i += 6;
            break;
          }
          fail("unterminated \\left");
        }
        const end = this.readDelim();
        return [xnode(this.delimXml(beg, end, es, sep))];
      }
      case "begin": {
        const env = this.rawGroupText();
        const delims: Record<string, [string, string]> = {
          pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["{", "}"], vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"],
        };
        if (env === "matrix" || env in delims) {
          const mx = this.matrixXml(this.rows(env));
          if (env === "matrix") return [xnode(mx)];
          return [xnode(this.delimXml(delims[env][0], delims[env][1], [[xnode(mx)]]))];
        }
        if (env === "aligned" || env === "align" || env === "align*" || env === "gathered" || env === "cases") {
          const rows = this.rows(env);
          const cells = rows.map((r) => {
            // Cells of one row are joined with an alignment point (`&`), as Word does.
            const out: MNode[] = [];
            r.forEach((c, n) => {
              if (n) out.push({ k: "ch", c: "&" });
              out.push(...c);
            });
            return out;
          });
          const arr = `<m:eqArr><m:eqArrPr>${CTRL}</m:eqArrPr>${cells.map((c) => wrapE("e", c)).join("")}</m:eqArr>`;
          return [xnode(env === "cases" ? this.delimXml("{", "", [[xnode(arr)]]) : arr)];
        }
        return fail("environment " + env);
      }
      case "text":
      case "textrm":
      case "mbox":
      case "hbox":
        return this.styled("nor", true);
      case "mathrm":
        return this.styled("p", false);
      case "mathbf":
        return this.styled("b", false);
      case "boldsymbol":
      case "bm":
        return this.styled("bi", false);
      case "mathbb": {
        const g = this.operand();
        return g.map((n) => (n.k === "ch" && BB[n.c] ? { ...n, c: BB[n.c] } : n));
      }
      case "overline":
      case "underline": {
        const e = this.operand();
        const pos = name === "overline" ? "top" : "bot";
        return [xnode(`<m:bar><m:barPr><m:pos m:val="${pos}"/>${CTRL}</m:barPr>${wrapE("e", e)}</m:bar>`)];
      }
      case "overbrace":
      case "underbrace": {
        const e = this.operand();
        const chr = name === "overbrace" ? "⏞" : "⏟";
        const pos = name === "overbrace" ? "top" : "bot";
        return [xnode(`<m:groupChr><m:groupChrPr><m:chr m:val="${chr}"/><m:pos m:val="${pos}"/>${CTRL}</m:groupChrPr>${wrapE("e", e)}</m:groupChr>`)];
      }
      case "overset":
      case "underset": {
        const lim = this.operand();
        const e = this.operand();
        const tag = name === "overset" ? "limUpp" : "limLow";
        return [xnode(`<m:${tag}><m:${tag}Pr>${CTRL}</m:${tag}Pr>${wrapE("e", e)}${wrapE("lim", lim)}</m:${tag}>`)];
      }
      case "limits":
      case "nolimits":
        return [];
    }
    if (name in ACCENTS) {
      const e = this.operand();
      return [xnode(`<m:acc><m:accPr><m:chr m:val="${ACCENTS[name]}"/>${CTRL}</m:accPr>${wrapE("e", e)}</m:acc>`)];
    }
    return fail("command \\" + name);
  }
}

/** LaTeX -> OMML (`<m:oMath>` / `<m:oMathPara>` markup without namespace declarations), or null if unsupported. */
export function latexToOmml(latex: string, display = false): string | null {
  try {
    const p = new Parser(latex);
    const nodes = p.seq();
    p.i < latex.length && /\S/.test(latex.slice(p.i)) && fail("trailing input");
    const body = `<m:oMath>${emit(nodes)}</m:oMath>`;
    return display ? `<m:oMathPara>${body}</m:oMathPara>` : body;
  } catch (e) {
    if (e instanceof LatexError) return null;
    throw e;
  }
}

/** Remove everything that does not affect the structure/content (formatting-only properties), for comparisons. */
export function ommlSignature(omml: string): string | null {
  const root = parseXml(omml);
  if (!root) return null;
  const walk = (el: Element): string => {
    const n = el.localName;
    if (n === "ctrlPr" || n === "rPr" && el.namespaceURI === W_NS) return "";
    const attrs = Array.from(el.attributes)
      .filter((a) => !a.name.startsWith("xmlns"))
      .map((a) => `${a.localName}=${a.value}`)
      .sort()
      .join(",");
    const body = kids(el).map(walk).join("");
    return `<${n}${attrs ? " " + attrs : ""}>${n === "t" ? el.textContent : ""}${body}</${n}>`;
  };
  return kids(root).map(walk).join("");
}

/** Package namespaces declared when (re)inserting stored OMML fragments. */
export const OMML_PKG_NAMESPACES =
  `xmlns:m="${OMML_NS}" xmlns:w="${W_NS}" ` +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
