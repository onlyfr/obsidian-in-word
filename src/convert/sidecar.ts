/** A Word-only object that has no markdown representation; kept verbatim so it survives md editing. */
export interface SidecarEntry {
  kind: string;
  html: string;
  /** Lossless OOXML of the block (floating objects), possibly compressed by the caller. Used instead of `html`. */
  ooxml?: string;
  /** kind "math": the equation's LaTeX and the original OMML it was read from (restored verbatim if unchanged). */
  latex?: string;
  omml?: string;
  /** kind "math": further OMML variants that read as the same LaTeX (consumed in order on apply). */
  alts?: string[];
  /** kind "equation": number of equations inside the opaque paragraph. */
  count?: number;
  /** kind "table": the markdown table (lines) as shown at load; ooxml holds the original table. */
  md?: string;
  /** kind "table": the `<Relationship>` elements (hyperlinks) the original table's markup refers to. */
  rels?: string;
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
  if (!m) return into;
  const data = JSON.parse(decodeURIComponent(m[1])) as Record<string, SidecarEntry>;
  for (const [id, entry] of Object.entries(data)) into.set(id, entry);
  return into;
}
