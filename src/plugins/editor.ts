import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface EditorPosition {
  line: number;
  ch: number;
}

/** The subset of Obsidian's `Editor` API that plugins commonly use, backed by a CodeMirror 6 view. */
export class ObsidianEditor {
  constructor(public cm: EditorView) {}

  posToOffset(pos: EditorPosition): number {
    const doc = this.cm.state.doc;
    const line = doc.line(Math.min(Math.max(pos.line + 1, 1), doc.lines));
    return line.from + Math.min(pos.ch, line.length);
  }
  offsetToPos(offset: number): EditorPosition {
    const line = this.cm.state.doc.lineAt(Math.min(Math.max(offset, 0), this.cm.state.doc.length));
    return { line: line.number - 1, ch: offset - line.from };
  }

  getDoc() {
    return this;
  }
  getValue() {
    return this.cm.state.doc.toString();
  }
  setValue(text: string) {
    this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: text } });
  }
  lineCount() {
    return this.cm.state.doc.lines;
  }
  lastLine() {
    return this.cm.state.doc.lines - 1;
  }
  getLine(n: number) {
    return this.cm.state.doc.line(n + 1).text;
  }
  getRange(from: EditorPosition, to: EditorPosition) {
    return this.cm.state.doc.sliceString(this.posToOffset(from), this.posToOffset(to));
  }
  replaceRange(text: string, from: EditorPosition, to: EditorPosition = from) {
    this.cm.dispatch({ changes: { from: this.posToOffset(from), to: this.posToOffset(to), insert: text } });
  }
  getSelection() {
    const r = this.cm.state.selection.main;
    return this.cm.state.sliceDoc(r.from, r.to);
  }
  somethingSelected() {
    return !this.cm.state.selection.main.empty;
  }
  replaceSelection(text: string) {
    this.cm.dispatch(this.cm.state.replaceSelection(text));
  }
  getCursor(which: "from" | "to" | "head" | "anchor" = "head"): EditorPosition {
    const r = this.cm.state.selection.main;
    const off = which === "from" ? r.from : which === "to" ? r.to : which === "anchor" ? r.anchor : r.head;
    return this.offsetToPos(off);
  }
  setCursor(pos: EditorPosition | number, ch?: number) {
    const p = typeof pos === "number" ? { line: pos, ch: ch ?? 0 } : pos;
    this.cm.dispatch({ selection: EditorSelection.cursor(this.posToOffset(p)) });
  }
  setSelection(anchor: EditorPosition, head: EditorPosition = anchor) {
    this.cm.dispatch({ selection: EditorSelection.single(this.posToOffset(anchor), this.posToOffset(head)) });
  }
  listSelections() {
    return this.cm.state.selection.ranges.map((r) => ({ anchor: this.offsetToPos(r.anchor), head: this.offsetToPos(r.head) }));
  }
  focus() {
    this.cm.focus();
  }
  refresh() {
    this.cm.requestMeasure();
  }
}
