import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The task pane's start-up: lazy chunks are started after the first paint; Office.onReady may fire before or after. */
describe("task pane start-up status", () => {
  let ready: ((info: { host: string }) => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML =
      '<button id="load"></button><button id="apply"></button><div id="editor"></div><p id="status"></p>';
    ready = null;
    (globalThis as any).Office = { HostType: { Word: "Word" }, onReady: (cb: typeof ready) => (ready = cb) };
    vi.doMock("../src/taskpane/word", () => ({}));
    vi.doMock("../src/taskpane/plugins-ui", () => ({ initPlugins: async () => ({}) }));
  });
  afterEach(() => {
    vi.doUnmock("@codemirror/lang-markdown");
    delete (globalThis as any).Office;
  });
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it("shows the hint when nothing went wrong", async () => {
    await import("../src/taskpane/taskpane");
    await settle();
    ready!({ host: "Word" });
    expect(document.getElementById("status")!.textContent).toContain("선택 영역 → 마크다운");
  });

  it("keeps the markdown-language load failure visible when Office.onReady fires afterwards", async () => {
    vi.doMock("@codemirror/lang-markdown", () => {
      throw new Error("chunk failed");
    });
    await import("../src/taskpane/taskpane");
    await settle();
    const before = document.getElementById("status")!.textContent;
    expect(before).toContain("마크다운 언어 지원을 불러오지 못했습니다");
    ready!({ host: "Word" });
    expect(document.getElementById("status")!.textContent).toBe(before);
  });

  it("still wires the buttons (the editor works without the markdown language)", async () => {
    vi.doMock("@codemirror/lang-markdown", () => {
      throw new Error("chunk failed");
    });
    await import("../src/taskpane/taskpane");
    await settle();
    ready!({ host: "Word" });
    expect(typeof document.getElementById("load")!.onclick).toBe("function");
    expect(document.querySelector(".cm-content")).not.toBeNull();
  });
});
