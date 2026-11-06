import { describe, expect, it } from "vitest";
import { leftoverChecks } from "../src/taskpane/markers";
import { htmlToMarkdown, renderWithSidecar } from "../src/convert/obsidian";
import { mathImgAlt, mathImageRun } from "../src/convert/mathimg";
import { mathImgKey, scanOoxml, wrapPackage } from "../src/convert/equations";
import {
  MemorySidecar,
  keepEquivalentEntries,
  retainSidecar,
  sidecarToXml,
  type SidecarEntry,
} from "../src/convert/sidecar";

const entry = (over: Partial<SidecarEntry> = {}): SidecarEntry => ({ kind: "math", html: "", latex: "x", ...over });
const sc = (rows: Record<string, SidecarEntry>) => {
  const s = new MemorySidecar();
  for (const [k, v] of Object.entries(rows)) s.set(k, v);
  return s;
};
const ids = (s: MemorySidecar | ReturnType<typeof retainSidecar>) => [...s.entries()].map(([k]) => k).sort();
const TODAY = 20000;

describe("leftover marker checks (floating objects are verified too)", () => {
  it("includes OWBFLOAT whenever floating objects are restored", () => {
    expect(leftoverChecks({ floats: 2, equations: 0, tables: 0, blanks: false }).map((c) => c.prefix)).toEqual(["OWBFLOAT"]);
  });
  it("is empty when nothing was inserted through markers", () => {
    expect(leftoverChecks({ floats: 0, equations: 0, tables: 0, blanks: false })).toEqual([]);
  });
  it("covers every kind at once", () => {
    const p = leftoverChecks({ floats: 1, equations: 1, tables: 1, blanks: true }).map((c) => c.prefix);
    expect(p).toContain("OWBFLOAT");
    expect(p).toContain("OWBEQ");
    expect(p).toContain("OWBTBL");
    expect(p.length).toBe(4);
  });
  it("the checked float prefix matches the marker the renderer really produces", () => {
    const sidecar = sc({ aaaaaaaa: { kind: "float", html: "", ooxml: "x" } });
    const r = renderWithSidecar("before\n\n<!-- word:obj id=aaaaaaaa kind=float -->\n\nafter", sidecar);
    expect(r.floats).toHaveLength(1);
    expect(r.floats[0].marker.startsWith("OWBFLOAT")).toBe(true);
    expect(r.html).toContain(r.floats[0].marker);
  });
});

describe("retainSidecar: the sidecar belongs to the whole document", () => {
  it("keeps entries that the current selection does not reference (another region needs them)", () => {
    const s = sc({ a: entry({ t: TODAY }), b: entry({ t: TODAY }) });
    expect(ids(retainSidecar(s, new Set(["b"]), TODAY))).toEqual(["a", "b"]);
  });

  it("retains old originals because another region may still reference them", () => {
    const s = sc({
      fresh: entry({ t: TODAY - 90 }),
      old: entry({ t: TODAY - 1000 }),
    });
    expect(ids(retainSidecar(s, new Set(), TODAY))).toEqual(["fresh", "old"]);
  });

  it("keeps a long formula editable after another region is loaded 100 days later", () => {
    const latex = String.raw`\boxed{` + "x+".repeat(80) + "x}";
    const id = mathImgKey(latex, false);
    const original = entry({ kind: "mathimg", latex, display: false, png: "AAAA", w: 60, h: 24, baseline: 17, v: 1, t: TODAY - 100 });
    const s = sc({ [id]: original });
    const xml = wrapPackage(`<w:p>${mathImageRun(id, original, 1001, false)}</w:p>`);
    const html = `<p class=MsoNormal><img src="picture.png" alt="${mathImgAlt(id, latex, false)}"></p>`;
    const retained = retainSidecar(s, new Set(), TODAY);
    const md = htmlToMarkdown(html, retained, new Map(), ["AAAA"], undefined, undefined, scanOoxml(xml).items);
    expect(md).toBe(`$${latex}$`);
    expect(md).not.toContain("kind=image");
  });

  it("never drops a referenced entry, however old", () => {
    const s = sc({ ref: entry({ t: 1 }) });
    const out = retainSidecar(s, new Set(["ref"]), TODAY);
    expect(ids(out)).toEqual(["ref"]);
    expect(out.get("ref")!.t).toBe(TODAY);
  });

  it("entries without a day number (older documents) start ageing now instead of being dropped", () => {
    const out = retainSidecar(sc({ legacy: entry() }), new Set(), TODAY);
    expect(out.get("legacy")!.t).toBe(TODAY);
  });

  it("refreshes the day number of referenced entries only now and then (keeps the stored part stable)", () => {
    const s = sc({ r: entry({ t: TODAY - 2 }) });
    expect(retainSidecar(s, new Set(["r"]), TODAY).get("r")!.t).toBe(TODAY - 2);
    expect(retainSidecar(sc({ r: entry({ t: TODAY - 7 }) }), new Set(["r"]), TODAY).get("r")!.t).toBe(TODAY);
  });

  it("is idempotent: retaining twice gives the identical serialization", () => {
    const once = retainSidecar(sc({ a: entry(), b: entry({ t: TODAY - 3 }) }), new Set(["a"]), TODAY);
    expect(sidecarToXml(retainSidecar(once, new Set(["a"]), TODAY))).toBe(sidecarToXml(once));
  });

  it("retains other regions' originals even beyond the former 16 MiB cap", () => {
    const big = "x".repeat(6 * 1024 * 1024);
    const s = sc({
      keepMe: entry({ latex: big, t: 1 }),
      oldest: entry({ latex: big, t: TODAY - 30 }),
      middle: entry({ latex: big, t: TODAY - 20 }),
      newest: entry({ latex: big, t: TODAY - 10 }),
    });
    const out = retainSidecar(s, new Set(["keepMe"]), TODAY);
    expect(ids(out)).toEqual(["keepMe", "middle", "newest", "oldest"]);
  });

  it("retains originals referenced by the current selection", () => {
    const s = sc({ huge: entry({ latex: "x".repeat(5000), t: TODAY }) });
    expect(ids(retainSidecar(s, new Set(["huge"]), TODAY))).toEqual(["huge"]);
  });
});

describe("keepEquivalentEntries ignores the bookkeeping day number", () => {
  const ungz = async (s: string) => s;
  it("reuses the stored entry (and its day number) for equal non-OOXML entries", async () => {
    const prev = sc({ m: entry({ t: 123 }) });
    const next = sc({ m: entry() });
    const out = await keepEquivalentEntries(next, prev, ungz);
    expect(out.get("m")!.t).toBe(123);
  });
  it("still takes the new entry when the content differs", async () => {
    const out = await keepEquivalentEntries(sc({ m: entry({ latex: "y" }) }), sc({ m: entry({ t: 123 }) }), ungz);
    expect(out.get("m")!.latex).toBe("y");
  });
  it("OOXML entries equal up to Word's volatile ids keep the stored one", async () => {
    const a = entry({ kind: "float", latex: undefined, ooxml: '<w:p w:rsidR="00AA11">x</w:p>', t: 5 });
    const b = entry({ kind: "float", latex: undefined, ooxml: '<w:p w:rsidR="00BB22">x</w:p>' });
    const out = await keepEquivalentEntries(sc({ f: b }), sc({ f: a }), ungz);
    expect(out.get("f")).toBe(a);
  });
});
