import {syntaxTree} from "@codemirror/language";
import {Decoration, EditorView, ViewPlugin, WidgetType, type ViewUpdate} from "@codemirror/view";
import {RangeSetBuilder} from "@codemirror/state";

const labels = new Map(Object.entries({
  table:"Word 원본 표", float:"Word 부동 개체", drawing:"Word 그리기 개체", image:"Word 그림",
  equation:"Word 원본 수식", tracked:"Word 변경 내용", footnote:"Word 각주·미주", field:"Word 필드", object:"Word 개체",
}));

class ObjectLabel extends WidgetType {
  constructor(readonly label:string, readonly id:string) { super(); }
  eq(other:ObjectLabel) { return this.label === other.label && this.id === other.id; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-word-object";
    span.textContent = this.label;
    span.title = this.id + " · 클릭하면 원본 마크다운을 편집합니다";
    return span;
  }
  ignoreEvent() { return false; }
}

function decorations(view:EditorView) {
  const {state} = view;
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(state);
  for (const {from,to} of view.visibleRanges) {
    tree.iterate({from,to,enter(node) {
      if (node.name !== "CommentBlock" && node.name !== "Comment") return;
      if (node.from < from || node.to > to || node.to-node.from > 80) return false;
      const source = state.sliceDoc(node.from,node.to);
      const marker = /^<!-- word:(obj|table|img) id=([0-9a-f]{8})(?: kind=([a-z]+))? -->$/.exec(source);
      if (!marker) return false;
      const [,type,id,kind] = marker;
      const line = state.doc.lineAt(node.from);
      if (type !== "img" && (line.from !== node.from || line.text.trimEnd() !== source)) return false;
      const label = type === "obj" ? labels.get(kind) : kind ? undefined : type === "img" ? "Word 그림" : "Word 표 · 편집 가능";
      if (!label || state.selection.ranges.some(r => r.empty && r.head > node.from && r.head < node.to)) return false;
      builder.add(node.from,node.to,Decoration.replace({widget:new ObjectLabel(label,id)}));
      return false;
    }});
  }
  return builder.finish();
}

export const wordObjectLabels = ViewPlugin.fromClass(class {
  decorations;
  constructor(view:EditorView) { this.decorations = decorations(view); }
  update(update:ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet || syntaxTree(update.startState) !== syntaxTree(update.state))
      this.decorations = decorations(update.view);
  }
}, {
  decorations:plugin => plugin.decorations,
  eventHandlers:{
    mousedown(event,view) {
      const target = event.target;
      if (event.button !== 0 || event.shiftKey || !(target instanceof HTMLElement) || !target.classList.contains("cm-word-object")) return false;
      const from = view.posAtDOM(target);
      view.dispatch({selection:{anchor:from+1}});
      view.focus();
      event.preventDefault();
      return true;
    },
  },
});
