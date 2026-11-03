import type { Compartment } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { ObsidianEditor } from "../plugins/editor";
import { MarkdownView, PluginHost, type CompatReport, type PluginManifest, type SettingTabLike } from "../plugins/host";
import { askConfirm } from "./confirm";
import { LocalDataStore, PluginLibrary, type StoredPlugin } from "../plugins/storage";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", cls = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.textContent = text; // never innerHTML: manifest/plugin text is untrusted
  if (cls) e.className = cls;
  return e;
}

/** Wire the Obsidian plugin host to the task pane: file loading, list, commands, hotkeys. */
export async function initPlugins(view: EditorView, compartment: Compartment, setStatus: (m: string) => void): Promise<PluginHost> {
  const library = new PluginLibrary();
  const host = new PluginHost(new LocalDataStore(), (m) => setStatus(m));
  host.activeView = new MarkdownView(new ObsidianEditor(view));

  const list = $("plugin-list");
  const select = $<HTMLSelectElement>("plugin-commands");
  let plugins: StoredPlugin[] = [];

  // --- settings panel (PluginSettingTab) -------------------------------------------------------------------------
  const panel = $("plugin-settings");
  const main = $("plugin-main");
  let open: { id: string; tab: SettingTabLike } | null = null;

  const closeSettings = (focusId?: string) => {
    if (!open) return;
    const { id, tab } = open;
    open = null;
    try {
      tab.hide();
    } catch (e) {
      const r = host.reports.get(id);
      if (r) host.reportError(r, e, "hide()");
    }
    tab.containerEl.remove();
    panel.replaceChildren();
    panel.hidden = true;
    main.hidden = false;
    if (focusId) document.getElementById(focusId)?.focus();
  };

  const openSettings = (id: string, index = 0) => {
    const tabs = host.settingTabs(id);
    const tab = tabs[index];
    if (!tab) return;
    if (open) closeSettings();
    open = { id, tab };
    const manifest = plugins.find((p) => p.manifest.id === id)?.manifest;
    const bar = el("div", "", "settings-bar");
    const back = el("button", "← 목록");
    back.id = "settings-back";
    back.onclick = () => closeSettings(`plugin-settings-btn-${id}`);
    const title = el("strong", `${manifest?.name ?? id} 설정`);
    title.setAttribute("role", "heading");
    bar.append(back, title);
    if (tabs.length > 1) {
      const sel = el("select");
      sel.setAttribute("aria-label", "설정 탭");
      tabs.forEach((t, i) => sel.append(Object.assign(document.createElement("option"), { value: String(i), textContent: t.name || `탭 ${i + 1}` })));
      sel.value = String(index);
      sel.onchange = () => openSettings(id, Number(sel.value));
      bar.append(sel);
    }
    const body = el("div", "", "settings-body");
    body.append(tab.containerEl);
    panel.replaceChildren(bar, body);
    main.hidden = true;
    panel.hidden = false;
    try {
      tab.display();
    } catch (e) {
      body.append(el("div", `설정 화면을 그릴 수 없습니다: ${(e as Error)?.message ?? e}`, "setting-error"));
      const r = host.reports.get(id);
      if (r) host.reportError(r, e, "display()");
    }
    back.focus();
  };
  host.onOpenSettings = (id) => {
    const i = plugins.findIndex((p) => p.manifest.id === id && p.enabled);
    if (i >= 0) {
      ($("plugins") as HTMLDetailsElement).open = true;
      openSettings(id);
    }
  };

  const reconfigure = () => {
    const bindings = host.hotkeys().map((h) => ({ key: h.key, run: () => host.runCommand(h.commandId) }));
    view.dispatch({ effects: compartment.reconfigure([...host.stateFields(), ...host.extensions(), keymap.of(bindings)]) });
  };

  const renderReport = (r: CompatReport | undefined, enabled: boolean): HTMLElement => {
    const box = el("div", "", "plugin-report");
    if (!enabled) {
      box.append(el("div", "꺼짐"));
      return box;
    }
    if (!r) return box;
    box.append(el("div", r.loaded ? `✓ 로드됨 (확장 ${r.editorExtensions}, 명령 ${r.commands})` : `✗ 실패: ${r.error ?? "알 수 없음"}`));
    if (r.unsupportedModules.length) box.append(el("div", `미지원 모듈: ${r.unsupportedModules.join(", ")}`));
    for (const w of r.warnings ?? []) box.append(el("div", `⚠ ${w}`));
    if (r.unsupportedApis.length) box.append(el("div", `미지원 API: ${r.unsupportedApis.slice(0, 12).join(", ")}${r.unsupportedApis.length > 12 ? " …" : ""}`));
    return box;
  };

  const render = () => {
    list.replaceChildren(
      ...plugins.map((p) => {
        const row = el("div", "", "plugin-row");
        const head = el("div", `${p.manifest.name} ${p.manifest.version ?? ""}`, "plugin-name");
        const toggle = el("button", p.enabled ? "끄기" : "켜기");
        toggle.onclick = async () => {
          p.enabled = !p.enabled;
          if (open?.id === p.manifest.id) closeSettings();
          await library.save(p);
          p.enabled ? await host.load(p.manifest, p.mainJs, p.stylesCss) : host.unload(p.manifest.id);
          render();
        };
        const del = el("button", "삭제");
        del.onclick = async () => {
          if (open?.id === p.manifest.id) closeSettings();
          host.unload(p.manifest.id);
          await library.remove(p.manifest.id);
          plugins = plugins.filter((x) => x !== p);
          render();
        };
        head.append(toggle, del);
        if (p.enabled && host.settingTabs(p.manifest.id).length) {
          const set = el("button", "설정");
          set.id = `plugin-settings-btn-${p.manifest.id}`;
          set.onclick = () => openSettings(p.manifest.id);
          head.prepend(set);
        }
        row.append(head, renderReport(host.reports.get(p.manifest.id), p.enabled));
        return row;
      }),
    );
    select.replaceChildren(...host.commands().map((c) => Object.assign(document.createElement("option"), { value: c.id, textContent: c.name })));
  };

  host.onChange = () => {
    if (open && !host.settingTabs(open.id).includes(open.tab)) closeSettings();
    reconfigure();
    render();
  };

  $("plugin-run").onclick = () => {
    if (!select.value) return;
    if (!host.runCommand(select.value)) setStatus("명령을 실행할 수 없습니다 (조건 불충족 또는 오류).");
  };

  $<HTMLInputElement>("plugin-files").onchange = async (ev) => {
    const files = Array.from((ev.target as HTMLInputElement).files ?? []);
    const text = (name: string) => files.find((f) => f.name === name)?.text();
    try {
      const manifestText = await text("manifest.json");
      const mainJs = await text("main.js");
      if (!manifestText || !mainJs) throw new Error("manifest.json 과 main.js 를 함께 선택하세요 (styles.css 는 선택).");
      const manifest = JSON.parse(manifestText) as PluginManifest;
      if (!manifest.id) throw new Error("manifest.json 에 id 가 없습니다.");
      if (!(await askConfirm($("plugins"), `"${manifest.name}" 플러그인의 코드를 이 작업창에서 그대로 실행합니다. 신뢰하는 플러그인만 불러오세요. 계속할까요?`))) return;
      const stored: StoredPlugin = { manifest, mainJs, stylesCss: await text("styles.css"), enabled: true };
      await library.save(stored);
      plugins = [...plugins.filter((p) => p.manifest.id !== manifest.id), stored];
      await host.load(manifest, mainJs, stored.stylesCss);
      render();
    } catch (e) {
      setStatus(`플러그인 불러오기 실패: ${(e as Error).message}`);
    } finally {
      (ev.target as HTMLInputElement).value = "";
    }
  };

  plugins = await library.list();
  for (const p of plugins.filter((x) => x.enabled)) await host.load(p.manifest, p.mainJs, p.stylesCss);
  render();
  return host;
}
