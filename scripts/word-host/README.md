# Desktop Word acceptance tests

Run `npm run test:word` on Windows with Word closed. The runner creates its own synthetic document, starts Word through COM, loads the real source through an HTTPS task pane, runs the cases, closes its document without saving, unregisters its unique test add-in, and stops the server. It does not change the production manifest registration. Do not edit Word during the run.

Prerequisites:

- Installed desktop Word, Node, Python 3.9+, and `npm install` for this repository.
- Trusted Office development certificates at `~/.office-addin-dev-certs/localhost.key` and `localhost.crt`. Use your existing Office development setup; this runner does not install certificates or bypass trust prompts.
- Cached `office-addin-dev-settings` (tested with 4.0.1). If absent, run `npx --yes office-addin-dev-settings@4.0.1 --help` once. The runner finds its template/CLI in the default npm cache. For a custom installation, use `python scripts/word-host/run.py --dev-settings-dir PATH_TO_PACKAGE`.
- Network access to Microsoft's hosted `office.js`.

Results, timing, server logs and the fixture are saved under ignored `test-docs/word-host/<run>/`. `report.md` summarizes the run; `results.jsonl` and `com-results.jsonl` contain the observations. A failed assertion exits unsuccessfully and still attempts cleanup. There are bounded timeouts; a Word/add-in startup failure may need manual cleanup (see `word.log`). The helper PowerShell process remains hidden; Word itself is visible.

The cases cover three repeated mixed-document applies; missing-original refusal before mutation; native equation insertion failure after table/float insertion; optional style failure; undo with/without styles and after failure; a 100-day-old long math-picture source surviving another region's load; and three applies of a synthetic 300-paragraph/30-table/60-equation document.

The fault cases temporarily intercept Office.js setters/method arguments and send a nonexistent style or invalid OOXML to **real Word**. They restore the methods in `finally`. No mock host is used. Undo checks compare text and object counts, not every formatting property. These tests do not establish compatibility with Mac, web Word, arbitrary user documents, or every Office build. The measured large fixture has no ordinary pictures and is not the former 37-page benchmark.

`client.html` is a development-only entry point and is not referenced by the production task pane/build. Commands originate in local files written by the runner; the local HTTPS server has no HTTP command-submission endpoint.
