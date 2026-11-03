import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { MemoryDataStore, PluginHost } from "../src/plugins/host";

const manifest = { id: "toy", name: "Toy" };

// CommonJS bundle shaped like what esbuild produces for an Obsidian plugin.
const toy = `
const { Plugin, Notice } = require("obsidian");
const { EditorState } = require("@codemirror/state");
module.exports = class Toy extends Plugin {
  async onload() {
    const saved = (await this.loadData()) || { runs: 0 };
    saved.runs++;
    await this.saveData(saved);
    this.registerEditorExtension(EditorState.transactionFilter.of((tr) => tr));
    this.addCommand({ id: "hello", name: "Say hello", callback: () => new Notice("hello") });
    this.addSettingTab({});
    this.app.workspace.onLayoutReady(() => { this.ready = true; });
  }
};`;

describe("PluginHost", () => {
  it("loads a plugin, collects extensions and commands, persists data", async () => {
    const store = new MemoryDataStore();
    const notices: string[] = [];
    const host = new PluginHost(store, (m) => notices.push(m));
    const r = await host.load(manifest, toy);
    expect(r).toMatchObject({ loaded: true, editorExtensions: 1, commands: 1 });
    expect(host.extensions()).toHaveLength(1);
    expect(host.commands()[0].id).toBe("toy:hello");
    host.commands()[0].callback!();
    expect(notices).toEqual(["hello"]);
    expect(store.get("toy")).toEqual({ runs: 1 });
    // extensions are usable in a real CM6 state
    EditorState.create({ doc: "x", extensions: host.extensions() });
  });

  it("reports unsupported modules and APIs instead of crashing", async () => {
    const src = `
      const { Plugin, MarkdownRenderer } = require("obsidian");
      const fs = require("fs");
      module.exports = class P extends Plugin {
        onload() { this.app.metadataCache.somethingNew; MarkdownRenderer.renderMarkdown("x"); this.registerView(); }
      };`;
    const r = await new PluginHost().load({ id: "p", name: "P" }, src);
    expect(r.loaded).toBe(true);
    expect(r.unsupportedModules).toEqual(["fs"]);
    expect(r.unsupportedApis).toEqual(expect.arrayContaining(["obsidian.MarkdownRenderer.renderMarkdown", "Plugin.registerView"]));
  });

  it("returns an error report when main.js throws or exports nothing", async () => {
    const host = new PluginHost();
    expect((await host.load({ id: "a", name: "A" }, "throw new Error('boom')")).error).toBe("boom");
    expect((await host.load({ id: "b", name: "B" }, "module.exports = 42")).error).toMatch(/Plugin class/);
    expect(host.extensions()).toHaveLength(0);
  });

  it("unload removes extensions, commands and injected styles", async () => {
    const host = new PluginHost();
    await host.load(manifest, toy, ".toy{color:red}");
    expect(document.querySelectorAll('style[data-plugin="toy"]')).toHaveLength(1);
    host.unload("toy");
    expect(host.extensions()).toHaveLength(0);
    expect(host.commands()).toHaveLength(0);
    expect(document.querySelectorAll('style[data-plugin="toy"]')).toHaveLength(0);
  });

  it("reloading a plugin replaces, not duplicates, its extensions", async () => {
    const host = new PluginHost();
    await host.load(manifest, toy);
    await host.load(manifest, toy);
    expect(host.extensions()).toHaveLength(1);
  });
});

describe("PluginHost compatibility details", () => {
  it("is not the desktop app, so plugins skip their Node fs/path code paths", async () => {
    const src = `
      const { Plugin, Platform, TFile } = require("obsidian");
      module.exports = class P extends Plugin {
        async onload() {
          if (Platform.isDesktop) { require("fs"); }
          this.flags = [Platform.isDesktop, new TFile() instanceof TFile];
          this.saveData(this.flags);
        }
      };`;
    const store = new MemoryDataStore();
    const r = await new PluginHost(store).load({ id: "p", name: "P" }, src);
    expect(r.loaded).toBe(true);
    expect(r.unsupportedModules).toEqual([]);
    expect(store.get("p")).toEqual([false, true]);
  });

  it("workspace.updateOptions asks the host to re-read extensions", async () => {
    const src = `
      const { Plugin } = require("obsidian");
      module.exports = class P extends Plugin { onload() { this.app.workspace.updateOptions(); } };`;
    const host = new PluginHost();
    let changes = 0;
    host.onChange = () => changes++;
    await host.load({ id: "p", name: "P" }, src);
    expect(changes).toBeGreaterThanOrEqual(1);
  });

  it("keeps editorCheckCallback commands", async () => {
    const src = `
      const { Plugin } = require("obsidian");
      module.exports = class P extends Plugin {
        onload() { this.addCommand({ id: "c", name: "C", editorCheckCallback: (checking) => !checking }); }
      };`;
    const host = new PluginHost();
    await host.load({ id: "p", name: "P" }, src);
    expect(host.commands()[0].editorCheckCallback!(false, null, null)).toBe(true);
  });
});

import { EditorView } from "@codemirror/view";
import { ObsidianEditor } from "../src/plugins/editor";
import { MarkdownView } from "../src/plugins/host";

describe("Editor shim and command running", () => {
  const makeEditor = (doc: string) => {
    const view = new EditorView({ doc, parent: document.body });
    return { view, editor: new ObsidianEditor(view) };
  };

  it("implements the common Editor API on a CM6 view", () => {
    const { editor } = makeEditor("hello\nworld");
    expect(editor.getValue()).toBe("hello\nworld");
    expect(editor.lineCount()).toBe(2);
    expect(editor.getLine(1)).toBe("world");
    editor.setSelection({ line: 0, ch: 1 }, { line: 0, ch: 4 });
    expect(editor.getSelection()).toBe("ell");
    editor.replaceSelection("ipp");
    expect(editor.getValue()).toBe("hippo\nworld");
    expect(editor.getCursor("to")).toEqual({ line: 0, ch: 4 });
    editor.replaceRange("W", { line: 1, ch: 0 }, { line: 1, ch: 1 });
    expect(editor.getRange({ line: 1, ch: 0 }, { line: 1, ch: 5 })).toBe("World");
    expect(editor.offsetToPos(editor.posToOffset({ line: 1, ch: 2 }))).toEqual({ line: 1, ch: 2 });
  });

  const editorPlugin = `
    const { Plugin, MarkdownView } = require("obsidian");
    module.exports = class P extends Plugin {
      onload() {
        this.addCommand({ id: "up", name: "Uppercase", hotkeys: [{ modifiers: ["Mod", "Shift"], key: "U" }],
          editorCallback: (editor) => editor.setValue(editor.getValue().toUpperCase()) });
        this.addCommand({ id: "sel", name: "Needs selection",
          editorCheckCallback: (checking, editor) => { if (!editor.somethingSelected()) return false; if (!checking) editor.replaceSelection("X"); return true; } });
        this.addCommand({ id: "active", name: "Active view",
          callback: () => { const v = this.app.workspace.getActiveViewOfType(MarkdownView); v && v.editor.setValue("viewed"); } });
      }
    };`;

  it("runs editor commands against the active editor and reports hotkeys", async () => {
    const { editor } = makeEditor("abc");
    const host = new PluginHost();
    host.activeView = new MarkdownView(editor);
    await host.load({ id: "p", name: "P" }, editorPlugin);
    expect(host.hotkeys()).toEqual([{ key: "Mod-Shift-u", commandId: "p:up" }]);
    expect(host.runCommand("p:up")).toBe(true);
    expect(editor.getValue()).toBe("ABC");
    expect(host.runCommand("p:sel")).toBe(false); // check callback declines without a selection
    editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 1 });
    expect(host.runCommand("p:sel")).toBe(true);
    expect(editor.getValue()).toBe("XBC");
    expect(host.runCommand("p:active")).toBe(true);
    expect(editor.getValue()).toBe("viewed");
    expect(host.runCommand("p:missing")).toBe(false);
  });

  it("reports command errors through notify instead of throwing", async () => {
    const notices: string[] = [];
    const host = new PluginHost(undefined, (m) => notices.push(m));
    const src = `const { Plugin } = require("obsidian");
      module.exports = class P extends Plugin { onload() { this.addCommand({ id: "x", name: "Boom", callback: () => { throw new Error("bad"); } }); } };`;
    await host.load({ id: "p", name: "P" }, src);
    expect(host.runCommand("p:x")).toBe(false);
    expect(notices).toEqual(["Boom: bad"]);
  });
});
