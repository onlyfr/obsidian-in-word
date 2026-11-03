import { describe, expect, it } from "vitest";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createSettingsApi, iconGlyph, sanitizeFragment } from "../src/plugins/settings";
import { PluginHost } from "../src/plugins/host";
import { installObsidianDom } from "../src/plugins/dom";

const mkApi = () => {
  const errors: string[] = [];
  const unsupported: string[] = [];
  const api = createSettingsApi({
    onError: (e, where) => errors.push(`${where}: ${(e as Error).message}`),
    unsupported: (n) => unsupported.push(n),
  });
  return { api, errors, unsupported };
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const root = () => document.createElement("div");

describe("Setting builder", () => {
  it("builds the Obsidian DOM structure with name/description (string and fragment)", () => {
    const { api } = mkApi();
    const el = root();
    const s = new api.Setting(el).setName("Name").setDesc("Desc").setClass("my-class").setTooltip("tip");
    expect(s.settingEl.className).toBe("setting-item my-class");
    expect(s.nameEl.textContent).toBe("Name");
    expect(s.descEl.textContent).toBe("Desc");
    expect(s.settingEl.getAttribute("title")).toBe("tip");
    expect(s.controlEl.parentElement).toBe(s.settingEl);
    const frag = document.createDocumentFragment();
    frag.append("see ", Object.assign(document.createElement("a"), { href: "https://example.com/x" }), " now");
    s.setDesc(frag);
    expect(s.descEl.textContent).toContain("see");
    expect(s.descEl.querySelector("a")!.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("setHeading / setDisabled / clear / then / components", () => {
    const { api } = mkApi();
    const s = new api.Setting(root()).setHeading().setName("H");
    expect(s.settingEl.classList.contains("setting-item-heading")).toBe(true);
    s.addToggle((t) => t.setValue(true));
    s.addButton((b) => b.setButtonText("x"));
    expect(s.components).toHaveLength(2);
    s.setDisabled(true);
    expect(s.settingEl.classList.contains("is-disabled")).toBe(true);
    expect((s.controlEl.querySelector("input") as HTMLInputElement).disabled).toBe(true);
    let seen: unknown;
    s.then((x) => (seen = x));
    expect(seen).toBe(s);
    s.clear();
    expect(s.components).toHaveLength(0);
    expect(s.controlEl.childNodes.length).toBe(0);
  });

  it("labels controls with the name and description (aria)", () => {
    const { api } = mkApi();
    const s = new api.Setting(root()).setName("N").setDesc("D").addText((t) => t.setValue("v"));
    const input = s.controlEl.querySelector("input")!;
    expect(input.getAttribute("aria-labelledby")).toBe(s.nameEl.id);
    expect(input.getAttribute("aria-describedby")).toBe(s.descEl.id);
  });

  it("toggle: getValue/setValue/onChange and the is-enabled class", () => {
    const { api } = mkApi();
    const seen: boolean[] = [];
    let comp!: InstanceType<typeof api.ToggleComponent>;
    new api.Setting(root()).addToggle((t) => {
      comp = t;
      t.setValue(false).onChange((v) => seen.push(v));
    });
    expect(comp.getValue()).toBe(false);
    comp.toggleEl.querySelector("input")!.click();
    expect(comp.getValue()).toBe(true);
    expect(comp.toggleEl.classList.contains("is-enabled")).toBe(true);
    expect(seen).toEqual([true]);
    comp.setValue(false);
    expect(comp.toggleEl.classList.contains("is-enabled")).toBe(false);
  });

  it("text, textarea and search fire onChange on input", () => {
    const { api } = mkApi();
    const seen: string[] = [];
    const s = new api.Setting(root());
    s.addText((t) => t.setPlaceholder("ph").setValue("a").onChange((v) => seen.push("t:" + v)));
    s.addTextArea((t) => t.setValue("x").onChange((v) => seen.push("a:" + v)));
    s.addSearch((t) => t.onChange((v) => seen.push("s:" + v)));
    const [text, area, search] = Array.from(s.controlEl.querySelectorAll("input,textarea")) as HTMLInputElement[];
    expect(text.placeholder).toBe("ph");
    for (const [el, v] of [[text, "b"], [area, "y"], [search, "q"]] as const) {
      el.value = v;
      el.dispatchEvent(new Event("input"));
    }
    expect(seen).toEqual(["t:b", "a:y", "s:q"]);
    expect(area.tagName).toBe("TEXTAREA");
    expect(search.type).toBe("search");
  });

  it("dropdown: addOption/addOptions/setValue/onChange", () => {
    const { api } = mkApi();
    const seen: string[] = [];
    let d!: InstanceType<typeof api.DropdownComponent>;
    new api.Setting(root()).addDropdown((c) => {
      d = c;
      c.addOption("a", "A").addOptions({ b: "B", c: "C" }).setValue("b").onChange((v) => seen.push(v));
    });
    expect(d.selectEl.options.length).toBe(3);
    expect(d.getValue()).toBe("b");
    d.selectEl.value = "c";
    d.selectEl.dispatchEvent(new Event("change"));
    expect(seen).toEqual(["c"]);
  });

  it("slider: setLimits / setValue / dynamic tooltip / onChange", () => {
    const { api } = mkApi();
    const seen: number[] = [];
    let s!: InstanceType<typeof api.SliderComponent>;
    new api.Setting(root()).addSlider((c) => {
      s = c;
      c.setLimits(0, 10, 2).setValue(4).setDynamicTooltip().onChange((v) => seen.push(v));
    });
    expect([s.sliderEl.min, s.sliderEl.max, s.sliderEl.step]).toEqual(["0", "10", "2"]);
    expect(s.getValue()).toBe(4);
    expect(s.containerEl.querySelector(".slider-value")!.textContent).toBe("4");
    s.sliderEl.value = "8";
    s.sliderEl.dispatchEvent(new Event("input"));
    expect(seen).toEqual([8]);
    expect(s.sliderEl.getAttribute("aria-valuetext")).toBe("8");
  });

  it("buttons: text, cta, warning, onClick; extra button icon + tooltip", () => {
    const { api } = mkApi();
    let clicks = 0;
    const s = new api.Setting(root());
    s.addButton((b) => b.setButtonText("Go").setCta().setWarning().setTooltip("t").onClick(() => void clicks++));
    s.addExtraButton((b) => b.setIcon("reset").setTooltip("Reset").onClick(() => void clicks++));
    const [go, extra] = Array.from(s.controlEl.querySelectorAll("button"));
    expect(go.textContent).toBe("Go");
    expect(go.className).toContain("mod-cta");
    expect(go.className).toContain("mod-warning");
    go.click();
    extra.click();
    expect(clicks).toBe(2);
    expect(extra.textContent).toBe(iconGlyph("reset"));
    expect(extra.getAttribute("aria-label")).toBe("Reset");
  });

  it("color picker, progress bar, moment format (degrades to text without moment)", () => {
    const { api } = mkApi();
    const s = new api.Setting(root());
    let color!: InstanceType<typeof api.ColorComponent>;
    s.addColorPicker((c) => (color = c.setValue("#ff0000")));
    expect(color.getValue()).toBe("#ff0000");
    s.addProgressBar((p) => p.setValue(150));
    expect((s.controlEl.querySelector("progress") as HTMLProgressElement).value).toBe(100);
    const sample = document.createElement("div");
    s.addMomentFormat((m) => m.setDefaultFormat("YYYY").setSampleEl(sample).setValue("YYYY-MM"));
    expect(sample.textContent).toContain("YYYY-MM");
  });

  it("async onChange rejections and sync throws are reported, not swallowed", async () => {
    const { api, errors } = mkApi();
    let t!: InstanceType<typeof api.TextComponent>;
    new api.Setting(root()).addText((c) => (t = c.onChange(async () => { throw new Error("async boom"); })));
    t.onChange(() => { throw new Error("sync boom"); });
    t.inputEl.dispatchEvent(new Event("input"));
    await flush();
    expect(errors.sort()).toEqual(["onChange: async boom", "onChange: sync boom"]);
    // an exception inside the add* callback itself is reported too
    new api.Setting(root()).addToggle(() => { throw new Error("cb boom"); });
    expect(errors).toContain("Setting.add*: cb boom");
  });
});

describe("degrade path", () => {
  it("unknown add* control: label-only row with a note, recorded, chain continues", () => {
    const { api, unsupported } = mkApi();
    const s = (new api.Setting(root()) as any).setName("Fancy").addFancyWidget(() => {}).setDesc("after");
    expect(s.nameEl.textContent).toBe("Fancy");
    expect(s.descEl.textContent).toBe("after");
    expect(s.controlEl.textContent).toContain("미지원 컨트롤 (addFancyWidget)");
    expect(unsupported).toEqual(["Setting.addFancyWidget"]);
  });

  it("unknown component methods are recorded and chainable", () => {
    const { api, unsupported } = mkApi();
    new api.Setting(root()).addToggle((t: any) => t.setValue(true).setSomethingNew("x").onChange(() => {}));
    expect(unsupported).toEqual(["Setting.ToggleComponent.setSomethingNew"]);
  });
});

describe("sanitization", () => {
  const html = (h: string) => {
    const d = document.createElement("div");
    d.innerHTML = h; // test input only
    return d;
  };
  const clean = (h: string) => {
    const out = document.createElement("div");
    out.append(sanitizeFragment(html(h)));
    return out;
  };

  it("drops scripts, event handlers, iframes, images and unknown attributes", () => {
    const out = clean(`<b onclick="x()">ok</b><script>window.hacked=1</script><img src=x onerror="window.hacked=2"><iframe src="javascript:1"></iframe><p style="x" id="y" class="c">t</p>`);
    expect(out.innerHTML).toBe('<b>ok</b><p class="c">t</p>');
    expect((window as any).hacked).toBeUndefined();
  });

  it("only http/https links, always rel=noopener noreferrer", () => {
    const out = clean(`<a href="javascript:alert(1)">a</a><a href="data:text/html,x">b</a><a href=" JaVaScRiPt:alert(1)">c</a><a href="https://ok.example/p?q=1" onclick="x">d</a><a href="//evil.example">e</a><a href="relative">f</a>`);
    const links = Array.from(out.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([null, null, null, "https://ok.example/p?q=1", "https://evil.example/", null]);
    for (const a of links.filter((x) => x.hasAttribute("href"))) expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(out.textContent).toBe("abcdef");
  });

  it("setName/setDesc never interpret strings as HTML", () => {
    const { api } = mkApi();
    const s = new api.Setting(root()).setName("<img src=x onerror=1>").setDesc("<script>1</script>");
    expect(s.nameEl.querySelector("img")).toBeNull();
    expect(s.descEl.querySelector("script")).toBeNull();
    expect(s.nameEl.textContent).toBe("<img src=x onerror=1>");
  });
});

// --- synthetic settings-tab "plugins" modelled on common patterns --------------------------------------------------
installObsidianDom();
const load = async (src: string, id = "syn") => {
  const host = new PluginHost();
  const store: Record<string, unknown> = {};
  (window as any).__store = store;
  const report = await host.load({ id, name: id } as any, src);
  return { host, report, tabs: host.settingTabs(id) };
};
const PRELUDE = `const o = require("obsidian");`;

describe("settings tabs of synthetic plugins", () => {
  it("toggles + dropdown + slider save through the plugin's own saveData", async () => {
    const { host, report, tabs } = await load(`${PRELUDE}
      module.exports = class extends o.Plugin {
        async onload() {
          this.settings = Object.assign({ on: false, mode: "a", n: 3 }, await this.loadData());
          this.addSettingTab(new (class extends o.PluginSettingTab {
            constructor(app, p) { super(app, p); this.p = p; }
            display() {
              const { containerEl } = this; containerEl.empty();
              new o.Setting(containerEl).setName("On").addToggle(t => t.setValue(this.p.settings.on).onChange(async v => { this.p.settings.on = v; await this.p.saveData(this.p.settings); }));
              new o.Setting(containerEl).setName("Mode").addDropdown(d => d.addOptions({a:"A", b:"B"}).setValue(this.p.settings.mode).onChange(async v => { this.p.settings.mode = v; await this.p.saveData(this.p.settings); }));
              new o.Setting(containerEl).setName("N").addSlider(s => s.setLimits(1, 9, 1).setValue(this.p.settings.n).setDynamicTooltip().onChange(async v => { this.p.settings.n = v; await this.p.saveData(this.p.settings); }));
            }
          })(this.app, this));
        }
      };`);
    expect(report.loaded).toBe(true);
    expect(report.settingsTabs).toBe(1);
    const [tab] = tabs;
    tab.display();
    (tab.containerEl.querySelector("input[type=checkbox]") as HTMLInputElement).click();
    const sel = tab.containerEl.querySelector("select") as HTMLSelectElement;
    sel.value = "b";
    sel.dispatchEvent(new Event("change"));
    const slider = tab.containerEl.querySelector("input[type=range]") as HTMLInputElement;
    slider.value = "7";
    slider.dispatchEvent(new Event("input"));
    await flush();
    // persisted through the host's data store, and visible after a fresh load
    const saved = await (host as any).store.get("syn");
    expect(saved).toEqual({ on: true, mode: "b", n: 7 });
  });

  it("dynamic re-render: display() called again from a handler replaces the rows", async () => {
    const { tabs } = await load(`${PRELUDE}
      module.exports = class extends o.Plugin {
        async onload() {
          this.adv = false;
          const plugin = this;
          this.addSettingTab(new (class extends o.PluginSettingTab {
            display() {
              this.containerEl.empty();
              new o.Setting(this.containerEl).setName("Advanced").addToggle(t => t.setValue(plugin.adv).onChange(v => { plugin.adv = v; this.display(); }));
              if (plugin.adv) new o.Setting(this.containerEl).setName("Extra option").addText(t => t.setValue("x"));
            }
          })(this.app, this));
        }
      };`);
    const [tab] = tabs;
    tab.display();
    expect(tab.containerEl.querySelectorAll(".setting-item").length).toBe(1);
    (tab.containerEl.querySelector("input[type=checkbox]") as HTMLInputElement).click();
    expect(tab.containerEl.querySelectorAll(".setting-item").length).toBe(2);
    expect(tab.containerEl.textContent).toContain("Extra option");
  });

  it("text areas, headings and button groups", async () => {
    const { tabs } = await load(`${PRELUDE}
      module.exports = class extends o.Plugin {
        async onload() {
          window.__clicks = [];
          this.addSettingTab(new (class extends o.PluginSettingTab {
            display() {
              const c = this.containerEl; c.empty();
              new o.Setting(c).setName("Section").setHeading();
              new o.Setting(c).setName("Snippets").setDesc("one per line").addTextArea(t => t.setValue("a\\nb").setPlaceholder("p").onChange(v => window.__clicks.push("area:" + v)));
              new o.Setting(c).setName("Actions").addButton(b => b.setButtonText("Save").setCta().onClick(() => window.__clicks.push("save")))
                .addExtraButton(b => b.setIcon("reset").setTooltip("Reset").onClick(() => window.__clicks.push("reset")));
            }
          })(this.app, this));
        }
      };`);
    const [tab] = tabs;
    tab.display();
    expect(tab.containerEl.querySelector(".setting-item-heading")).not.toBeNull();
    const ta = tab.containerEl.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.value).toBe("a\nb");
    ta.value = "z";
    ta.dispatchEvent(new Event("input"));
    (tab.containerEl.querySelector("button.mod-cta") as HTMLButtonElement).click();
    (tab.containerEl.querySelector("button.extra-setting-button") as HTMLButtonElement).click();
    expect((window as any).__clicks).toEqual(["area:z", "save", "reset"]);
  });

  it("raw-DOM settings (createEl/createDiv/empty) and CM6 editors inside the tab", async () => {
    const { tabs, report } = await load(`${PRELUDE}
      const { EditorView } = require("@codemirror/view"); const { EditorState } = require("@codemirror/state");
      module.exports = class extends o.Plugin {
        async onload() {
          this.addSettingTab(new (class extends o.PluginSettingTab {
            display() {
              const c = this.containerEl; c.empty();
              c.createEl("h3", { text: "Raw" });
              const row = c.createDiv({ cls: "my-row" });
              row.createEl("label", { text: "Name", attr: { for: "n" } });
              row.createEl("input", { attr: { id: "n", type: "text" } });
              const host = c.createDiv();
              window.__view = new EditorView({ state: EditorState.create({ doc: "hello" }), parent: host });
            }
          })(this.app, this));
        }
      };`);
    const [tab] = tabs;
    document.body.append(tab.containerEl);
    tab.display();
    expect(tab.containerEl.querySelector("h3")!.textContent).toBe("Raw");
    expect(tab.containerEl.querySelector(".cm-editor")).not.toBeNull();
    expect((window as any).__view.state.doc.toString()).toBe("hello");
    (window as any).__view.destroy();
    tab.containerEl.remove();
    expect(report.unsupportedApis).toEqual([]);
  });

  it("no tab / several tabs / the same tab added twice all work", async () => {
    const none = await load(`${PRELUDE} module.exports = class extends o.Plugin { onload() {} };`);
    expect(none.tabs).toEqual([]);
    expect(none.report.settingsTabs).toBe(0);
    const many = await load(`${PRELUDE}
      module.exports = class extends o.Plugin { onload() {
        const T = class extends o.PluginSettingTab { display() { new o.Setting(this.containerEl).setName(this.name || "x"); } };
        const a = new T(this.app, this); a.name = "A"; const b = new T(this.app, this); b.name = "B";
        this.addSettingTab(a); this.addSettingTab(a); this.addSettingTab(b); } };`);
    expect(many.tabs.map((t) => t.name)).toEqual(["A", "B"]);
    expect(many.report.settingsTabs).toBe(2);
  });

  it("unsupported controls degrade and are listed in the compat report; display() errors do not escape load()", async () => {
    const { tabs, report } = await load(`${PRELUDE}
      module.exports = class extends o.Plugin { onload() {
        this.addSettingTab(new (class extends o.PluginSettingTab { display() {
          new o.Setting(this.containerEl).setName("Odd").addHotkeyThing(x => x.foo());
          new o.Setting(this.containerEl).setName("Fine").addText(t => t.setValue("v").nonexistent());
        } })(this.app, this)); } };`);
    tabs[0].display();
    expect(tabs[0].containerEl.textContent).toContain("미지원 컨트롤 (addHotkeyThing)");
    expect(tabs[0].containerEl.querySelectorAll("input").length).toBe(1);
    expect(report.unsupportedApis).toEqual(expect.arrayContaining(["Setting.addHotkeyThing", "Setting.TextComponent.nonexistent"]));
  });

  it("handler failures end up in the compat report warnings and notify", async () => {
    const notes: string[] = [];
    const host = new PluginHost(undefined, (m) => notes.push(m));
    const report = await host.load({ id: "e", name: "e" } as any, `${PRELUDE}
      module.exports = class extends o.Plugin { onload() { this.addSettingTab(new (class extends o.PluginSettingTab { display() {
        new o.Setting(this.containerEl).addToggle(t => t.onChange(async () => { throw new Error("save failed"); })); } })(this.app, this)); } };`);
    const [tab] = host.settingTabs("e");
    tab.display();
    tab.containerEl.querySelector("input")!.click();
    await flush();
    expect(report.warnings).toEqual(["onChange: save failed"]);
    expect(notes).toEqual(["onChange: save failed"]);
  });

  it("app.setting.openTabById asks the task pane to open the plugin's settings", async () => {
    const host = new PluginHost();
    const opened: string[] = [];
    host.onOpenSettings = (id) => opened.push(id);
    await host.load({ id: "o", name: "o" } as any, `${PRELUDE} module.exports = class extends o.Plugin { onload() { this.app.setting.openTabById("o"); } };`);
    expect(opened).toEqual(["o"]);
  });

  it("unloading a plugin forgets its tabs", async () => {
    const { host, tabs } = await load(`${PRELUDE} module.exports = class extends o.Plugin { onload() { this.addSettingTab(new o.PluginSettingTab(this.app, this)); } };`);
    expect(tabs).toHaveLength(1);
    host.unload("syn");
    expect(host.settingTabs("syn")).toEqual([]);
  });
});

void Compartment; void EditorState; void EditorView;
