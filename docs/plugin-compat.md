# 커뮤니티 플러그인 호환 계층 (설계 메모)

## 원칙
특정 플러그인(예: Latex Suite)을 하드코딩하지 않는다. **Obsidian 플러그인 규격 자체**(`manifest.json` + CommonJS `main.js` + `styles.css`)를 불러오는 중간 계층을 만들고, 어떤 플러그인이 올라가는지는 호환성 보고서로 판단한다. 지원 대상은 "편집/문법 계열", 즉 CodeMirror 6 확장과 명령 중심의 플러그인이다.

## 계층
1. **로더** (`src/plugins/host.ts`, 구현됨): `main.js`를 `module/exports/require` 샌드박스 함수로 실행한다. `obsidian`과 `@codemirror/*`, `@lezer/*`는 번들에 포함된 동일 모듈을 주입한다(플러그인이 자체 복사본을 쓰면 CM6 `instanceof` 검사가 깨지므로 반드시 공유).
2. **Obsidian API 흉내** (구현됨, 최소): `Plugin`, `Component`, `Notice`, `Platform`, `TFile/TFolder`, `debounce`, `app.workspace/vault/metadataCache` 일부. 구현하지 않은 API는 호출되어도 죽지 않고 **호환성 보고서**에 기록된다.
3. **에디터 연결** (구현됨, 실기 검증 전): `registerEditorExtension`으로 모은 확장과 명령 단축키를 작업창 CM6 에디터의 `Compartment`에 넣는다. `workspace.updateOptions()`가 호출되면 다시 읽는다. (`src/taskpane/plugins-ui.ts`)
4. **편집 API** (구현됨): `editorCallback`/`editorCheckCallback`에 넘기는 `Editor`(`getValue`, `getSelection`, `replaceSelection`, `getCursor`, `replaceRange`, `cm` = `EditorView` 등, `src/plugins/editor.ts`)와 `MarkdownView` 대역. `workspace.getActiveViewOfType(MarkdownView)`는 작업창의 단일 에디터를 돌려준다.
5. **UI** (일부 구현): 플러그인 파일(manifest.json + main.js [+ styles.css]) 불러오기, IndexedDB 저장, 켜기/끄기/삭제, 호환성 보고서 표시, 명령 실행 목록과 단축키. **미구현**: 설정 탭(`PluginSettingTab`/`Setting`) 렌더링, 플러그인 업데이트.

## 실제 번들 분석 (Latex Suite 1.14.1, 정적 분석만 수행)
- 외부 모듈: `@codemirror/{view,state,language,commands,autocomplete,search,lint}`, `@lezer/{common,lr,highlight}`, `obsidian`. 모두 주입 가능.
- Node 내장 모듈 `fs`/`path`/`os`는 `Platform.isDesktop`일 때만 쓰인다 → 브라우저 애드인에서는 `isDesktop=false`로 두어 경로를 피한다.
- 사용하는 Obsidian API: `Plugin.registerEditorExtension/addCommand/addSettingTab/loadData/saveData`, `editorCheckCallback`, `Notice`, `TFile/TFolder`, `Platform`, `debounce`, `app.workspace.{onLayoutReady,updateOptions,getActiveFile}`, `app.vault.{getAbstractFileByPath,config}`.
- 남는 위험: 수식 렌더링(MathJax)이 `obsidian`의 `loadMathJax/renderMath/finishRenderMath`에 의존할 수 있다 → 구현하지 않은 API는 보고서에서 확인하고, 필요하면 우리 쪽 MathJax/Temml로 대체한다.

## 한계와 보안
- Word 본문에 직접 타이핑할 때는 키 입력을 가로챌 수 없으므로 플러그인은 **작업창 에디터 안에서만** 동작한다.
- 플러그인은 내려받은 JS를 애드인 출처에서 그대로 실행한다(Office.js 접근 가능). 신뢰하는 플러그인만 불러오도록 UI에서 경고한다.
- 이 저장소는 플러그인 코드를 포함하거나 재배포하지 않는다. 사용자가 직접 파일을 불러온다.

## Verified against a real plugin (Latex Suite 1.14.1)

Loading it in the real Word task pane needed these generic shims (all covered by `tests/compat.test.ts`):
`window.confirm` is unsupported in Word's WebView (replaced by an inline confirmation), `requireApiVersion`,
a minimal `window.i18next`, `activeDocument`/`activeWindow`, Obsidian's prototype extensions (`String#contains`, ...),
DOM helpers (`createEl`, `createDiv`, `el.addClass`, `el.empty`, `node.win`, ...), the `editorLivePreviewField`
(always source mode) and `editorInfoField` state fields, `renderMath`/`loadMathJax` fallbacks (LaTeX source as text).
Not available: MathJax rendering, live-preview conceal, vim integration, files/vault access.

## Math rendering (`loadMathJax` / `renderMath` / `finishRenderMath`)

- `renderMath(source, display)` returns `span.math.math-inline` / `div.math.math-block` (+ `is-loaded`) containing native
  MathML produced by [Temml](https://temml.org) (MIT). `\class{name}{...}` (used by plugins to mark the cursor or a
  highlight) is the only trusted command; everything else keeps Temml's `trust: false`. The output is re-parsed and
  reduced to MathML elements/attributes (no scripts, handlers, links, `url()` styles).
- Parse errors never throw: the element gets `math-error`, the message as `title`, and the source as text.
- Renders are cached by `display + source` (300 entries, least recently used evicted); each call returns a fresh element.
- Temml and the sanitizer are lazy chunks (`math-impl`, `temml`, `Temml-Local` CSS), fetched by `loadMathJax()` (or
  the first `renderMath()`), so the main bundle does not carry them. If the chunk cannot be loaded the source is shown
  as text and the plugin's report gets a warning ("수식 렌더러(Temml)를 불러오지 못해 …"); a later call retries.
- `finishRenderMath()` is a no-op (the stylesheet is injected once when Temml loads).

### Live preview and concealment (Latex Suite, evidence from its source)
- `editorLivePreviewField` is read in exactly one place: the math-preview tooltip skips *block* math when live preview
  is on (`mathPreviewLivePreviewDisplay` off), because Obsidian already renders block math there. It does **not** gate
  concealment. The shim keeps the field `false`: the task pane is a source-mode editor, and flipping it would make
  plugins assume Obsidian-rendered markdown.
- Concealment is gated by the plugin's own `concealEnabled` setting (default off; command "Toggle conceal"). It needed
  `debounce()` to return a Debouncer with `cancel()`/`run()`; with that, `\alpha + \beta \leq \infty` conceals to
  `α + β ≤ ∞` and reveals near the cursor, in the real Word task pane.

## Settings tabs (`PluginSettingTab` / `Setting`)

- `Plugin.addSettingTab(tab)` registers any number of tabs (none, several, the same tab twice are fine). Each plugin row
  with tabs gets a **설정** button that opens the tab in an in-pane panel (`← 목록` returns, focus goes back to the
  button; `hide()` is called when leaving, on 끄기/삭제, or when the plugin removes the tab). `display()` runs when the panel opens and whenever the plugin calls it again to re-render. A throwing `display()`/`hide()` shows an error
  line in the panel and a warning in the compat report. `app.setting.openTabById(id)` opens the panel for that plugin.
- `Setting`: `setName`, `setDesc` (string or DocumentFragment), `setClass`, `setTooltip`, `setHeading`, `setDisabled`,
  `then`, `clear`, `settingEl/infoEl/nameEl/descEl/controlEl`, `components`, and `addToggle`, `addText`, `addTextArea`,
  `addDropdown` (`addOption`/`addOptions`), `addSlider` (`setLimits`, `setDynamicTooltip`), `addButton`
  (`setButtonText/setCta/setWarning/onClick`), `addExtraButton` (icons are text glyphs), `addColorPicker`, `addSearch`,
  `addMomentFormat` (without `window.moment` the sample shows the format string), `addProgressBar`. Components have the
  chainable Obsidian API (`getValue/setValue/onChange/setPlaceholder/setDisabled/setTooltip`, `inputEl`, ...). The name
  labels (`aria-labelledby`) and the description describes (`aria-describedby`) each control.
- Values flow through the plugin's own `saveData`; the host only supplies controls and callbacks. Exceptions and rejected
  promises from handlers (`onChange`, `onClick`, the `add*` callbacks) are reported via the status line and the plugin's
  compat report warnings (max 8), never swallowed.
- Safety: all strings use `textContent`. DocumentFragments (and `sanitizeHTMLToDom`) are reduced to formatting tags;
  links keep only http(s) `href` and get `target=_blank rel="noopener noreferrer"`; scripts, event handlers, images,
  iframes and unknown attributes are dropped. (A plugin that writes `descEl.innerHTML` itself is running its own code
  anyway; only data going through the Setting API is sanitized.)
- Unknown `addXxx` controls render the row label plus "미지원 컨트롤 (addXxx)"; unknown methods on `Setting` and on
  components are no-ops that keep chaining and are listed (e.g. `Setting.addXxx`, `Setting.TextComponent.foo`) under
  "미지원 API". Raw-DOM tabs (`containerEl.createEl(...)`) and CodeMirror editors created inside the tab work.
- Also added for real plugins: `Component.load/addChild/removeChild`, an i18next stand-in with resource bundles, nested
  keys and interpolation (`addResourceBundle`, `getFixedT`), `sanitizeHTMLToDom`.
- Verified in real Word with Latex Suite 1.14.1 (68 setting rows, 9 sections, 4 embedded CM6 editors, no degraded
  rows): toggle, dropdown and the snippet editor persist across a pane reload and take effect (a new snippet expands).
