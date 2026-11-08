import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {readFileSync} from "node:fs";
const markup=new DOMParser().parseFromString(readFileSync('src/taskpane/index.html','utf8'),'text/html').body.innerHTML;

/** The task pane's start-up: lazy chunks are started after the first paint; Office.onReady may fire before or after. */
describe("task pane start-up status", () => {
  let ready: ((info: { host: string }) => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = markup;
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

  it("restores the math output choice and sends it to Word while preventing overlapping operations", async () => {
    localStorage.setItem('oiw:math-output','images');
    let finish!: () => void;
    const applying = new Promise<void>(resolve=>{finish=resolve;});
    const apply = vi.fn(async(_markdown: string, _confirm: unknown, _options: unknown)=>{await applying;return {missing:[],notes:[]};});
    const read = vi.fn();
    vi.doMock('../src/taskpane/word',()=>({replaceSelectionWithMarkdown:apply,readSelectionAsMarkdown:read}));
    await import('../src/taskpane/taskpane');await settle();ready!({host:'Word'});
    const button=document.getElementById('apply') as HTMLButtonElement;
    const select=document.getElementById('math-output') as HTMLSelectElement;
    expect(select.value).toBe('images');
    button.click();await settle();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][2]).toEqual({mathOutput:'images',mathAppearance:{sizePt:11,color:'#000000'},mathAppearanceSource:'manual'});
    expect(button.disabled).toBe(true);expect(select.disabled).toBe(true);
    expect((document.getElementById('editor-wrap') as HTMLInputElement).disabled).toBe(true);
    button.click();(document.getElementById('load') as HTMLButtonElement).click();
    expect(read).not.toHaveBeenCalled();expect(apply).toHaveBeenCalledTimes(1);
    finish();await settle();expect(button.disabled).toBe(false);expect(select.disabled).toBe(false);
    expect((document.getElementById('editor-wrap') as HTMLInputElement).disabled).toBe(false);
    select.value='hybrid';select.dispatchEvent(new Event('change'));expect(localStorage.getItem('oiw:math-output')).toBe('hybrid');
  });
  it('applies and saves editor appearance without replacing the document',async()=>{
    vi.doMock('../src/taskpane/word',()=>({readSelectionAsMarkdown:async()=>({markdown:'saved **text**',notes:[]})}));
    await import('../src/taskpane/taskpane');await settle();ready!({host:'Word'});
    (document.getElementById('load') as HTMLButtonElement).click();await settle();
    const content=document.querySelector('.cm-content') as HTMLElement;
    const numbers=document.getElementById('editor-line-numbers') as HTMLInputElement;
    numbers.checked=false;numbers.dispatchEvent(new Event('change'));
    const wrap=document.getElementById('editor-wrap') as HTMLInputElement;
    wrap.checked=false;wrap.dispatchEvent(new Event('change'));
    const size=document.getElementById('editor-font-size') as HTMLSelectElement;
    size.value='18';size.dispatchEvent(new Event('change'));
    expect(document.querySelector('.cm-lineNumbers')).toBeNull();
    expect(document.querySelector('.cm-lineWrapping')).toBeNull();
    expect(JSON.parse(localStorage.getItem('oiw:editor-options')!)).toEqual({lineNumbers:false,wrap:false,fontSize:18});
    // Options reconfigure the same editor instead of creating a new view.
    expect(document.querySelector('.cm-content')).toBe(content);
    expect(content.textContent).toBe('saved **text**');
  });
  it('restores saved editor appearance on startup',async()=>{
    localStorage.setItem('oiw:editor-options',JSON.stringify({lineNumbers:false,wrap:false,fontSize:20}));
    await import('../src/taskpane/taskpane');await settle();
    expect((document.getElementById('editor-line-numbers') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('editor-wrap') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('editor-font-size') as HTMLSelectElement).value).toBe('20');
    expect(document.querySelector('.cm-lineNumbers')).toBeNull();expect(document.querySelector('.cm-lineWrapping')).toBeNull();
  });
  it('restores selection style choice and keeps manual controls disabled until manual mode',async()=>{
    localStorage.setItem('oiw:math-output','images');localStorage.setItem('oiw:math-image-appearance-source','selection');
    localStorage.setItem('oiw:math-image-appearance',JSON.stringify({sizePt:16,color:'#2457a6'}));
    await import('../src/taskpane/taskpane');await settle();
    const source=document.getElementById('math-appearance-source') as HTMLSelectElement;
    const size=document.getElementById('math-image-size') as HTMLInputElement;
    expect(source.value).toBe('selection');expect(source.disabled).toBe(false);expect(size.disabled).toBe(true);
    source.value='manual';source.dispatchEvent(new Event('change'));
    expect(size.disabled).toBe(false);expect(size.value).toBe('16');expect(localStorage.getItem('oiw:math-image-appearance-source')).toBe('manual');
  });
});
