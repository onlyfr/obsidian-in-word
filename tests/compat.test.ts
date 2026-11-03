import { describe, expect, it } from "vitest";
import { createI18nextShim, requireApiVersion } from "../src/plugins/compat";
import { PluginHost } from "../src/plugins/host";

describe("requireApiVersion", () => {
  it("compares dotted versions", () => {
    expect(requireApiVersion("1.4.10", "1.8.0")).toBe(true);
    expect(requireApiVersion("1.13.0", "1.8.0")).toBe(false);
    expect(requireApiVersion("1.8.0", "1.8.0")).toBe(true);
    expect(requireApiVersion("1.8", "1.8.1")).toBe(true);
  });
});

describe("i18next shim", () => {
  it("supports createInstance/init/getFixedT as plugins use them", async () => {
    const i = createI18nextShim() as any;
    const inst = i.createInstance();
    await inst.init({ lng: i.language, fallbackLng: "en" });
    const t = inst.getFixedT(null, "settings");
    expect(t("a.b")).toBe("a.b");
    expect(t("a.b", { defaultValue: "x" })).toBe("x");
  });
});

describe("plugin using window.i18next and requireApiVersion", () => {
  it("loads", async () => {
    const src = `const o = require("obsidian"); const i = window.i18next.createInstance(); i.init({lng: window.i18next.language});
      module.exports = class extends o.Plugin { async onload() { this.addCommand({id:"x", name: i.getFixedT(null,"s")("n") + (o.requireApiVersion("1.4.10") ? "!" : "?"), callback(){}}); } };`;
    const host = new PluginHost();
    const r = await host.load({ id: "t", name: "T" } as any, src);
    expect(r.loaded).toBe(true);
    expect(r.unsupportedApis).toEqual([]);
    expect(host.commands()[0].name).toBe("n!");
  });
});

describe("Obsidian globals", () => {
  it("activeDocument / activeWindow exist for plugins", async () => {
    const host = new PluginHost();
    const r = await host.load({ id: "g", name: "G" } as any, `module.exports = class extends require("obsidian").Plugin { onload() { if (activeDocument !== document || activeWindow !== window) throw new Error("bad"); } };`);
    expect(r.error).toBeUndefined();
    expect(r.loaded).toBe(true);
  });
});

describe("prototype extensions", () => {
  it("String#contains / Array#contains exist after loading a plugin, and are not enumerable", async () => {
    const host = new PluginHost();
    await host.load({ id: "p", name: "P" } as any, `module.exports = class extends require("obsidian").Plugin { onload() {} };`);
    expect(("abc" as any).contains("b")).toBe(true);
    expect(([1, 2] as any).contains(2)).toBe(true);
    expect(([1, 2, 3] as any).last()).toBe(3);
    expect(Object.keys([1])).toEqual(["0"]);
  });
});

describe("Obsidian DOM helpers and state fields", () => {
  it("createEl / createDiv / empty / addClass work as in Obsidian", async () => {
    const host = new PluginHost();
    await host.load({ id: "d", name: "D" } as any, `module.exports = class extends require("obsidian").Plugin { onload() {} };`);
    const div = (globalThis as any).createDiv({ cls: "a b", text: "hi", attr: { "data-x": "1" } });
    expect(div.className).toBe("a b");
    expect(div.textContent).toBe("hi");
    expect(div.getAttribute("data-x")).toBe("1");
    const span = (div as any).createSpan("c");
    expect(span.parentElement).toBe(div);
    (div as any).addClass("z");
    expect((div as any).hasClass("z")).toBe(true);
    (div as any).empty();
    expect(div.childNodes.length).toBe(0);
    expect((globalThis as any).createEl("button", { text: "x" }).tagName).toBe("BUTTON");
  });

  it("editorLivePreviewField / editorInfoField are real state fields provided by the host", async () => {
    const { EditorState } = await import("@codemirror/state");
    const host = new PluginHost();
    const src = `const o = require("obsidian"); module.exports = class extends o.Plugin { onload() {
      this.registerEditorExtension([]); window.__f = [o.editorLivePreviewField, o.editorInfoField]; } };`;
    const r = await host.load({ id: "f", name: "F" } as any, src);
    expect(r.loaded).toBe(true);
    const [live, info] = (window as any).__f;
    const st = EditorState.create({ doc: "x", extensions: [...host.stateFields(), ...host.extensions()] });
    expect(st.field(live)).toBe(false);
    expect((st.field(info) as any).file).toBeNull();
  });
});

describe("win/doc and math rendering fallbacks", () => {
  it("node.win is the window; renderMath returns an element with the source", async () => {
    const host = new PluginHost();
    let out: any;
    (window as any).__out = (v: unknown) => (out = v);
    await host.load({ id: "w", name: "W" } as any, `const o = require("obsidian"); module.exports = class extends o.Plugin { async onload() {
      await o.loadMathJax(); const el = o.renderMath("x^2", false); window.__out({ win: document.body.win === window, text: el.textContent, q: !!el.querySelector }); } };`);
    expect(out).toEqual({ win: true, text: "x^2", q: true });
    const r = host.reports.get("w")!;
    expect(r.unsupportedApis).toEqual([]);
  });
});
