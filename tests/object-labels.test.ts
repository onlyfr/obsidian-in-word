import {afterEach, expect, it} from "vitest";
import {EditorView} from "@codemirror/view";
import {markdown} from "@codemirror/lang-markdown";
import {wordObjectLabels} from "../src/taskpane/object-labels";

const table = "<!-- word:obj id=12345678 kind=table -->";
const picture = "<!-- word:img id=abcdef12 -->";
let view:EditorView;
function editor(doc:string) {
  view = new EditorView({doc, parent:document.body, extensions:[markdown(),wordObjectLabels]});
  return view;
}
afterEach(() => view.destroy());

it("labels Word objects while keeping exact Markdown for copying and applying", () => {
  const doc = [table, "before " + picture + " after", "<!-- word:table id=abcdef12 -->", "<!-- word:obj id=11111111 kind=float -->"].join("\n\n");
  editor(doc);
  expect([...view.dom.querySelectorAll(".cm-word-object")].map(el=>el.textContent))
    .toEqual(["Word 원본 표","Word 그림","Word 표 · 편집 가능","Word 부동 개체"]);
  view.dispatch({selection:{anchor:0,head:doc.length}});
  expect(view.state.sliceDoc(view.state.selection.main.from,view.state.selection.main.to)).toBe(doc);
  expect(view.dom.querySelectorAll(".cm-word-object")).toHaveLength(4);
});

it("reveals the correct inline marker on click and relabels after the cursor leaves", () => {
  const doc = "앞 " + picture + " 뒤";
  editor(doc);
  view.dom.querySelector(".cm-word-object")!.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));
  expect(view.state.selection.main.head).toBe(3);
  expect(view.dom.querySelector(".cm-word-object")).toBeNull();
  expect(view.contentDOM.textContent).toBe(doc);
  view.dispatch({selection:{anchor:0}});
  expect(view.dom.querySelector(".cm-word-object")).not.toBeNull();
});

it("leaves code, malformed markers and LaTeX untouched", () => {
  editor(["~~~",table,"~~~","","`"+picture+"`","","$x^2$","","<!-- word:img id=abcdef12 kind=float -->","","<!-- word:obj id=12345678 kind=unknown -->"].join("\n"));
  expect(view.dom.querySelector(".cm-word-object")).toBeNull();
});
