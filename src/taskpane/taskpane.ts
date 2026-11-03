import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { readSelectionAsMarkdown, replaceSelectionWithMarkdown } from "./word";

const status = document.getElementById("status")!;
const setStatus = (msg: string) => (status.textContent = msg);

// Extension point: compatible CM6-based community extensions (e.g. snippet/conceal helpers)
// get appended here once a thin Obsidian API shim exists.
const extensions = [lineNumbers(), history(), keymap.of([...defaultKeymap, ...historyKeymap]), markdown(), EditorView.lineWrapping];

const view = new EditorView({
  state: EditorState.create({ doc: "", extensions }),
  parent: document.getElementById("editor")!,
});

const setDoc = (text: string) =>
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });

async function run(label: string, fn: () => Promise<string[] | void>) {
  try {
    setStatus(`${label}…`);
    const notes = (await fn()) ?? [];
    setStatus([`${label} 완료`, ...notes].join(" · "));
  } catch (e) {
    setStatus(`${label} 실패: ${(e as Error).message}`);
  }
}

Office.onReady((info) => {
  if (info.host !== Office.HostType.Word) {
    setStatus("Word에서만 동작합니다.");
    return;
  }
  document.getElementById("load")!.onclick = () =>
    run("불러오기", async () => {
      const { markdown, notes } = await readSelectionAsMarkdown();
      setDoc(markdown);
      return notes;
    });
  document.getElementById("apply")!.onclick = () =>
    run("적용", async () => {
      const { missing } = await replaceSelectionWithMarkdown(view.state.doc.toString());
      if (missing.length) throw new Error(`복원할 수 없는 Word 객체: ${missing.join(", ")}`);
    });
  setStatus("Word에서 영역을 선택하고 '선택 영역 → 마크다운' 을 누르세요.");
});
