import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { loadMathOutput, saveMathOutput,loadEditorPreferences,saveEditorPreferences,type EditorPreferences } from "./preferences";
import {initSettingsDialog} from "./settings-dialog";
import type { MathOutputMode } from "../convert/mathimg";

// Heavy parts are separate chunks loaded after the first paint: the markdown language support (pulls in the
// HTML/JS/CSS parsers), the converters + Word glue (`./word`) and the plugin subsystem (`./plugins-ui`).
const loadWord = () => import("./word");

const status = document.getElementById("status")!;
const setStatus = (msg: string) => (status.textContent = msg);
const settings=initSettingsDialog();
const mathOutput = document.getElementById("math-output") as HTMLSelectElement;
mathOutput.value = loadMathOutput();
mathOutput.onchange = () => saveMathOutput(mathOutput.value === "images" ? "images" : "hybrid");

// Extensions registered by loaded Obsidian community plugins are swapped into this compartment.
const pluginExtensions = new Compartment();
const markdownLanguage = new Compartment();
const editorOptions=new Compartment();
let preferences=loadEditorPreferences();
const appearance=(options:EditorPreferences)=>[
  ...(options.lineNumbers?[lineNumbers()]:[]),
  ...(options.wrap?[EditorView.lineWrapping]:[]),
  EditorView.theme({"&":{fontSize:`${options.fontSize}px`}}),
];
const extensions = [
  editorOptions.of(appearance(preferences)),
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  markdownLanguage.of([]),
  pluginExtensions.of([]),
];

const view = new EditorView({
  state: EditorState.create({ doc: "", extensions }),
  parent: document.getElementById("editor")!,
});
const numbers=document.getElementById("editor-line-numbers") as HTMLInputElement;
const wrap=document.getElementById("editor-wrap") as HTMLInputElement;
const fontSize=document.getElementById("editor-font-size") as HTMLSelectElement;
numbers.checked=preferences.lineNumbers;wrap.checked=preferences.wrap;fontSize.value=String(preferences.fontSize);
const updateEditorOptions=()=>{
  const size=Number(fontSize.value);
  preferences={lineNumbers:numbers.checked,wrap:wrap.checked,fontSize:([12,14,16,18,20].includes(size)?size:14) as EditorPreferences["fontSize"]};
  saveEditorPreferences(preferences);view.dispatch({effects:editorOptions.reconfigure(appearance(preferences))});
};
numbers.onchange=wrap.onchange=fontSize.onchange=updateEditorOptions;

const setDoc = (text: string) =>
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });

// After the first paint: markdown language support, then the plugin subsystem, then warm up the converters so the
// first click on 불러오기/적용 does not wait for the network. Failures are non-fatal and only reported.
const afterPaint = () => {
  import("@codemirror/lang-markdown")
    .then((m) => view.dispatch({ effects: markdownLanguage.reconfigure(m.markdown()) }))
    .catch((e) => setStatus(`마크다운 언어 지원을 불러오지 못했습니다: ${(e as Error).message}`));
  import("./plugins-ui")
    .then((m) => m.initPlugins(view, pluginExtensions, setStatus,()=>settings.open("plugins")))
    .catch((e) => {
      const message=`플러그인 초기화 실패: ${(e as Error).message}`;
      document.getElementById("plugin-loading")!.textContent=message;setStatus(message);
    });
  loadWord().catch(() => {
    /* retried on the first click; the error is shown there */
  });
};
setTimeout(afterPaint, 0);

let busy = false;
async function run(label: string, fn: () => Promise<string[] | void>) {
  if (busy) return;
  busy = true;
  const controls = [document.getElementById("load"), document.getElementById("apply"), mathOutput,numbers,wrap,fontSize] as (HTMLButtonElement | HTMLSelectElement | HTMLInputElement)[];
  controls.forEach(c => c.disabled = true);
  try {
    setStatus(`${label}…`);
    const notes = (await fn()) ?? [];
    setStatus([`${label} 완료`, ...notes].join(" · "));
  } catch (e) {
    setStatus(`${label} 실패: ${(e as Error).message}`);
  } finally {
    busy = false;
    controls.forEach(c => c.disabled = false);
  }
}

Office.onReady((info) => {
  if (info.host !== Office.HostType.Word) {
    setStatus("Word에서만 동작합니다.");
    return;
  }
  document.getElementById("load")!.onclick = () =>
    run("불러오기", async () => {
      const { readSelectionAsMarkdown } = await loadWord();
      const { markdown, notes } = await readSelectionAsMarkdown();
      setDoc(markdown);
      return notes;
    });
  document.getElementById("apply")!.onclick = () =>
    run("적용", async () => {
      const { replaceSelectionWithMarkdown } = await loadWord();
      const { askConfirm } = await import("./confirm");
      const { missing, notes } = await replaceSelectionWithMarkdown(view.state.doc.toString(), (msg) =>
        askConfirm(document.body, msg, "바꾸기", "취소"),
        { mathOutput: mathOutput.value as MathOutputMode },
      );
      if (missing.length) throw new Error(`복원할 수 없는 Word 객체: ${missing.join(", ")}`);
      return [...new Set(notes)];
    });
  // Office.onReady usually fires after the lazy chunks have started: do not hide a load failure reported by then.
  if (!status.textContent) setStatus("Word에서 영역을 선택하고 '선택 영역 → 마크다운' 을 누르세요.");
});
