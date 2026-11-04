import { describe, expect, it } from "vitest";
import { MemorySidecar, keepEquivalentEntries, normalizeOoxml, sidecarToXml, type SidecarEntry } from "../src/convert/sidecar";

const tbl = (rsid: string, para: string, text = "a") =>
  `<w:tbl><w:tr w:rsidR="${rsid}" w14:paraId="${para}"><w:tc><w:p w14:paraId="${para}" w14:textId="77777777" w:rsidR="${rsid}" w:rsidRDefault="${rsid}"><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
// stand-in for gunzip: "gz:<xml>" values are expanded by dropping the prefix
const ungz = async (s: string) => (s.startsWith("gz:") ? s.slice(3) : s);
const sc = (entries: Record<string, SidecarEntry>) => {
  const m = new MemorySidecar();
  for (const [k, v] of Object.entries(entries)) m.set(k, v);
  return m;
};

describe("normalizeOoxml", () => {
  it("drops only revision/paragraph ids", () => {
    expect(normalizeOoxml(tbl("0035144D", "0D1C118E"))).toBe(normalizeOoxml(tbl("00906418", "AAAAAAAA")));
    expect(normalizeOoxml(tbl("0035144D", "0D1C118E", "a"))).not.toBe(normalizeOoxml(tbl("0035144D", "0D1C118E", "b")));
    expect(normalizeOoxml('<w:p w:rsidR="1" w:val="x"/>')).toBe('<w:p w:val="x"/>');
    // the settings part of a package lists every rsid as an element
    expect(normalizeOoxml('<w:rsids><w:rsidRoot w:val="00A"/><w:rsid w:val="00B"/><w:rsid w:val="00C"/></w:rsids>')).toBe("<w:rsids></w:rsids>");
    expect(normalizeOoxml('<w:rsids><w:rsid w:val="00B"/></w:rsids>')).toBe(normalizeOoxml('<w:rsids><w:rsid w:val="00X"/><w:rsid w:val="00Y"/></w:rsids>'));
  });
});

describe("keepEquivalentEntries (an unchanged document keeps an unchanged sidecar)", () => {
  const stored = sc({ t1: { kind: "table", html: "", ooxml: "gz:" + tbl("0035144D", "0D1C118E"), md: "| a |" } });

  it("same table with fresh rsids/paraIds -> the stored entry, so the XML is identical", async () => {
    const fresh = sc({ t1: { kind: "table", html: "", ooxml: "gz:" + tbl("00906418", "FFFFFFFF"), md: "| a |" } });
    const out = await keepEquivalentEntries(fresh, stored, ungz);
    expect(out.get("t1")).toBe(stored.get("t1"));
    expect(sidecarToXml(out)).toBe(sidecarToXml(stored));
  });

  it("changed content is NOT hidden by the normalization", async () => {
    const fresh = sc({ t1: { kind: "table", html: "", ooxml: "gz:" + tbl("00906418", "FFFFFFFF", "CHANGED"), md: "| a |" } });
    const out = await keepEquivalentEntries(fresh, stored, ungz);
    expect(out.get("t1")).toBe(fresh.get("t1"));
    expect(sidecarToXml(out)).not.toBe(sidecarToXml(stored));
  });

  it("other fields that differ (markdown, rels, kind) win", async () => {
    const o = "gz:" + tbl("00906418", "FFFFFFFF");
    for (const e of [
      { kind: "table", html: "", ooxml: o, md: "| b |" },
      { kind: "table", html: "", ooxml: o, md: "| a |", rels: "<Relationship/>" },
      { kind: "float", html: "", ooxml: o, md: "| a |" },
    ] as SidecarEntry[]) {
      const out = await keepEquivalentEntries(sc({ t1: e }), stored, ungz);
      expect(out.get("t1"), JSON.stringify(e)).toBe(e);
    }
  });

  it("new ids, entries without OOXML and order are left alone", async () => {
    const fresh = sc({
      m1: { kind: "math", html: "", latex: "x", omml: "<m:oMath/>" },
      t1: { kind: "table", html: "", ooxml: "gz:" + tbl("00906418", "FFFFFFFF"), md: "| a |" },
      n1: { kind: "image", html: "<img>" },
    });
    const prev = sc({ m1: { kind: "math", html: "", latex: "x", omml: "<m:oMath/>" }, t1: stored.get("t1")! });
    const out = await keepEquivalentEntries(fresh, prev, ungz);
    expect([...out.entries()].map(([k]) => k)).toEqual(["m1", "t1", "n1"]);
    expect(out.get("m1")).toBe(fresh.get("m1"));
    expect(out.get("t1")).toBe(stored.get("t1"));
    expect(out.get("n1")).toBe(fresh.get("n1"));
  });

  it("works on large OOXML (a floating-object paragraph package)", async () => {
    const big = (r: string) => `<pkg>${"<w:p w:rsidR=\"" + r + "\"><w:r><w:t>x</w:t></w:r></w:p>".repeat(3000)}</pkg>`;
    const prev = sc({ f: { kind: "float", html: "<img>", ooxml: "gz:" + big("00A97435") } });
    const fresh = sc({ f: { kind: "float", html: "<img>", ooxml: "gz:" + big("00EB09E6") } });
    expect((await keepEquivalentEntries(fresh, prev, ungz)).get("f")).toBe(prev.get("f"));
  });
});
