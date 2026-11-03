/**
 * Obsidian's `Setting` builder, its components and `PluginSettingTab`, built on plain DOM.
 *
 * Contract: never crash the settings panel. Unknown controls/methods are recorded (compat report) and degrade to a
 * label-only row with a "미지원 컨트롤" note; handlers' exceptions (sync or async) are reported, not swallowed.
 * All text from plugins goes through textContent; DocumentFragments are sanitized (see `sanitizeFragment`).
 */

export interface SettingsCtx {
  /** A handler/display threw (or rejected). */
  onError(error: unknown, where: string): void;
  /** An API/control that is not implemented was used (exact name, e.g. "Setting.addFoo"). */
  unsupported(name: string): void;
}

const ALLOWED_TAGS = new Set([
  "a", "b", "i", "em", "strong", "code", "kbd", "br", "span", "p", "div", "ul", "ol", "li", "small", "sub", "sup",
  "pre", "u", "s", "mark", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "hr",
]);

/** Copy of `node` that only contains harmless formatting elements; `a[href]` only for http(s). */
export function sanitizeFragment(node: Node): DocumentFragment {
  const out = document.createDocumentFragment();
  const copy = (from: Node, into: Node) => {
    for (const c of Array.from(from.childNodes)) {
      if (c.nodeType === 3) {
        into.appendChild(document.createTextNode(c.textContent ?? ""));
        continue;
      }
      if (c.nodeType !== 1) continue;
      const el = c as Element;
      const tag = el.localName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // Unknown element: keep its text only for harmless containers, never script/style/etc.
        if (!/^(script|style|iframe|object|embed|link|meta|template|svg|math|img|video|audio|form|input|button|textarea|select)$/.test(tag)) copy(el, into);
        continue;
      }
      const n = document.createElement(tag);
      const cls = el.getAttribute("class");
      if (cls && /^[\w\- ]+$/.test(cls)) n.setAttribute("class", cls);
      if (tag === "a") {
        let href = "";
        try {
          const u = new URL(el.getAttribute("href") ?? "", "https://invalid.invalid/");
          if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "invalid.invalid") href = u.href;
        } catch {
          /* not a URL */
        }
        if (href) {
          n.setAttribute("href", href);
          n.setAttribute("target", "_blank");
          n.setAttribute("rel", "noopener noreferrer");
        }
      }
      copy(el, n);
      into.appendChild(n);
    }
  };
  copy(node, out);
  return out;
}

const ICONS: Record<string, string> = {
  reset: "↺", "rotate-ccw": "↺", trash: "🗑", "trash-2": "🗑", settings: "⚙", plus: "+", x: "✕", cross: "✕", copy: "⧉",
  check: "✓", pencil: "✎", edit: "✎", search: "⌕", "chevron-down": "▾", "chevron-up": "▴", "arrow-up": "↑",
  "arrow-down": "↓", info: "ⓘ", "help-circle": "?", download: "⭳", upload: "⭱", folder: "▤", file: "▤", star: "★",
};

/** Obsidian icon name -> a text glyph (there is no icon font in the task pane). */
export function iconGlyph(name: string): string {
  return ICONS[name] ?? name.slice(0, 1).toUpperCase();
}

let uid = 0;

export function createSettingsApi(ctx: SettingsCtx) {
  const run = <A extends unknown[]>(where: string, cb: ((...a: A) => unknown) | undefined, ...args: A) => {
    if (typeof cb !== "function") return;
    try {
      const r = cb(...args) as { then?: (a: undefined, b: (e: unknown) => void) => void } | undefined;
      if (r && typeof r.then === "function") r.then(undefined, (e) => ctx.onError(e, where));
    } catch (e) {
      ctx.onError(e, where);
    }
  };

  /** Unknown methods are recorded and chainable instead of throwing. */
  const lenient = <T extends object>(obj: T, label: string, onUnknown?: (key: string) => void): T =>
    new Proxy(obj, {
      get(t, k, r) {
        if (k in t || typeof k !== "string" || k === "then" || k === "toJSON" || k.startsWith("__")) return Reflect.get(t, k, r);
        return (..._a: unknown[]) => {
          ctx.unsupported(`${label}.${k}`);
          onUnknown?.(k);
          return r;
        };
      },
    });

  const tip = (el: HTMLElement, text: string) => {
    el.setAttribute("title", text);
    el.setAttribute("aria-label", text);
  };

  class BaseComponent {
    disabled = false;
    protected primary: HTMLElement | null = null;
    setDisabled(d: boolean) {
      this.disabled = !!d;
      if (this.primary) {
        if ("disabled" in this.primary) (this.primary as HTMLInputElement).disabled = this.disabled;
        this.primary.classList.toggle("is-disabled", this.disabled);
      }
      return this;
    }
    then(cb: (c: this) => unknown) {
      run("Setting.then", cb, this);
      return this;
    }
  }

  class ValueComponent<T> extends BaseComponent {
    protected listeners: ((v: T) => unknown)[] = [];
    getValue(): T {
      return undefined as T;
    }
    setValue(_v: T) {
      return this;
    }
    onChange(cb: (v: T) => unknown) {
      this.listeners.push(cb);
      return this;
    }
    protected emit() {
      const v = this.getValue();
      for (const l of this.listeners) run("onChange", l as (v: T) => unknown, v);
    }
    setTooltip(t: string) {
      if (this.primary) tip(this.primary, t);
      return this;
    }
  }

  class ToggleComponent extends ValueComponent<boolean> {
    toggleEl: HTMLElement;
    inputEl: HTMLInputElement;
    constructor(public containerEl: HTMLElement) {
      super();
      this.toggleEl = containerEl.ownerDocument.createElement("div");
      this.toggleEl.className = "checkbox-container";
      this.inputEl = containerEl.ownerDocument.createElement("input");
      this.inputEl.type = "checkbox";
      this.inputEl.setAttribute("role", "switch");
      this.toggleEl.append(this.inputEl);
      containerEl.append(this.toggleEl);
      this.primary = this.inputEl;
      this.inputEl.addEventListener("change", () => {
        this.sync();
        this.emit();
      });
    }
    private sync() {
      this.toggleEl.classList.toggle("is-enabled", this.inputEl.checked);
    }
    getValue() {
      return this.inputEl.checked;
    }
    setValue(v: boolean) {
      this.inputEl.checked = !!v;
      this.sync();
      return this;
    }
    onClick() {
      this.inputEl.click();
    }
  }

  class AbstractText extends ValueComponent<string> {
    inputEl: HTMLInputElement | HTMLTextAreaElement;
    constructor(public containerEl: HTMLElement, el: HTMLInputElement | HTMLTextAreaElement) {
      super();
      this.inputEl = el;
      containerEl.append(el);
      this.primary = el;
      el.addEventListener("input", () => this.emit());
    }
    getValue() {
      return this.inputEl.value;
    }
    setValue(v: string) {
      this.inputEl.value = v ?? "";
      return this;
    }
    setPlaceholder(p: string) {
      this.inputEl.placeholder = p;
      return this;
    }
    onChanged() {}
  }

  class TextComponent extends AbstractText {
    constructor(containerEl: HTMLElement) {
      const el = containerEl.ownerDocument.createElement("input");
      el.type = "text";
      super(containerEl, el);
    }
  }
  class TextAreaComponent extends AbstractText {
    constructor(containerEl: HTMLElement) {
      super(containerEl, containerEl.ownerDocument.createElement("textarea"));
    }
  }
  class SearchComponent extends AbstractText {
    clearButtonEl: HTMLElement;
    constructor(containerEl: HTMLElement) {
      const wrap = containerEl.ownerDocument.createElement("div");
      wrap.className = "search-input-container";
      containerEl.append(wrap);
      const el = containerEl.ownerDocument.createElement("input");
      el.type = "search";
      super(wrap, el);
      this.containerEl = wrap;
      this.clearButtonEl = wrap.ownerDocument.createElement("div");
      this.clearButtonEl.className = "search-input-clear-button";
      wrap.append(this.clearButtonEl);
    }
  }

  class MomentFormatComponent extends AbstractText {
    private sampleEl: HTMLElement | null = null;
    private defaultFormat = "";
    constructor(containerEl: HTMLElement) {
      const el = containerEl.ownerDocument.createElement("input");
      el.type = "text";
      super(containerEl, el);
      this.inputEl.addEventListener("input", () => this.preview());
    }
    setDefaultFormat(f: string) {
      this.defaultFormat = f;
      this.inputEl.placeholder = f;
      return this;
    }
    setSampleEl(el: HTMLElement) {
      this.sampleEl = el;
      this.preview();
      return this;
    }
    setValue(v: string) {
      super.setValue(v);
      this.preview();
      return this;
    }
    private preview() {
      if (!this.sampleEl) return;
      const fmt = this.inputEl.value || this.defaultFormat;
      const m = (window as unknown as { moment?: (d?: unknown) => { format(f: string): string } }).moment;
      try {
        this.sampleEl.textContent = m ? m().format(fmt) : fmt ? `${fmt} (moment 없음: 미리보기 불가)` : "";
      } catch {
        this.sampleEl.textContent = "";
      }
    }
  }

  class DropdownComponent extends ValueComponent<string> {
    selectEl: HTMLSelectElement;
    constructor(public containerEl: HTMLElement) {
      super();
      this.selectEl = containerEl.ownerDocument.createElement("select");
      this.selectEl.className = "dropdown";
      containerEl.append(this.selectEl);
      this.primary = this.selectEl;
      this.selectEl.addEventListener("change", () => this.emit());
    }
    addOption(value: string, display: string) {
      const o = this.selectEl.ownerDocument.createElement("option");
      o.value = value;
      o.textContent = display;
      this.selectEl.append(o);
      return this;
    }
    addOptions(options: Record<string, string>) {
      for (const [k, v] of Object.entries(options ?? {})) this.addOption(k, v);
      return this;
    }
    getValue() {
      return this.selectEl.value;
    }
    setValue(v: string) {
      this.selectEl.value = v;
      return this;
    }
  }

  class SliderComponent extends ValueComponent<number> {
    sliderEl: HTMLInputElement;
    private readout: HTMLElement | null = null;
    constructor(public containerEl: HTMLElement) {
      super();
      this.sliderEl = containerEl.ownerDocument.createElement("input");
      this.sliderEl.type = "range";
      this.sliderEl.className = "slider";
      containerEl.append(this.sliderEl);
      this.primary = this.sliderEl;
      this.sliderEl.addEventListener("input", () => {
        this.update();
        this.emit();
      });
    }
    private update() {
      this.sliderEl.setAttribute("aria-valuetext", this.getValuePretty());
      if (this.readout) this.readout.textContent = this.getValuePretty();
    }
    setLimits(min: number | null, max: number | null, step: number | "any") {
      if (min !== null) this.sliderEl.min = String(min);
      if (max !== null) this.sliderEl.max = String(max);
      this.sliderEl.step = String(step);
      this.update();
      return this;
    }
    getValue() {
      return Number(this.sliderEl.value);
    }
    getValuePretty() {
      return String(this.getValue());
    }
    setValue(v: number) {
      this.sliderEl.value = String(v);
      this.update();
      return this;
    }
    setDynamicTooltip() {
      if (!this.readout) {
        this.readout = this.sliderEl.ownerDocument.createElement("span");
        this.readout.className = "slider-value";
        this.containerEl.append(this.readout);
      }
      this.update();
      return this;
    }
    showTooltip() {}
  }

  class ColorComponent extends ValueComponent<string> {
    colorPickerEl: HTMLInputElement;
    constructor(public containerEl: HTMLElement) {
      super();
      this.colorPickerEl = containerEl.ownerDocument.createElement("input");
      this.colorPickerEl.type = "color";
      containerEl.append(this.colorPickerEl);
      this.primary = this.colorPickerEl;
      this.colorPickerEl.addEventListener("input", () => this.emit());
    }
    getValue() {
      return this.colorPickerEl.value;
    }
    setValue(v: string) {
      if (/^#[0-9a-f]{6}$/i.test(v)) this.colorPickerEl.value = v;
      return this;
    }
  }

  class ProgressBarComponent extends ValueComponent<number> {
    progressBar: HTMLProgressElement;
    constructor(public containerEl: HTMLElement) {
      super();
      this.progressBar = containerEl.ownerDocument.createElement("progress");
      this.progressBar.max = 100;
      containerEl.append(this.progressBar);
      this.primary = this.progressBar;
    }
    getValue() {
      return this.progressBar.value;
    }
    setValue(v: number) {
      this.progressBar.value = Math.max(0, Math.min(100, Number(v) || 0));
      return this;
    }
  }

  class ButtonComponent extends BaseComponent {
    buttonEl: HTMLButtonElement;
    constructor(public containerEl: HTMLElement) {
      super();
      this.buttonEl = containerEl.ownerDocument.createElement("button");
      this.buttonEl.type = "button";
      containerEl.append(this.buttonEl);
      this.primary = this.buttonEl;
    }
    setButtonText(t: string) {
      this.buttonEl.textContent = t;
      return this;
    }
    setIcon(name: string) {
      this.buttonEl.textContent = iconGlyph(name);
      return this;
    }
    setCta() {
      this.buttonEl.classList.add("mod-cta");
      return this;
    }
    removeCta() {
      this.buttonEl.classList.remove("mod-cta");
      return this;
    }
    setWarning() {
      this.buttonEl.classList.add("mod-warning");
      return this;
    }
    setClass(c: string) {
      this.buttonEl.classList.add(...String(c).split(/\s+/).filter(Boolean));
      return this;
    }
    setTooltip(t: string) {
      tip(this.buttonEl, t);
      return this;
    }
    onClick(cb: (e: MouseEvent) => unknown) {
      this.buttonEl.addEventListener("click", (e) => run("Button.onClick", cb, e));
      return this;
    }
  }

  class ExtraButtonComponent extends BaseComponent {
    extraSettingsEl: HTMLButtonElement;
    constructor(public containerEl: HTMLElement) {
      super();
      this.extraSettingsEl = containerEl.ownerDocument.createElement("button");
      this.extraSettingsEl.type = "button";
      this.extraSettingsEl.className = "clickable-icon extra-setting-button";
      containerEl.append(this.extraSettingsEl);
      this.primary = this.extraSettingsEl;
    }
    setIcon(name: string) {
      this.extraSettingsEl.textContent = iconGlyph(name);
      if (!this.extraSettingsEl.getAttribute("aria-label")) this.extraSettingsEl.setAttribute("aria-label", name);
      return this;
    }
    setTooltip(t: string) {
      tip(this.extraSettingsEl, t);
      return this;
    }
    onClick(cb: () => unknown) {
      this.extraSettingsEl.addEventListener("click", () => run("ExtraButton.onClick", cb));
      return this;
    }
  }

  class Setting {
    settingEl: HTMLElement;
    infoEl: HTMLElement;
    nameEl: HTMLElement;
    descEl: HTMLElement;
    controlEl: HTMLElement;
    components: BaseComponent[] = [];
    private disabled = false;
    private noted = new Set<string>();

    constructor(public containerEl: HTMLElement) {
      const d = containerEl.ownerDocument;
      const id = ++uid;
      const mk = (cls: string) => Object.assign(d.createElement("div"), { className: cls });
      this.settingEl = mk("setting-item");
      this.infoEl = mk("setting-item-info");
      this.nameEl = mk("setting-item-name");
      this.nameEl.id = `owb-setting-name-${id}`;
      this.descEl = mk("setting-item-description");
      this.descEl.id = `owb-setting-desc-${id}`;
      this.controlEl = mk("setting-item-control");
      this.infoEl.append(this.nameEl, this.descEl);
      this.settingEl.append(this.infoEl, this.controlEl);
      containerEl.append(this.settingEl);
      return lenient(this, "Setting", (k) => {
        // an unknown `addXxx` is a control we cannot draw: say so in the row
        if (/^add[A-Z]/.test(k) && !this.noted.has(k)) {
          this.noted.add(k);
          const note = d.createElement("span");
          note.className = "setting-unsupported";
          note.textContent = `미지원 컨트롤 (${k})`;
          this.controlEl.append(note);
        }
      });
    }

    private fill(el: HTMLElement, v: string | DocumentFragment | Node) {
      el.textContent = "";
      if (typeof v === "string") el.textContent = v;
      else if (v && typeof (v as Node).nodeType === "number") el.append(sanitizeFragment(v as Node));
      else el.textContent = String(v ?? "");
    }
    setName(name: string | DocumentFragment) {
      this.fill(this.nameEl, name);
      return this;
    }
    setDesc(desc: string | DocumentFragment) {
      this.fill(this.descEl, desc);
      return this;
    }
    setClass(c: string) {
      this.settingEl.classList.add(...String(c).split(/\s+/).filter(Boolean));
      return this;
    }
    setTooltip(t: string) {
      tip(this.settingEl, t);
      return this;
    }
    setHeading() {
      this.settingEl.classList.add("setting-item-heading");
      this.settingEl.setAttribute("role", "heading");
      return this;
    }
    setDisabled(d: boolean) {
      this.disabled = !!d;
      this.settingEl.classList.toggle("is-disabled", this.disabled);
      for (const c of this.components) c.setDisabled(this.disabled);
      return this;
    }
    then(cb: (s: this) => unknown) {
      run("Setting.then", cb, this);
      return this;
    }
    clear() {
      this.controlEl.textContent = "";
      this.components = [];
      return this;
    }
    private add<C extends BaseComponent>(Ctor: new (el: HTMLElement) => C, cb?: (c: C) => unknown): this {
      const c = new Ctor(this.controlEl);
      this.components.push(c);
      // The name labels the control; the description describes it.
      const primary = (c as unknown as { primary: HTMLElement | null }).primary;
      primary?.setAttribute("aria-labelledby", this.nameEl.id);
      primary?.setAttribute("aria-describedby", this.descEl.id);
      if (this.disabled) c.setDisabled(true);
      run("Setting.add*", cb as ((c: C) => unknown) | undefined, lenient(c, `Setting.${Ctor.name}`) as C);
      return this;
    }
    addToggle(cb?: (c: ToggleComponent) => unknown) {
      return this.add(ToggleComponent, cb);
    }
    addText(cb?: (c: TextComponent) => unknown) {
      return this.add(TextComponent, cb);
    }
    addTextArea(cb?: (c: TextAreaComponent) => unknown) {
      return this.add(TextAreaComponent, cb);
    }
    addDropdown(cb?: (c: DropdownComponent) => unknown) {
      return this.add(DropdownComponent, cb);
    }
    addSlider(cb?: (c: SliderComponent) => unknown) {
      return this.add(SliderComponent, cb);
    }
    addButton(cb?: (c: ButtonComponent) => unknown) {
      return this.add(ButtonComponent, cb);
    }
    addExtraButton(cb?: (c: ExtraButtonComponent) => unknown) {
      return this.add(ExtraButtonComponent, cb);
    }
    addColorPicker(cb?: (c: ColorComponent) => unknown) {
      return this.add(ColorComponent, cb);
    }
    addSearch(cb?: (c: SearchComponent) => unknown) {
      return this.add(SearchComponent, cb);
    }
    addMomentFormat(cb?: (c: MomentFormatComponent) => unknown) {
      return this.add(MomentFormatComponent, cb);
    }
    addProgressBar(cb?: (c: ProgressBarComponent) => unknown) {
      return this.add(ProgressBarComponent, cb);
    }
  }

  class PluginSettingTab {
    containerEl: HTMLElement;
    id = "";
    name = "";
    icon = "";
    constructor(public app: unknown, public plugin: unknown) {
      this.containerEl = document.createElement("div");
      this.containerEl.className = "vertical-tab-content";
    }
    display(): void {}
    hide(): void {}
  }
  class SettingTab extends PluginSettingTab {}

  return {
    Setting,
    PluginSettingTab,
    SettingTab,
    BaseComponent,
    ValueComponent,
    ToggleComponent,
    TextComponent,
    TextAreaComponent,
    SearchComponent,
    MomentFormatComponent,
    DropdownComponent,
    SliderComponent,
    ColorComponent,
    ProgressBarComponent,
    ButtonComponent,
    ExtraButtonComponent,
  };
}
