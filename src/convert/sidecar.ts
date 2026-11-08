/** A Word-only object that has no markdown representation; kept verbatim so it survives md editing. */
export interface SidecarEntry {
  kind: string;
  html: string;
  /** Ordinary inline image, referenced by <!-- word:img id=... --> rather than hiding its whole paragraph. */
  inline?: boolean;
  /** Original bytes were not captured reliably. Applying this entry must refuse rather than insert a blank. */
  unavailable?: boolean;
  /** Image renderer size/colour profile; absent means the original 11pt/black policy. */
  renderProfile?:string;
  /** Lossless OOXML of the block (floating objects), possibly compressed by the caller. Used instead of `html`. */
  ooxml?: string;
  /** kind "math": the equation's LaTeX and the original OMML it was read from (restored verbatim if unchanged). */
  latex?: string;
  omml?: string;
  /** kind "math": further OMML variants that read as the same LaTeX (consumed in order on apply). */
  alts?: string[];
  /**
   * kind "mathimg" (LaTeX Word cannot hold as an equation, shown as a picture): `latex` is the source, `png` the
   * base64 PNG as inserted, `w`/`h` its size in CSS px (1/96 in), `baseline` the distance from the picture's top to the
   * text baseline in px, `v` the render version.
   */
  display?: boolean;
  png?: string;
  w?: number;
  h?: number;
  baseline?: number;
  v?: number;
  /** kind "equation": number of equations inside the opaque paragraph. */
  count?: number;
  /** kind "table": the markdown table (lines) as shown at load; ooxml holds the original table. */
  md?: string;
  /** kind "table": the `<Relationship>` elements (hyperlinks) the original table's markup refers to. */
  rels?: string;
  /** Day number (days since the Unix epoch) when the entry was last referenced; drives retention, see retainSidecar. */
  t?: number;
}

export interface Sidecar {
  get(id: string): SidecarEntry | undefined;
  set(id: string, entry: SidecarEntry): void;
  entries(): Iterable<[string, SidecarEntry]>;
}

export class MemorySidecar implements Sidecar {
  private readonly map = new Map<string, SidecarEntry>();
  get(id: string) {
    return this.map.get(id);
  }
  set(id: string, entry: SidecarEntry) {
    this.map.set(id, entry);
  }
  entries() {
    return this.map.entries();
  }
}

/** Copy of `sidecar` that keeps only the entries whose id is in `keep`. */
export function pruneSidecar(sidecar: Sidecar, keep: Set<string>): Sidecar {
  const out = new MemorySidecar();
  for (const [id, entry] of sidecar.entries()) if (keep.has(id)) out.set(id, entry);
  return out;
}

/** Entries that are still referenced get their day number refreshed only this often (keeps the stored part stable). */
const SIDECAR_TOUCH_DAYS = 7;

export const dayNumber = (now: number = Date.now()) => Math.floor(now / 86_400_000);

/**
 * Retention for the document-wide sidecar. The sidecar is shared by every region of the document, so it must NOT be
 * cleaned up to "what the current selection references": loading region B would delete what region A still needs.
 * Entries in `keep` are marked as used. All other entries are retained too: absence from this selection proves
 * nothing about references elsewhere in the document. Age and size are not safe grounds for deleting originals.
 * Automatic collection must wait until document-wide references can be determined reliably.
 */
export function retainSidecar(
  sidecar: Sidecar,
  keep: Set<string>,
  today: number = dayNumber(),
): Sidecar {
  const out = new MemorySidecar();
  for (const [id, e] of sidecar.entries()) {
    const kept = keep.has(id);
    let entry = e;
    if (entry.t === undefined) entry = { ...entry, t: today };
    else if (kept && today - entry.t >= SIDECAR_TOUCH_DAYS) entry = { ...entry, t: today };
    out.set(id, entry);
  }
  return out;
}

/**
 * Word writes fresh revision ids (`w:rsid*`) and paragraph ids (`w14:paraId`/`textId`) into the OOXML of every
 * `getOoxml` call, so the same table or floating object is never byte-equal between two loads.
 */
export const normalizeOoxml = (x: string) =>
  x.replace(/\s(?:w:rsid\w*|w14:paraId|w14:textId)="[^"]*"/g, "").replace(/<w:rsid(?:Root)?\s+w:val="[^"]*"\s*\/>/g, "");

/**
 * Entries of `next` that equal the stored one up to those volatile ids are replaced by the stored entry, so an
 * unchanged document yields an unchanged sidecar (and the Custom XML Part need not be rewritten).
 * `ungz` expands `gz:` values.
 */
export async function keepEquivalentEntries(
  next: Sidecar,
  previous: Sidecar,
  ungz: (s: string) => Promise<string>,
): Promise<Sidecar> {
  const out = new MemorySidecar();
  for (const [id, entry] of next.entries()) {
    const old = previous.get(id);
    let keep = false;
    if (old && old.kind === entry.kind) {
      // The day number is bookkeeping, not content.
      const { ooxml: a, t: _tOld, ...restOld } = old;
      const { ooxml: b, t: _tNew, ...restNew } = entry;
      if (JSON.stringify(restOld) === JSON.stringify(restNew)) {
        if (a === undefined && b === undefined) keep = true;
        else if (a !== undefined && b !== undefined)
          keep = a === b || normalizeOoxml(await ungz(a)) === normalizeOoxml(await ungz(b));
      }
    }
    out.set(id, keep ? old! : entry);
  }
  return out;
}

export const SIDECAR_NAMESPACE = "urn:obsidian-in-word:sidecar:v1";

/**
 * Serialize to a Custom XML Part payload. The JSON is URI-encoded so arbitrary HTML
 * (including "]]>") can never break the XML.
 */
export function sidecarToXml(sidecar: Sidecar): string {
  const json = JSON.stringify(Object.fromEntries(sidecar.entries()));
  return `<sidecar xmlns="${SIDECAR_NAMESPACE}">${encodeURIComponent(json)}</sidecar>`;
}

export function sidecarFromXml(xml: string, into: Sidecar = new MemorySidecar()): Sidecar {
  const m = /<sidecar\b[^>]*>([\s\S]*?)<\/sidecar>/.exec(xml);
  if (!m){if(xml.includes(SIDECAR_NAMESPACE))throw new Error('Word 원본 보존 데이터의 루트가 올바르지 않습니다');return into;}
  const data = JSON.parse(decodeURIComponent(m[1])) as Record<string, SidecarEntry>;
  if(!data || typeof data!=='object' || Array.isArray(data))throw new Error('Word 원본 보존 데이터 형식이 올바르지 않습니다');
  const entries=Object.entries(data);
  for(const [id,entry] of entries){
    if(!/^[0-9a-f]{8}$/.test(id) || !entry || typeof entry!=='object' || typeof entry.kind!=='string' || typeof entry.html!=='string')throw new Error('Word 원본 보존 항목이 손상되었습니다');
    if((entry.latex!==undefined && typeof entry.latex!=='string') || (entry.display!==undefined && typeof entry.display!=='boolean') || (entry.inline!==undefined && typeof entry.inline!=='boolean') || (entry.renderProfile!==undefined && typeof entry.renderProfile!=='string') || (entry.unavailable!==undefined && typeof entry.unavailable!=='boolean'))throw new Error('Word 개체 식별 정보가 손상되었습니다');
    const old=into.get(id);
    if(old && (old.kind!==entry.kind || old.latex!==entry.latex || !!old.display!==!!entry.display || !!old.inline!==!!entry.inline || (old.renderProfile??'')!==(entry.renderProfile??'')))throw new Error(`Word 원본 식별자가 충돌합니다 (${id}). 문서를 확인하세요`);
  }
  for (const [id, entry] of entries) into.set(id, entry);
  return into;
}
