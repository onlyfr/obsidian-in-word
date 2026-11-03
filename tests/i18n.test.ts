import { describe, expect, it } from "vitest";
import { createI18nextShim } from "../src/plugins/compat";
import { PluginHost } from "../src/plugins/host";

describe("i18next stand-in", () => {
  const make = () => {
    const root = createI18nextShim() as any;
    const i = root.createInstance();
    i.init({ lng: root.language, fallbackLng: "en" });
    i.addResourceBundle("en", "settings", { conceal: { enabled: { name: "Enabled", desc: "On {{what}}" } }, flat: "F" });
    return i;
  };

  it("nested keys through a fixed namespace, as plugins use it", () => {
    const t = make().getFixedT(null, "settings");
    expect(t("conceal.enabled.name")).toBe("Enabled");
    expect(t("flat")).toBe("F");
  });
  it("interpolation, ns:key, key prefix, defaultValue and unknown keys", () => {
    const i = make();
    const t = i.getFixedT(null, "settings");
    expect(t("conceal.enabled.desc", { what: "x" })).toBe("On x");
    expect(i.t("settings:conceal.enabled.name")).toBe("Enabled");
    expect(i.getFixedT(null, "settings", "conceal.enabled")("name")).toBe("Enabled");
    expect(t("nope.key")).toBe("nope.key");
    expect(t("nope", { defaultValue: "dflt" })).toBe("dflt");
    expect(i.exists("settings:flat")).toBe(true);
    expect(i.exists("settings:zzz")).toBe(false);
  });
  it("falls back to the fallback language; resources via init", async () => {
    const root = createI18nextShim() as any;
    const i = root.createInstance();
    await i.init({ lng: "ko", fallbackLng: "en", resources: { en: { translation: { hi: "Hello" } }, ko: { translation: { bye: "안녕" } } } });
    expect(i.t("bye")).toBe("안녕");
    expect(i.t("hi")).toBe("Hello");
  });
  it("instances do not share resources", () => {
    const root = createI18nextShim() as any;
    const a = root.createInstance();
    const b = root.createInstance();
    a.addResourceBundle("en", "x", { k: "A" });
    expect(b.getFixedT(null, "x")("k")).toBe("k");
  });
});

describe("Component base class", () => {
  it("load() runs onload once; children are loaded/unloaded with it", async () => {
    const host = new PluginHost();
    let log: string[] = [];
    (window as any).__log = log;
    await host.load({ id: "c", name: "c" } as any, `const o = require("obsidian");
      class Child extends o.Component { onload() { window.__log.push("child load"); } onunload() { window.__log.push("child unload"); } }
      module.exports = class extends o.Plugin { onload() {
        const c = new Child(); this.addChild(c); c.load(); c.load();
        const standalone = new o.Component(); standalone.load(); window.__log.push("standalone ok"); } };`);
    expect(log).toEqual(["child load", "standalone ok"]);
    host.unload("c");
    expect(log).toContain("child unload");
  });
});
