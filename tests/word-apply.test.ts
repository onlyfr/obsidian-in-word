import { afterEach, expect, it, vi } from "vitest";

/** Minimal Office queue: actions before a failing sync action stay executed; the remaining queue is discarded.
 * This deliberately does not model Word layout or OOXML insertion, which still need host acceptance tests.
 */
function host(fail?: "equation" | "style" | "select") {
  let pending: (() => void)[] = [];
  const calls: string[] = [];
  const executed: string[] = [];
  const enqueue = (name: string, action = () => {}) => {
    calls.push(name);
    pending.push(() => {
      if (name === fail) throw new Error(`injected ${name} failure`);
      executed.push(name);
      action();
    });
  };
  const boundary = { isNullObject: true, load() {}, untrack: vi.fn() };
  const range = {
    compareLocationWith: () => ({ value: "Equal" }),
    expandTo: () => ({ select: () => enqueue("select") }),
  };
  const paragraph = (text: string) => {
    let live = text;
    return {
      text,
      get live() { return live; },
      set style(_value: string) { enqueue("style"); },
      getRange: () => range,
      getPreviousOrNullObject: () => boundary,
      getNextOrNullObject: () => boundary,
      getPrevious: () => ({ delete: () => enqueue("delete") }),
      clear: () => enqueue("clear", () => { live = ""; }),
      insertOoxml: (_xml: string, _where: string) => enqueue(text.startsWith("OWBEQ") ? "equation" : "object", () => { live = ""; }),
    };
  };
  let items = [paragraph("original")];
  const paragraphs = {
    get items() { return items; },
    load() {}, getFirst: () => items[0], getLast: () => items[items.length - 1],
  };
  const insertHtml = vi.fn((html: string) => {
    enqueue("html");
    const doc = new DOMParser().parseFromString(html, "text/html");
    items = [...doc.querySelectorAll("p")].map((p) => paragraph(p.textContent ?? ""));
    return {
      paragraphs,
      select: () => enqueue("select"),
      search: () => ({ items: [], load() {} }),
    };
  });
  const selection = {
    isEmpty: false, load() {}, paragraphs,
    getHtml: () => ({ value: "<p>original</p>" }),
    getOoxml: () => ({ value: "<w:body/>" }),
    getRange: () => range, insertHtml,
  };
  const addPart = vi.fn();
  const context = {
    sync: async () => {
      const actions = pending;
      pending = [];
      for (const action of actions) action();
    },
    trackedObjects: { add() {} },
    document: {
      getSelection: () => selection,
      body: {
        getRange: () => range, paragraphs,
        search: (prefix: string) => ({ items: items.filter((p) => p.live.includes(prefix)), load() {} }),
      },
      customXmlParts: { getByNamespace: () => ({ items: [], load() {} }), add: addPart },
    },
  };
  (globalThis as any).Word = { run: (cb: any) => cb(context), InsertLocation: { replace: "Replace" } };
  return { calls, executed, insertHtml, addPart, boundary };
}

afterEach(() => { delete (globalThis as any).Word; });

async function apply(markdown: string) {
  vi.resetModules();
  const { replaceSelectionWithMarkdown } = await import("../src/taskpane/word");
  return replaceSelectionWithMarkdown(markdown);
}

it.each(["image", "float", "table", "equation", "field"])("rejects a missing %s original before changing the document", async (kind) => {
  const h = host();
  await expect(apply(`before\n\n<!-- word:obj id=aaaaaaaa kind=${kind} -->\n\nafter`)).rejects.toThrow("복원할 수 없는 Word 객체");
  expect(h.calls).toEqual([]);
  expect(h.insertHtml).not.toHaveBeenCalled();
  expect(h.addPart).not.toHaveBeenCalled();
});

const TABLE = "| a | b |\n| --- | --- |\n| c | d |";
const MIXED = `${TABLE}\n\nafter table\n\n$$\nx^2\n$$\n\nend`;

it("does not repeat a table insertion or paragraph deletion after a later equation fails", async () => {
  const h = host("equation");
  await expect(apply(MIXED)).rejects.toThrow("Ctrl+Z");
  expect(h.calls.filter((x) => x === "object")).toHaveLength(1);
  expect(h.executed.filter((x) => x === "object")).toHaveLength(1);
  expect(h.executed.filter((x) => x === "delete")).toHaveLength(1);
  expect(h.calls.filter((x) => x === "equation")).toHaveLength(1);
  expect(h.addPart).not.toHaveBeenCalled();
  expect(h.boundary.untrack).toHaveBeenCalledTimes(2);
});

it("does not repeat objects when selecting the restored region fails", async () => {
  const h = host("select");
  await expect(apply(MIXED)).rejects.toThrow("Ctrl+Z");
  expect(h.executed.filter((x) => x === "object")).toHaveLength(1);
  expect(h.executed.filter((x) => x === "equation")).toHaveLength(1);
  expect(h.calls.filter((x) => x === "select")).toHaveLength(1);
});

it("restores objects once and reports an optional style failure as a warning", async () => {
  const h = host("style");
  const result = await apply(`${TABLE}\n\n<!-- word:style class=a3 name=UnknownStyle -->\nstyled text`);
  expect(h.executed.filter((x) => x === "object")).toHaveLength(1);
  expect(h.calls.filter((x) => x === "style")).toHaveLength(1);
  expect(result.notes.some((n) => n.includes("스타일"))).toBe(true);
});

it("restores a mixed document's objects and blanks once on the normal path", async () => {
  const h = host();
  const result = await apply(`${MIXED}\n\n<!-- word:blank -->`);
  expect(result.missing).toEqual([]);
  expect(h.executed.filter((x) => x === "object")).toHaveLength(1);
  expect(h.executed.filter((x) => x === "equation")).toHaveLength(1);
  expect(h.executed.filter((x) => x === "clear")).toHaveLength(1);
  expect(h.executed.filter((x) => x === "select")).toHaveLength(1);
  expect(h.boundary.untrack).toHaveBeenCalledTimes(2);
});
