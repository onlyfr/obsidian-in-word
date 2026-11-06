# Desktop Word acceptance tests

Run `npm run test:word` on Windows with Word closed. The runner creates its own synthetic document, starts Word through COM, loads the real source through an HTTPS task pane, runs the cases, closes its document without saving, unregisters its unique test add-in, and stops the server. It does not change the production manifest registration. Do not edit Word during the run.

Prerequisites:

- Installed desktop Word, Node, Python 3.9+, and `npm install` for this repository.
- Trusted Office development certificates at `~/.office-addin-dev-certs/localhost.key` and `localhost.crt`. Use your existing Office development setup; this runner does not install certificates or bypass trust prompts.
- Cached `office-addin-dev-settings` (tested with 4.0.1). If absent, run `npx --yes office-addin-dev-settings@4.0.1 --help` once. The runner finds its template/CLI in the default npm cache. For a custom installation, use `python scripts/word-host/run.py --dev-settings-dir PATH_TO_PACKAGE`.
- Network access to Microsoft's hosted `office.js`.

Results, timing, server logs and the fixture are saved under ignored `test-docs/word-host/<run>/`. `report.md` summarizes the run; `results.jsonl` and `com-results.jsonl` contain the observations. A failed assertion exits unsuccessfully and still attempts cleanup. There are bounded timeouts; a Word/add-in startup failure may need manual cleanup (see `word.log`). The helper PowerShell process remains hidden; Word itself is visible.

The cases cover three repeated mixed-document applies; missing-original refusal before mutation; native equation insertion failure after table/float insertion; optional style failure; undo with/without styles and after failure; a 100-day-old long math-picture source surviving another region's load; 12 inline/display raster samples; and three applies of a synthetic 300-paragraph/30-table/60-equation document.

For raster regressions, `npm run test:word -- --compare-raster-ref 8f21f46` also renders the corpus with that commit's `mathraster.ts` in the same Word browser and compares dimensions, baseline and PNG bytes exactly. The argument must be a commit hash available locally. The runner copies only that source file into the ignored run directory and rewrites its two imports to use the current math image helpers/Temml renderer. This compares raster layout/DOM assembly under the same dependencies, not whole historical application versions. Without the option, the corpus checks rendering and PNG output without a historical comparison.

The fault cases temporarily intercept Office.js setters/method arguments and send a nonexistent style or invalid OOXML to **real Word**. They restore the methods in `finally`. No mock host is used. Undo checks compare text and object counts, not every formatting property. These tests do not establish compatibility with Mac, web Word, arbitrary user documents, or every Office build. The measured large fixture has no ordinary pictures and is not the former 37-page benchmark.

Additional cases switch hybrid math -> all images -> hybrid, checking LaTeX/display flags, cached PNG bytes and stable paragraph counts. A development-only body-editing probe wraps one ordinary paragraph in a content control and uses `Office.EventType.DocumentSelectionChanged`: entering exposes Markdown in the Word body, a COM text edit changes the source, and leaving renders bold/italic again. It checks two transitions without a feedback loop and removes the handler. This is a feasibility experiment, not a production editor. IME input, arbitrary paragraphs/objects, rapid moves, undo, document reload and coauthoring are not covered by that probe.

`client.html` is a development-only entry point and is not referenced by the production task pane/build. Commands originate in local files written by the runner; the local HTTPS server has no HTTP command-submission endpoint.
