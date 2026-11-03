import { mathRenderer } from "./math";
import { installObsidianDom } from "./dom";
import { createI18nextShim, installPrototypeExtensions, requireApiVersion } from "./compat";
import * as autocomplete from "@codemirror/autocomplete";
import * as commands from "@codemirror/commands";
import * as language from "@codemirror/language";
import * as lint from "@codemirror/lint";
import * as search from "@codemirror/search";
import * as state from "@codemirror/state";
import * as view from "@codemirror/view";
import * as lezerCommon from "@lezer/common";
import * as lezerHighlight from "@lezer/highlight";
import * as lezerLr from "@lezer/lr";
import { StateField, type Extension } from "@codemirror/state";

export interface PluginManifest {
  id: string;
  name: string;
  version?: string;
  [key: string]: unknown;
}

/** What a loaded plugin used that we do not support (so you can see why a plugin misbehaves). */
export interface CompatReport {
  id: string;
  loaded: boolean;
  error?: string;
  unsupportedApis: string[];
  unsupportedModules: string[];
  editorExtensions: number;
  commands: number;
  /** Non-fatal degradations (e.g. math rendering fell back to plain text). */
  warnings: string[];
}

export interface PluginCommand {
  id: string;
  name: string;
  callback?: () => void;
  editorCallback?: (editor: unknown, view: unknown) => void;
  editorCheckCallback?: (checking: boolean, editor: unknown, view: unknown) => boolean | void;
  hotkeys?: { modifiers: string[]; key: string }[];
}

/** Persistence for plugin data.json (settings). */
export interface DataStore {
  get(pluginId: string): unknown;
  set(pluginId: string, data: unknown): void;
}

/** Stand-in for Obsidian's MarkdownView: the single editor of the task pane. */
export class MarkdownView {
  file = null;
  constructor(public editor: unknown) {}
  getViewType() {
    return "markdown";
  }
  getMode() {
    return "source";
  }
}

export class MemoryDataStore implements DataStore {
  private m = new Map<string, unknown>();
  get(id: string) {
    return this.m.get(id);
  }
  set(id: string, data: unknown) {
    this.m.set(id, data);
  }
}

/** Any property we do not implement returns a callable no-op and is recorded. */
function noop(onUse: (name: string) => void, name: string): any {
  const fn = function () {};
  return new Proxy(fn, {
    get: (_t, key) => {
      if (key === "then" || typeof key === "symbol") return key === Symbol.toPrimitive ? () => "" : undefined;
      onUse(`${name}.${String(key)}`);
      return noop(onUse, `${name}.${String(key)}`);
    },
    apply: () => undefined,
    construct: () => noop(onUse, name),
  });
}

/**
 * Obsidian's `debounce(cb, timeout = 0, resetTimer = false)`: returns a Debouncer with `cancel()` and `run()`.
 * With `resetTimer` every call restarts the wait; otherwise the first call in a window schedules it.
 */
export function debounce<A extends any[]>(cb: (...args: A) => unknown, timeout = 0, resetTimer = false) {
  let handle: ReturnType<typeof setTimeout> | undefined;
  let last: A | undefined;
  const fire = () => {
    handle = undefined;
    const args = last!;
    last = undefined;
    return cb(...args);
  };
  const debouncer = ((...args: A) => {
    last = args;
    if (handle !== undefined && resetTimer) {
      clearTimeout(handle);
      handle = undefined;
    }
    handle ??= setTimeout(fire, timeout);
    return debouncer;
  }) as ((...args: A) => unknown) & { cancel(): unknown; run(): unknown };
  debouncer.cancel = () => {
    if (handle !== undefined) clearTimeout(handle);
    handle = undefined;
    last = undefined;
    return debouncer;
  };
  debouncer.run = () => {
    if (handle === undefined) return;
    clearTimeout(handle);
    return fire();
  };
  return debouncer;
}

export const MATH_FALLBACK_WARNING = "수식 렌더러(Temml)를 불러오지 못해 LaTeX 소스를 텍스트로 표시합니다";

const EXTERNALS: Record<string, unknown> = {
  "@codemirror/autocomplete": autocomplete,
  "@codemirror/commands": commands,
  "@codemirror/language": language,
  "@codemirror/lint": lint,
  "@codemirror/search": search,
  "@codemirror/state": state,
  "@codemirror/view": view,
  "@lezer/common": lezerCommon,
  "@lezer/highlight": lezerHighlight,
  "@lezer/lr": lezerLr,
};

export class PluginHost {
  readonly reports = new Map<string, CompatReport>();
  private readonly extensionsById = new Map<string, Extension[]>();
  private readonly commandsById = new Map<string, PluginCommand[]>();
  private readonly instances = new Map<string, { unload(): void }>();
  onChange: () => void = () => {};
  /** The view that `workspace.getActiveViewOfType(MarkdownView)` returns (set by the task pane). */
  activeView: MarkdownView | null = null;

  constructor(
    private readonly store: DataStore = new MemoryDataStore(),
    private readonly notify: (message: string) => void = () => {},
  ) {}

  /** All editor extensions registered by loaded plugins, to feed a CM6 Compartment. */
  /**
   * Obsidian-provided state fields plugins read through `obsidian.editorLivePreviewField` / `editorInfoField`.
   * Source mode (no live preview); the info object points at the task pane editor and has no file.
   */
  readonly livePreviewField = StateField.define<boolean>({ create: () => false, update: (v) => v });
  readonly infoField = StateField.define<unknown>({
    create: () => ({ app: undefined, file: null, editor: this.activeView?.editor ?? null, view: this.activeView, hoverPopover: null }),
    update: (v) => v,
  });

  /** The two Obsidian state fields; must be part of the same editor state as the plugins' extensions. */
  stateFields(): Extension[] {
    return this.extensionsById.size ? [this.livePreviewField, this.infoField] : [];
  }

  extensions(): Extension[] {
    return [...this.extensionsById.values()].flat();
  }

  commands(): PluginCommand[] {
    return [...this.commandsById.values()].flat();
  }

  /** Run a command by id. Returns false if it does not exist or its check callback declines. */
  runCommand(id: string): boolean {
    const cmd = this.commands().find((c) => c.id === id);
    if (!cmd) return false;
    const editor = this.activeView?.editor;
    try {
      if (cmd.editorCheckCallback) {
        if (!editor || cmd.editorCheckCallback(true, editor, this.activeView) === false) return false;
        cmd.editorCheckCallback(false, editor, this.activeView);
        return true;
      }
      if (cmd.editorCallback) {
        if (!editor) return false;
        cmd.editorCallback(editor, this.activeView);
        return true;
      }
      if (cmd.callback) {
        cmd.callback();
        return true;
      }
    } catch (e) {
      this.notify(`${cmd.name}: ${(e as Error).message}`);
    }
    return false;
  }

  /** Hotkeys declared by commands, as CodeMirror key strings (Mod = Ctrl/Cmd). */
  hotkeys(): { key: string; commandId: string }[] {
    const norm: Record<string, string> = { Mod: "Mod", Ctrl: "Ctrl", Meta: "Meta", Shift: "Shift", Alt: "Alt" };
    return this.commands().flatMap((c) =>
      (c.hotkeys ?? []).map((h) => ({
        key: [...h.modifiers.map((m) => norm[m] ?? m), h.key.length === 1 ? h.key.toLowerCase() : h.key].join("-"),
        commandId: c.id,
      })),
    );
  }

  private makeObsidian(report: CompatReport, manifest: PluginManifest) {
    const use = (n: string) => {
      if (!report.unsupportedApis.includes(n)) report.unsupportedApis.push(n);
    };
    const host = this;

    class Component {
      private cleanups: (() => void)[] = [];
      onload(): void | Promise<void> {}
      onunload(): void {}
      register(cb: () => void) {
        this.cleanups.push(cb);
      }
      registerEvent(_ref: unknown) {}
      registerDomEvent(el: EventTarget, type: string, cb: any, opts?: any) {
        el.addEventListener(type, cb, opts);
        this.cleanups.push(() => el.removeEventListener(type, cb, opts));
      }
      registerInterval(id: number) {
        this.cleanups.push(() => clearInterval(id));
        return id;
      }
      unload() {
        for (const c of this.cleanups.splice(0).reverse()) c();
        this.onunload();
      }
    }

    class Plugin extends Component {
      app: unknown;
      manifest: PluginManifest;
      constructor(app: unknown, m: PluginManifest) {
        super();
        this.app = app;
        this.manifest = m;
      }
      async loadData() {
        return host.store.get(manifest.id) ?? null;
      }
      async saveData(data: unknown) {
        host.store.set(manifest.id, data);
      }
      registerEditorExtension(ext: Extension) {
        host.extensionsById.get(manifest.id)!.push(ext);
        report.editorExtensions++;
        host.onChange();
      }
      addCommand(cmd: PluginCommand) {
        host.commandsById.get(manifest.id)!.push({ ...cmd, id: `${manifest.id}:${cmd.id}` });
        report.commands++;
        return cmd;
      }
      addSettingTab() {}
      addRibbonIcon() {
        return document.createElement("div");
      }
      addStatusBarItem() {
        return document.createElement("div");
      }
      registerMarkdownPostProcessor() {
        use("Plugin.registerMarkdownPostProcessor");
      }
      registerMarkdownCodeBlockProcessor() {
        use("Plugin.registerMarkdownCodeBlockProcessor");
      }
      registerView() {
        use("Plugin.registerView");
      }
      registerObsidianProtocolHandler() {
        use("Plugin.registerObsidianProtocolHandler");
      }
    }

    class Notice {
      constructor(message: string) {
        host.notify(String(message));
      }
      setMessage() {}
      hide() {}
    }

    // Minimal, single-document stand-in for Obsidian's App.
    const app = noop(use, "app");
    const appShim = new Proxy(
      {
        workspace: new Proxy(
          {
            on: () => ({}),
            off: () => {},
            onLayoutReady: (cb: () => void) => cb(),
            getActiveViewOfType: (type: unknown) =>
              host.activeView && typeof type === "function" && host.activeView instanceof (type as any) ? host.activeView : null,
            get activeEditor() {
              return host.activeView ? { editor: host.activeView.editor, file: null } : null;
            },
            getActiveFile: () => null,
            trigger: () => {},
            // Plugins call this after changing their editor extensions; re-read them from the host.
            updateOptions: () => host.onChange(),
          } as Record<string, unknown>,
          { get: (t, k) => (k in t ? t[k as string] : (use(`app.workspace.${String(k)}`), undefined)) },
        ),
        vault: new Proxy(
          { on: () => ({}), getAbstractFileByPath: () => null, getMarkdownFiles: () => [], config: {}, adapter: noop(use, "app.vault.adapter") } as Record<string, unknown>,
          { get: (t, k) => (k in t ? t[k as string] : (use(`app.vault.${String(k)}`), undefined)) },
        ),
        metadataCache: { on: () => ({}), getFileCache: () => null },
      } as Record<string, unknown>,
      { get: (t, k) => (k in t ? t[k as string] : (typeof k === "string" ? use(`app.${k}`) : 0, (app as any)[k])) },
    );

    const mod: Record<string, unknown> = {
      __esModule: true,
      Component,
      Plugin,
      Notice,
      MarkdownView,
      // A browser-hosted add-in is neither the desktop app nor mobile. isDesktop must be false so plugins
      // do not take their Node `fs`/`path` code paths (Latex Suite does this for snippet files).
      Platform: {
        isDesktop: false,
        isDesktopApp: false,
        isMobile: false,
        isMobileApp: false,
        isMacOS: /Mac/.test(navigator.platform),
        isWin: /Win/.test(navigator.platform),
      },
      TAbstractFile: class {},
      TFile: class {},
      TFolder: class {},
      PluginSettingTab: class {},
      SettingTab: class {},
      AbstractInputSuggest: class {},
      Modal: class {},
      Setting: class {
        constructor() {
          return new Proxy(this, { get: (t, k) => (k in t ? (t as any)[k] : () => t) });
        }
      },
      debounce,
      requireApiVersion,
      // Math: Temml (lazy chunk) renders LaTeX to MathML; falls back to the source text if it cannot be loaded.
      loadMathJax: async () => {
        if (!(await mathRenderer.load()) && !report.warnings.includes(MATH_FALLBACK_WARNING)) {
          report.warnings.push(MATH_FALLBACK_WARNING);
          host.onChange();
        }
      },
      renderMath: (source: string, display: boolean) => mathRenderer.render(String(source), !!display),
      finishRenderMath: async () => {},
      addIcon: () => {},
      setIcon: () => {},
      editorLivePreviewField: host.livePreviewField,
      editorInfoField: host.infoField,
      apiVersion: "1.8.0",
      normalizePath: (p: string) => p.replace(/\\/g, "/").replace(/\/+/g, "/"),
    };
    const obsidian = new Proxy(mod, {
      get: (t, k) => {
        if (k in t) return t[k as string];
        if (typeof k !== "string" || k === "default" || k === "then") return undefined;
        use(`obsidian.${k}`);
        return noop(use, `obsidian.${k}`);
      },
    });
    return { obsidian, appShim };
  }

  /** Load a plugin from its manifest.json and main.js source. Never throws; see the returned report. */
  async load(manifest: PluginManifest, mainJs: string, stylesCss?: string): Promise<CompatReport> {
    const report: CompatReport = {
      id: manifest.id,
      loaded: false,
      unsupportedApis: [],
      unsupportedModules: [],
      warnings: [],
      editorExtensions: 0,
      commands: 0,
    };
    this.reports.set(manifest.id, report);
    this.unload(manifest.id);
    this.reports.set(manifest.id, report);
    this.extensionsById.set(manifest.id, []);
    this.commandsById.set(manifest.id, []);
    try {
      // Obsidian provides window.i18next to plugins.
      installPrototypeExtensions();
      installObsidianDom();
      // Obsidian's multi-window globals.
      if (!(window as any).activeDocument) (window as any).activeDocument = document;
      if (!(window as any).activeWindow) (window as any).activeWindow = window;
      if (!(window as any).i18next) (window as any).i18next = createI18nextShim();
      const { obsidian, appShim } = this.makeObsidian(report, manifest);
      const req = (name: string) => {
        if (name === "obsidian") return obsidian;
        if (name in EXTERNALS) return EXTERNALS[name];
        if (!report.unsupportedModules.includes(name)) report.unsupportedModules.push(name);
        return noop((n) => report.unsupportedApis.push(n), name);
      };
      const module = { exports: {} as any };
      new Function("module", "exports", "require", mainJs)(module, module.exports, req);
      const Ctor = typeof module.exports === "function" ? module.exports : module.exports.default;
      if (typeof Ctor !== "function") throw new Error("main.js does not export a Plugin class");
      const plugin = new Ctor(appShim, manifest);
      await plugin.onload();
      this.instances.set(manifest.id, plugin);
      if (stylesCss) {
        const el = document.createElement("style");
        el.dataset.plugin = manifest.id;
        el.textContent = stylesCss;
        document.head.append(el);
      }
      report.loaded = true;
    } catch (e) {
      report.error = (e as Error).message;
      this.extensionsById.delete(manifest.id);
      this.commandsById.delete(manifest.id);
    }
    this.onChange();
    return report;
  }

  unload(id: string): void {
    this.instances.get(id)?.unload();
    this.instances.delete(id);
    this.extensionsById.delete(id);
    this.commandsById.delete(id);
    document.querySelectorAll(`style[data-plugin="${CSS.escape(id)}"]`).forEach((n) => n.remove());
    this.onChange();
  }
}
