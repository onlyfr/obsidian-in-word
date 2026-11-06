/**
 * Math that cannot become an editable Word equation (rung 2 of the ladder in docs/unsupported-syntax.md): the LaTeX is
 * rendered to a picture; the LaTeX source stays in the sidecar (kind `mathimg`, id = hash(latex, display, render
 * version)) and in the picture's alt text (`owb:math:<id>[:d] <latex>`), so loading shows `$…$` / `$$…$$` again.
 *
 * Everything here is pure (the rasterizer sits behind {@link MathRasterizer}); this module and the real rasterizer
 * (mathraster.ts) are only fetched on demand (dynamic import) so the main bundle does not grow.
 */
import { MATHIMG_VERSION, mathImgKey, type MathResolved } from "./equations";
import type { Sidecar, SidecarEntry } from "./sidecar";

/** Output preference for math spans that have editable LaTeX (opaque Word blocks stay verbatim). */
export type MathOutputMode = "hybrid" | "images";

/** Hard limits; anything beyond falls back to rung 3 (literal `$…$` text with a warning). */
export const LIMITS = {
  /** Longest LaTeX source that is rendered. */
  maxLatex: 2000,
  /** Largest picture in CSS px (1/96 in) at 1x. */
  maxWidth: 1200,
  maxHeight: 600,
  /** Largest PNG (bytes before base64): keeps the Custom XML Part small. */
  maxPng: 300_000,
  /** One render. */
  timeoutMs: 8000,
  /** All renders of one apply (the rest falls to rung 3). */
  budgetMs: 40_000,
  /** Widest a picture may be placed in Word (px, 1/96 in); wider ones are scaled down to this (A4/Letter text width). */
  placeWidth: 600,
  /** Longest LaTeX kept in the alt text. */
  altLatex: 120,
};

export interface RasterResult {
  /** Base64 PNG (no data: prefix), transparent background. */
  png: string;
  /** Size in CSS px (1/96 in); the PNG has `scale` times as many pixels. */
  w: number;
  h: number;
  /** Distance from the picture's top to the text baseline, in CSS px. */
  baseline: number;
  scale: number;
}

export type RasterFailure = "unavailable" | "unsupported" | "too-large" | "timeout" | "blank" | "tainted" | "error";

export class RasterError extends Error {
  constructor(
    readonly code: RasterFailure,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** Turns LaTeX into a picture. The real implementation lives in mathraster.ts; tests fake it. Throws {@link RasterError}. */
export interface MathRasterizer {
  render(latex: string, display: boolean): Promise<RasterResult>;
}

// ---------------------------------------------------------------------------------------------------------------
// alt text

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `owb:math:<id>[:d] <latex>` - the LaTeX is collapsed to one line and truncated (`…`) when long. */
export function mathImgAlt(id: string, latex: string, display: boolean): string {
  const one = latex.replace(/\s+/g, " ").trim();
  const text = one.length > LIMITS.altLatex ? one.slice(0, LIMITS.altLatex - 1) + "…" : one;
  return `owb:math:${id}${display ? ":d" : ""} ${text}`;
}

/** Inverse of {@link mathImgAlt}; `latex` is only set when it was not truncated. null for any other alt text. */
export function parseMathImgAlt(alt: string): { id: string; display: boolean; latex?: string } | null {
  const m = /^owb:math:([0-9a-f]{8})(:d)?(?: (.*))?$/s.exec(alt);
  if (!m) return null;
  return { id: m[1], display: !!m[2], latex: m[3] === undefined || m[3].endsWith("…") ? undefined : m[3] };
}

// ---------------------------------------------------------------------------------------------------------------
// ladder: OMML (already decided by tokenizeMath) -> picture -> literal text

export interface PictureOutcome {
  kind: "image";
  item: MathResolved;
  id: string;
  entry: SidecarEntry;
  /** Came from the sidecar (the stored picture is restored byte for byte, nothing was rendered). */
  stored: boolean;
}
export interface LiteralOutcome {
  kind: "literal";
  item: MathResolved;
  reason: RasterFailure | "too-long";
}
export type MathImgOutcome = PictureOutcome | LiteralOutcome;

const validEntry = (e: SidecarEntry | undefined, latex: string, display: boolean): e is SidecarEntry =>
  !!e &&
  e.kind === "mathimg" &&
  e.latex === latex &&
  !!e.display === display &&
  e.v === MATHIMG_VERSION &&
  typeof e.png === "string" &&
  e.png.length > 0 &&
  Number.isFinite(e.w) &&
  Number.isFinite(e.h) &&
  Number.isFinite(e.baseline);

function checkResult(r: RasterResult): void {
  const ok = (n: number) => Number.isFinite(n) && n > 0;
  if (!r || typeof r.png !== "string" || !r.png || !ok(r.w) || !ok(r.h) || !ok(r.scale) || !Number.isFinite(r.baseline))
    throw new RasterError("error", "invalid render result");
  if (r.w > LIMITS.maxWidth || r.h > LIMITS.maxHeight) throw new RasterError("too-large", `${r.w}x${r.h}px`);
  if ((r.png.length * 3) / 4 > LIMITS.maxPng) throw new RasterError("too-large", "png");
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new RasterError("timeout")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });

/**
 * Decide, for every math span that has no OMML, between the stored picture, a fresh render and literal text.
 * Never throws: every failure becomes a `literal` outcome. New pictures are written to `sidecar`.
 * `rasterizer` is only called when something has to be rendered (a loader failure => "unavailable").
 */
export async function resolveMathImages(
  items: MathResolved[],
  sidecar: Sidecar,
  rasterizer: () => Promise<MathRasterizer>,
  now: () => number = Date.now,
): Promise<MathImgOutcome[]> {
  const out: MathImgOutcome[] = [];
  let r: MathRasterizer | null | undefined;
  const started = now();
  const done = new Map<string, MathImgOutcome>(); // same formula twice => one picture
  for (const item of items) {
    const id = mathImgKey(item.latex, item.display);
    const key = id;
    const prev = done.get(key);
    if (prev) {
      out.push({ ...prev, item } as MathImgOutcome);
      continue;
    }
    const stored = sidecar.get(id);
    let res: MathImgOutcome;
    if (validEntry(stored, item.latex, item.display)) res = { kind: "image", item, id, entry: stored, stored: true };
    else if (item.latex.length > LIMITS.maxLatex) res = { kind: "literal", item, reason: "too-long" };
    else if (now() - started > LIMITS.budgetMs) res = { kind: "literal", item, reason: "timeout" };
    else {
      try {
        r ??= await rasterizer();
      } catch {
        r = null;
      }
      if (!r) res = { kind: "literal", item, reason: "unavailable" };
      else {
        try {
          const rr = await withTimeout(r.render(item.latex, item.display), LIMITS.timeoutMs);
          checkResult(rr);
          const entry: SidecarEntry = {
            kind: "mathimg",
            html: "",
            latex: item.latex,
            display: item.display,
            png: rr.png,
            w: rr.w,
            h: rr.h,
            baseline: rr.baseline,
            v: MATHIMG_VERSION,
          };
          sidecar.set(id, entry);
          res = { kind: "image", item, id, entry, stored: false };
        } catch (e) {
          res = { kind: "literal", item, reason: e instanceof RasterError ? e.code : "error" };
        }
      }
    }
    done.set(key, res);
    out.push(res);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Word side

const EMU_PER_PX = 9525;
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
export const IMG_REL_ID = "rIdOwbMath1";

/** Size the picture is placed at (CSS px): the render size, scaled down when wider than a text column. */
export function placedSize(w: number, h: number): { w: number; h: number; f: number } {
  const f = w > LIMITS.placeWidth ? LIMITS.placeWidth / w : 1;
  return { w: w * f, h: h * f, f };
}

/**
 * Inline run holding the picture. Inline math is lowered by the picture's descent (`w:position`, half-points) so the
 * formula's baseline sits on the text baseline; display math is a centered paragraph and needs no shift.
 */
export function mathImageRun(id: string, entry: SidecarEntry, docPrId: number, display: boolean): string {
  const { w, h, f } = placedSize(entry.w!, entry.h!);
  const cx = Math.round(w * EMU_PER_PX);
  const cy = Math.round(h * EMU_PER_PX);
  const alt = escapeAttr(mathImgAlt(id, entry.latex ?? "", display));
  const name = `owb-math-${id}`;
  // 1 CSS px = 0.75 pt = 1.5 half-points
  const lower = display ? 0 : Math.round((entry.h! - entry.baseline!) * f * 1.5);
  const position = lower >= 1 ? `<w:rPr><w:position w:val="-${Math.min(lower, 1584)}"/></w:rPr>` : "";
  return (
    `<w:r>${position}<w:drawing>` +
    `<wp:inline xmlns:wp="${WP_NS}" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docPrId}" name="${name}" descr="${alt}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A_NS}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${PIC_NS}"><pic:pic xmlns:pic="${PIC_NS}">` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="${name}.png" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${IMG_REL_ID}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

/** Body paragraph (display: centered) plus the relationship and media part for `wrapPackage(body, rels, parts)`. */
export function mathImagePackageParts(
  id: string,
  entry: SidecarEntry,
  docPrId: number,
  display: boolean,
): { body: string; rels: string; parts: string } {
  const run = mathImageRun(id, entry, docPrId, display);
  return {
    body: display ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run}</w:p>` : `<w:p>${run}</w:p>`,
    rels: `<Relationship Id="${IMG_REL_ID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/owbmath.png"/>`,
    parts: `<pkg:part pkg:name="/word/media/owbmath.png" pkg:contentType="image/png" pkg:compression="store"><pkg:binaryData>${entry.png}</pkg:binaryData></pkg:part>`,
  };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Rung 3: the source as visible text (yellow highlight so it stands out in the document). */
export function literalMathHtml(latex: string, display: boolean): string {
  const d = display ? "$$" : "$";
  return `<span style="background:#ffff00;mso-highlight:yellow">${escapeHtml(d + latex.replace(/\s+/g, " ") + d)}</span>`;
}

const REASON_TEXT: Record<LiteralOutcome["reason"], string> = {
  "too-long": `LaTeX가 ${LIMITS.maxLatex}자를 넘음`,
  "too-large": "그림이 너무 큼",
  timeout: "그리기 시간 초과",
  unavailable: "수식 그리기 기능을 불러오지 못함",
  unsupported: "그릴 수 없는 LaTeX",
  blank: "그림이 비어 있음",
  tainted: "그림을 만들 수 없음(보안 제한)",
  error: "그림 만들기 실패",
};

export interface MathImgPlan {
  /** `html` with the literal fallbacks written in. */
  html: string;
  /** Spans that are inserted as equations or pictures (literal ones are already text in `html`). */
  active: MathResolved[];
  /** marker -> package parts, for the picture ones. */
  pictures: Map<string, { body: string; rels: string; parts: string }>;
  /** Status notes (Korean) for the apply result. */
  notes: string[];
  counts: { pictures: number; stored: number; literal: number };
}

/** Fold the outcomes into the apply: picture packages for the good ones, literal text in the HTML for the rest. */
export function planMathImages(html: string, equations: MathResolved[], outcomes: MathImgOutcome[], mode: MathOutputMode = "hybrid"): MathImgPlan {
  const byMarker = new Map(outcomes.map((o) => [o.item.marker, o]));
  const pictures: MathImgPlan["pictures"] = new Map();
  const active: MathResolved[] = [];
  const reasons = new Map<string, number>();
  let stored = 0;
  let nextId = 1000;
  for (const q of equations) {
    const o = byMarker.get(q.marker);
    if (!o) {
      active.push(q);
      continue;
    }
    if (o.kind === "image") {
      pictures.set(q.marker, mathImagePackageParts(o.id, o.entry, nextId++, q.display));
      // insertOoxml(replace) keeps the formatting of the paragraph it replaces (measured in Word), so center that one.
      if (q.display) html = html.replace(`<p class="MsoNormal">${q.marker}</p>`, () => `<p class="MsoNormal" align="center">${q.marker}</p>`);
      active.push(q);
      if (o.stored) stored++;
    } else {
      html = html.replace(q.marker, () => literalMathHtml(q.latex, q.display));
      const t = REASON_TEXT[o.reason];
      reasons.set(t, (reasons.get(t) ?? 0) + 1);
    }
  }
  const literal = outcomes.length - pictures.size;
  const notes: string[] = [];
  if (pictures.size)
    notes.push(mode === "images"
      ? `설정에 따라 수식 ${pictures.size}개를 그림으로 넣었습니다 (불러오면 LaTeX로 다시 보입니다)`
      : `수식 ${pictures.size}개는 Word 수식으로 만들 수 없어 그림으로 넣었습니다 (불러오면 LaTeX로 다시 보입니다)`);
  if (literal)
    notes.push(
      `경고: 수식 ${literal}개는 그림으로도 만들 수 없어 $…$ 소스 그대로 노란 표시로 넣었습니다 (${[...reasons]
        .map(([t, n]) => `${t} ${n}`)
        .join(", ")})`,
    );
  return { html, active, pictures, notes, counts: { pictures: pictures.size, stored, literal } };
}

/** The whole picture rung for one apply: stored pictures / renders / literal fallbacks (the real rasterizer is lazy). */
export async function applyMathImages(
  html: string,
  equations: MathResolved[],
  sidecar: Sidecar,
  rasterizer: () => Promise<MathRasterizer> = async () => (await import("./mathraster")).createRasterizer(),
  mode: MathOutputMode = "hybrid",
): Promise<MathImgPlan> {
  const planned = mode === "images" ? equations.map(q => ({ ...q, omml: "", img: true })) : equations;
  const outcomes = await resolveMathImages(
    planned.filter((q) => q.img),
    sidecar,
    rasterizer,
  );
  return planMathImages(html, planned, outcomes, mode);
}
