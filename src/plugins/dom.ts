/**
 * Obsidian's DOM helpers: global `createEl`/`createDiv`/`createSpan`/`createSvg`/`createFragment` and the
 * `HTMLElement` extensions (`createEl`, `empty`, `addClass`, ...). Installed once, only where missing.
 */
export interface DomElementInfo {
  text?: string | DocumentFragment;
  cls?: string | string[];
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  parent?: Node;
  value?: string;
  type?: string;
  prepend?: boolean;
  href?: string;
}

function build<K extends keyof HTMLElementTagNameMap>(tag: K, o?: DomElementInfo | string, cb?: (el: HTMLElementTagNameMap[K]) => void): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const info: DomElementInfo = typeof o === "string" ? { cls: o } : (o ?? {});
  if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
  if (info.text !== undefined) el.append(info.text);
  if (info.title) el.title = info.title;
  if (info.value !== undefined) (el as unknown as HTMLInputElement).value = info.value;
  if (info.type) el.setAttribute("type", info.type);
  if (info.href) el.setAttribute("href", info.href);
  for (const [k, v] of Object.entries(info.attr ?? {})) if (v !== null && v !== false) el.setAttribute(k, v === true ? "" : String(v));
  if (info.parent) info.prepend ? info.parent.insertBefore(el, info.parent.firstChild) : info.parent.appendChild(el);
  cb?.(el);
  return el;
}

export function installObsidianDom(): void {
  const g = globalThis as any;
  const def = (target: object, name: string, fn: (...a: any[]) => unknown) => {
    if (!(name in target)) Object.defineProperty(target, name, { value: fn, configurable: true, writable: true, enumerable: false });
  };
  def(g, "createEl", (tag: any, o?: any, cb?: any) => build(tag, o, cb));
  def(g, "createDiv", (o?: any, cb?: any) => build("div", o, cb));
  def(g, "createSpan", (o?: any, cb?: any) => build("span", o, cb));
  def(g, "createFragment", (cb?: (f: DocumentFragment) => void) => {
    const f = document.createDocumentFragment();
    cb?.(f);
    return f;
  });
  def(g, "createSvg", (tag: string, o?: DomElementInfo | string, cb?: (el: SVGElement) => void) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    const info: DomElementInfo = typeof o === "string" ? { cls: o } : (o ?? {});
    if (info.cls) el.setAttribute("class", Array.isArray(info.cls) ? info.cls.join(" ") : info.cls);
    for (const [k, v] of Object.entries(info.attr ?? {})) if (v !== null && v !== false) el.setAttribute(k, String(v));
    info.parent?.appendChild(el);
    cb?.(el);
    return el;
  });
  // `node.win` / `node.doc`: the window/document a node lives in (multi-window aware in Obsidian).
  for (const [name, get] of [
    ["win", function (this: Node) { return this.ownerDocument?.defaultView ?? window; }],
    ["doc", function (this: Node) { return this.ownerDocument ?? document; }],
  ] as const)
    if (!(name in Node.prototype)) Object.defineProperty(Node.prototype, name, { get, configurable: true, enumerable: false });
  const N = Node.prototype;
  def(N, "createEl", function (this: Node, tag: any, o?: any, cb?: any) {
    const info = typeof o === "string" ? { cls: o } : { ...(o ?? {}) };
    return build(tag, { ...info, parent: this }, cb);
  });
  def(N, "createDiv", function (this: Node, o?: any, cb?: any) {
    return (this as any).createEl("div", o, cb);
  });
  def(N, "createSpan", function (this: Node, o?: any, cb?: any) {
    return (this as any).createEl("span", o, cb);
  });
  def(N, "empty", function (this: Node) {
    while (this.firstChild) this.removeChild(this.firstChild);
  });
  def(N, "detach", function (this: Node) {
    this.parentNode?.removeChild(this);
  });
  def(N, "appendText", function (this: Node, t: string) {
    this.appendChild(document.createTextNode(t));
  });
  const E = Element.prototype;
  def(E, "addClass", function (this: Element, ...c: string[]) {
    this.classList.add(...c.flatMap((x) => x.split(/\s+/).filter(Boolean)));
  });
  def(E, "addClasses", function (this: Element, c: string[]) {
    this.classList.add(...c);
  });
  def(E, "removeClass", function (this: Element, ...c: string[]) {
    this.classList.remove(...c.flatMap((x) => x.split(/\s+/).filter(Boolean)));
  });
  def(E, "removeClasses", function (this: Element, c: string[]) {
    this.classList.remove(...c);
  });
  def(E, "toggleClass", function (this: Element, c: string | string[], on: boolean) {
    for (const x of Array.isArray(c) ? c : [c]) this.classList.toggle(x, on);
  });
  def(E, "hasClass", function (this: Element, c: string) {
    return this.classList.contains(c);
  });
  def(E, "setText", function (this: Element, t: string | DocumentFragment) {
    this.textContent = "";
    this.append(t);
  });
  def(E, "setAttrs", function (this: Element, a: Record<string, string | number | boolean | null>) {
    for (const [k, v] of Object.entries(a)) if (v === null || v === false) this.removeAttribute(k);
    else this.setAttribute(k, v === true ? "" : String(v));
  });
  def(E, "getText", function (this: Element) {
    return this.textContent ?? "";
  });
  def(E, "show", function (this: HTMLElement) {
    this.style.display = "";
  });
  def(E, "hide", function (this: HTMLElement) {
    this.style.display = "none";
  });
}
