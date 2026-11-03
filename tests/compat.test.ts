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
