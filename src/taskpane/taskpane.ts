import {wordObjectLabels} from "./object-labels";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { loadMathOutput, saveMathOutput,loadMathAppearance,saveMathAppearance,loadMathAppearanceSource,saveMathAppearanceSource,loadEditorPreferences,saveEditorPreferences,type EditorPreferences } from "./preferences";
import {appearanceSource,normalizeMathAppearance} from '../convert/math-appearance';
import {initSettingsDialog} from "./settings-dialog";
import {bindBodyControls} from "./body-binding";
import type { MathOutputMode } from "../convert/mathimg";
declare const __APP_BUILD__:string;
document.getElementById('app-build')!.textContent='앱 빌드 '+(typeof __APP_BUILD__==='string'?__APP_BUILD__:'local');

// Heavy parts are separate chunks loaded after the first paint: the markdown language support (pulls in the
// HTML/JS/CSS parsers), the converters + Word glue (`./word`) and the plugin subsystem (`./plugins-ui`).
const loadWord = () => import("./word");

const status = document.getElementById("status")!;
const setStatus = (msg: string) => (status.textContent = msg);
const settings=initSettingsDialog();
const mathOutput = document.getElementById("math-output") as HTMLSelectElement;
mathOutput.value = loadMathOutput();
const mathSize=document.getElementById('math-image-size') as HTMLInputElement;
const mathColor=document.getElementById('math-image-color') as HTMLInputElement;
const mathSource=document.getElementById('math-appearance-source') as HTMLSelectElement;
mathSource.value=loadMathAppearanceSource();
let mathAppearance=loadMathAppearance();
mathSize.value=String(mathAppearance.sizePt);mathColor.value=mathAppearance.color;
const updateMathControls=()=>{
  mathSource.disabled=busy || mathOutput.value!=='images';
  mathSize.disabled=mathColor.disabled=mathSource.disabled || mathSource.value!=='manual';
};
mathSource.onchange=()=>{saveMathAppearanceSource(appearanceSource(mathSource.value));updateMathControls();};
mathOutput.onchange = () => {saveMathOutput(mathOutput.value === "images" ? "images" : "hybrid");updateMathControls();};
const saveMathStyle=()=>{
  mathAppearance=normalizeMathAppearance({sizePt:Number(mathSize.value),color:mathColor.value});
  mathSize.value=String(mathAppearance.sizePt);mathColor.value=mathAppearance.color;saveMathAppearance(mathAppearance);
};
mathSize.onchange=mathColor.onchange=saveMathStyle;

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
  wordObjectLabels,
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

// Keep immutable editor snapshots. Comparing them on load avoids serializing the draft on every keystroke.
let syncedDoc = view.state.doc;
const setDoc = (text: string) => {
  const next = view.state.toText(text);
  if (!view.state.doc.eq(next))
    view.dispatch({changes:{from:0,to:view.state.doc.length,insert:next}});
  syncedDoc = view.state.doc;
};

// After the first paint: markdown language support, then the plugin subsystem, then warm up the converters so the
// first click on 불러오기/적용 does not wait for the network. Failures are non-fatal and only reported.
const afterPaint = () => {
  import("@codemirror/lang-markdown")
    .then((m) => view.dispatch({ effects: markdownLanguage.reconfigure(m.markdown()) }))
    .catch((e) => setStatus(`마크다운 언어 지원을 불러오지 못했습니다: ${(e as Error).message}`));
  import("./plugins-ui")
    .then((m) => m.initPlugins(view, pluginExtensions, setStatus,()=>settings.open("plugins"),{exclusive:withPaneLock,preferencesChanged:refreshPreferences,
      preferencesSnapshot:()=>({editor:{...preferences},mathAppearance:{...mathAppearance},mathOutput:mathOutput.value==='images'?'images':'hybrid',mathSource:appearanceSource(mathSource.value)})}))
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
updateMathControls();
function refreshPreferences(){
  preferences=loadEditorPreferences();mathAppearance=loadMathAppearance();
  numbers.checked=preferences.lineNumbers;wrap.checked=preferences.wrap;fontSize.value=String(preferences.fontSize);
  mathOutput.value=loadMathOutput();mathSource.value=loadMathAppearanceSource();mathSize.value=String(mathAppearance.sizePt);mathColor.value=mathAppearance.color;
  view.dispatch({effects:editorOptions.reconfigure(appearance(preferences))});updateMathControls();
}
async function withPaneLock<T>(action:()=>Promise<T>):Promise<T>{
  if(busy)throw new Error('다른 작업이 진행 중입니다. 완료 후 이관하세요.');
  busy=true;
  const controls=[document.getElementById('load'),document.getElementById('apply'),document.getElementById('partial'),mathOutput,mathSource,mathSize,mathColor,numbers,wrap,fontSize] as (HTMLButtonElement|HTMLSelectElement|HTMLInputElement)[];
  controls.forEach(control=>control.disabled=true);
  try{return await action();}
  finally{busy=false;controls.forEach(control=>control.disabled=false);updateMathControls();}
}
async function run(label: string, fn: () => Promise<string[] | false | void>) {
  if (busy) return;
  try {
    await withPaneLock(async()=>{
    setStatus(`${label}…`);
    const notes = (await fn()) ?? [];
    if (notes === false) { setStatus(`${label} 취소 · 작업창 편집을 유지했습니다.`); return; }
    setStatus([`${label} 완료`, ...notes].join(" · "));
    });
  } catch (e) {
    setStatus(`${label} 실패: ${(e as Error).message}`);
  }
}

Office.onReady((info) => {
  if (info.host !== Office.HostType.Word) {
    setStatus("Word에서만 동작합니다.");
    return;
  }
  bindBodyControls(document.getElementById('body-controls')!);
  document.getElementById("load")!.onclick = () =>
    run("불러오기", async () => {
      const draft = view.state.doc;
      if (!draft.eq(syncedDoc)) {
        const {askConfirm} = await import("./confirm");
        const agreed = await askConfirm(document.body, "아직 Word에 적용하지 않은 편집이 있습니다. 선택 영역을 불러와 작업창 내용을 바꿀까요?", "불러오기", "편집 계속");
        if (!agreed || !view.state.doc.eq(draft)) return false;
      }
      const { readSelectionAsMarkdown } = await loadWord();
      const { markdown, notes } = await readSelectionAsMarkdown(() => view.state.doc.eq(draft));
      if (!view.state.doc.eq(draft)) return false;
      setDoc(markdown);
      return notes;
    });
  document.getElementById("partial")!.onclick = () =>
    run("부분 적용", async () => {
      const { applyParagraphEdit } = await loadWord();
      const submitted = view.state.doc;
      await applyParagraphEdit(submitted.toString());
      syncedDoc = submitted;
      if (!view.state.doc.eq(submitted)) return ["이후 작업창에서 편집한 내용은 다음 적용에 반영됩니다."];
    });
  document.getElementById("apply")!.onclick = () =>
    run("적용", async () => {
      const { replaceSelectionWithMarkdown } = await loadWord();
      const { askConfirm } = await import("./confirm");
      const submitted = view.state.doc;
      const { missing, notes } = await replaceSelectionWithMarkdown(submitted.toString(), (msg) =>
        askConfirm(document.body, msg, "바꾸기", "취소"),
        { mathOutput: mathOutput.value as MathOutputMode,mathAppearance,mathAppearanceSource:appearanceSource(mathSource.value) },
      );
      if (missing.length) throw new Error(`복원할 수 없는 Word 객체: ${missing.join(", ")}`);
      syncedDoc = submitted;
      if (!view.state.doc.eq(submitted)) return [...new Set(notes), "이후 작업창에서 편집한 내용은 다음 적용에 반영됩니다."];
      return [...new Set(notes)];
    });
  // Office.onReady usually fires after the lazy chunks have started: do not hide a load failure reported by then.
  if (!status.textContent) setStatus("Word에서 영역을 선택하고 '선택 영역 → 마크다운' 을 누르세요.");
});
