"""Run preservation cases in desktop Word through COM + the real Office.js task pane."""
import argparse
import json
import os
import re
from pathlib import Path
import shutil
import socket
import subprocess
import time
import uuid
from zipfile import ZipFile, ZIP_DEFLATED

SCRIPTS = Path(__file__).resolve().parent
REPO = SCRIPTS.parent.parent


def wait_result(directory, kind, ident, timeout=120, worker=None):
    path = directory / ('com-results.jsonl' if kind == 'com' else 'results.jsonl')
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists():
            for line in path.read_text(encoding='utf-8-sig').splitlines():
                try:
                    result = json.loads(line)
                except json.JSONDecodeError:
                    continue  # The writer may be appending the last line.
                if result.get('id') == ident:
                    return result
        if worker is not None and worker.poll() is not None:
            raise RuntimeError(f'Word helper exited with {worker.returncode}; inspect {directory / "word.log"}')
        time.sleep(.25)
    raise TimeoutError(f'No {kind} result for {ident} within {timeout}s; inspect {directory}')


def command(directory, kind, ident, code, timeout=120, worker=None):
    target = directory / ('com-command.json' if kind == 'com' else 'command.json')
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps({'id': ident, 'code': code}), encoding='utf-8')
    os.replace(temp, target)
    result = wait_result(directory, kind, ident, timeout, worker)
    print(f'{ident}: {"PASS" if result["ok"] else "FAIL"}', flush=True)
    if not result['ok']:
        raise RuntimeError(json.dumps(result, ensure_ascii=True))
    return result


def prepare(directory, settings, port):
    guid = str(uuid.uuid4())
    manifest = (REPO / 'manifest.xml').read_text(encoding='utf-8')
    manifest = manifest.replace('6f1d7c52-3b0e-4b6a-9a52-0a1c4f6f7c11', guid)
    manifest = manifest.replace('https://localhost:3000/index.html', f'https://localhost:{port}/scripts/word-host/client.html')
    manifest = manifest.replace('obsidian-in-word (dev)', 'Word preservation acceptance')
    (directory / 'manifest.xml').write_text(manifest, encoding='utf-8')
    template = settings / 'templates/WordDocumentWithTaskPane.docx'
    with ZipFile(template) as src, ZipFile(directory / 'acceptance.docx', 'w', ZIP_DEFLATED) as dest:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename == 'word/webextensions/webextension.xml':
                data = data.decode().replace('00000000-0000-0000-0000-000000000000', guid).replace('1.0.0.0', '0.0.1.0').encode()
            dest.writestr(item, data)


def summarize(directory, results):
    by_id = {r['id']: r for r in results}
    large = by_id['large']['value']
    failure = by_id['failure']['value']
    undo = {label: len(by_id[f'undo-after-{label}']['value']['Steps']) for label in ('style', 'plain', 'fail')}
    summary = {
        'office': by_id['setup']['value']['version'],
        'mixedCycles': len(by_id['repeat']['value']['cycles']),
        'missingRejected': True, 'failedApplyCalls': failure['calls'],
        'failedApplyTableCount': [failure['before']['tables'], failure['after']['tables']],
        'failedApplyFloatCount': [failure['before']['floats'], failure['after']['floats']],
        'unknownStyleNotes': by_id['style']['value']['result']['notes'],
        'undoSteps': undo,
        'retention': by_id['retention']['value'], 'large': large,
        'raster': by_id['raster']['value'],
        'mathOutput': by_id['math-output']['value'],
        'bodyProbe': by_id['body-finish']['value'],
        'bodySession': {name:by_id[name]['value'] for name in ('session-lifecycle','session-after-reopen','session-undo-check','session-redo-check','session-undo-recover','session-delete-check')},
    }
    (directory / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    report = f'''# Native Word acceptance results

Host: Word {summary['office']['version']} ({summary['office']['platform']}).
All cases passed. The runner used a fresh synthetic document and real Office.js calls in desktop Word.

| Case | Result |
| --- | --- |
| Mixed document (table, equation, floating shape, blanks, Quote style) | 3 applies; paragraph text, object counts and markdown stable |
| Missing original | Refused before document/sidecar mutation |
| Equation insertion failure | Native InvalidArgument; float/table/equation scheduled once each; no duplicate table or float |
| Unknown style | Warning; restored objects retained; no retry |
| Undo: normal with style / without style / failed apply | {undo['style']} / {undo['plain']} / {undo['fail']} steps; text and object counts restored |
| 100-day-old long formula in another region | LaTeX retained; editable after reading region B |
| Math raster corpus | {summary['raster']['count']} inline/display samples; baseline PNG comparison: {summary['raster']['compared']} |
| Math output choice | hybrid -> all images -> hybrid; LaTeX and image bytes retained |
| Body source feasibility | One ordinary paragraph enters source on selection and renders edited bold/italic on exit |
| Body session lifecycle | Rapid moves, composition gate, partial-write recovery, actual document reopen, undo/redo and deletion guards |
| Large synthetic document | {large['paragraphs']} Office.js paragraphs, 30 tables, 60 equations; 3 stable applies |

Large load: {large['loadMs']/1000:.2f}s. Apply cycles: {', '.join(f"{c['ms']/1000:.2f}s" for c in large['cycles'])}.
Times are one local run, not a cross-version benchmark. Word COM counts equation paragraphs differently from Office.js.
Undo checks compare body text and table/shape/equation counts, not byte-identical OOXML or every formatting property.
Fault injection changes the arguments sent to real Word; it does not replace the host with a mock.

Full machine-readable observations: `results.jsonl`, `com-results.jsonl`, `summary.json` in this run directory.
'''
    (directory / 'report.md').write_text(report, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dev-settings-dir', type=Path, help='Path to installed office-addin-dev-settings package')
    parser.add_argument('--compare-raster-ref', help='Compare raster dimensions/baseline/PNG bytes with a git commit hash')
    parser.add_argument('--body-session-only', action='store_true', help='Run only experimental body-session lifecycle cases')
    parser.add_argument('--settings-ui-only', action='store_true', help='Run actual task-pane settings tabs/editor/plugin UI checks without keyboard input')
    parser.add_argument('--format-only', action='store_true', help='Run only Markdown formatting round-trip regression cases')
    parser.add_argument('--native-guard-only', action='store_true', help='Build and test the native source-write boundary without keyboard injection')
    parser.add_argument('--native-flow-only', action='store_true', help='Run integrated native body transitions, selection and recovery (no keyboard injection)')
    parser.add_argument('--native-selection-only', action='store_true', help='Run explicit native ownership enrollment and native selection-driven transitions')
    parser.add_argument('--native-format-only', action='store_true', help='Run native typography preservation and Word Undo after response loss (no keys)')
    parser.add_argument('--body-input-only', action='store_true', help='Run caret/virtual-key/IME observability probes in an owned Word instance')
    parser.add_argument('--native-ime', action='store_true', help='Build and attach the experimental x64 TSF observer (requires --body-input-only and Visual Studio C++/SDK)')
    args = parser.parse_args()
    if args.native_ime and not args.body_input_only:
        parser.error('--native-ime requires --body-input-only')
    if os.name != 'nt':
        raise SystemExit('Desktop Word acceptance tests require Windows.')
    if subprocess.run(['tasklist', '/FI', 'IMAGENAME eq WINWORD.EXE', '/NH'], capture_output=True).stdout.find(b'WINWORD.EXE') >= 0:
        raise SystemExit('Close Word before starting. This runner only operates its own synthetic document.')
    for exe in ('node', 'powershell.exe'):
        if not shutil.which(exe):
            raise SystemExit(f'Missing prerequisite: {exe}')
    for name in ('localhost.key', 'localhost.crt'):
        if not (Path.home() / '.office-addin-dev-certs' / name).is_file():
            raise SystemExit('Trusted Office development certificates are required; see scripts/word-host/README.md.')
    cache = Path(os.environ.get('npm_config_cache', str(Path(os.environ['LOCALAPPDATA']) / 'npm-cache')))
    candidates = sorted(cache.glob('_npx/*/node_modules/office-addin-dev-settings'))
    settings = args.dev_settings_dir or (candidates[-1] if candidates else None)
    if not settings or not (settings / 'cli.js').is_file():
        raise SystemExit('Install/cache office-addin-dev-settings first; see scripts/word-host/README.md.')
    run = REPO / 'test-docs/word-host' / (time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6])
    run.mkdir(parents=True)
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    prepare(run, settings, port)
    if args.compare_raster_ref:
        if not re.fullmatch(r'[0-9a-fA-F]{7,40}', args.compare_raster_ref):
            raise SystemExit('--compare-raster-ref must be a git commit hash')
        before = subprocess.run(['git', 'show', args.compare_raster_ref + ':src/convert/mathraster.ts'], cwd=REPO, check=True, capture_output=True).stdout.decode('utf-8')
        before = before.replace('from "./mathimg"', 'from "/src/convert/mathimg"').replace('import("../plugins/math-impl")', 'import("/src/plugins/math-impl")')
        (run / 'baseline-raster.ts').write_text(before, encoding='utf-8')
    manifest = run / 'manifest.xml'
    env = {**os.environ, 'WORD_HOST_RUN_DIR': str(run), 'WORD_HOST_PORT': str(port)}
    if args.native_ime or args.native_guard_only or args.native_flow_only or args.native_selection_only or args.native_format_only:
        output = run / 'native'
        subprocess.run(['powershell.exe', '-NoProfile', '-File', str(REPO / 'native/word-ime/build.ps1'), '-OutputDirectory', str(output)], check=True)
        env['WORD_IME_BRIDGE_EXE'] = str(output / 'word-ime-bridge.exe')
    native_token = uuid.uuid4().hex
    if args.native_flow_only or args.native_selection_only or args.native_format_only:
        env['WORD_BODY_NATIVE_MODE'] = '1'
        env['WORD_BODY_NATIVE_TOKEN'] = native_token
    if args.native_selection_only or args.native_format_only:
        env['WORD_BODY_OWNERSHIP_MODE'] = '1'
    server = word = None
    registered = False
    results = []
    with (run / 'server.log').open('w', encoding='utf-8') as server_log, (run / 'word.log').open('w', encoding='utf-8') as word_log:
        try:
            subprocess.run(['node', str(settings / 'cli.js'), 'register', str(manifest)], check=True)
            registered = True
            server = subprocess.Popen(['node', str(SCRIPTS / 'server.mjs')], cwd=REPO, env=env, stdout=server_log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
            deadline = time.monotonic() + 20
            while not (run / 'server-ready').exists():
                if server.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError(f'HTTPS server failed; inspect {run / "server.log"}')
                time.sleep(.25)
            word = subprocess.Popen(['powershell.exe', '-NoProfile', '-STA', '-File', str(SCRIPTS / 'word-com.ps1'), '-RunDirectory', str(run)], env=env, stdout=word_log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
            wait_result(run, 'js', 'ready', 90, word)
            def case(kind, ident, file):
                result = command(run, kind, ident, (SCRIPTS / 'cases' / file).read_text(encoding='utf-8-sig'), worker=word)
                results.append(result)
                return result
            def native_case(ident, file, prefix=''):
                result = command(run, 'js', ident, 'globalThis.nativeBodyToken=' + json.dumps(native_token) + ';' + prefix + (SCRIPTS / 'cases' / file).read_text(encoding='utf-8'), worker=word)
                results.append(result)
                return result
            def session_cases():
                case('js','session-start','session-start.js')
                case('js','session-lifecycle','session-lifecycle.js')
                case('com','session-reopen','session-reopen.ps1')
                case('js','session-after-reopen','session-after-reopen.js')
                case('com','session-undo-before','undo-before.ps1')
                case('js','session-exit','session-exit.js')
                case('com','session-undo','session-undo.ps1')
                case('js','session-undo-check','session-undo-check.js')
                case('com','session-redo','session-redo.ps1')
                case('js','session-redo-check','session-redo-check.js')
                case('com','session-undo-source','session-undo-source.ps1')
                case('js','session-undo-recover','session-undo-recover.js')
                case('com','session-delete','session-delete.ps1')
                case('js','session-delete-check','session-delete-check.js')
            if args.settings_ui_only:
                case('js','setup','setup.js')
                case('js','settings-ui','settings-ui.js')
                (run/'settings-ui-summary.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
                print(f'Task-pane settings UI passed. Evidence: {run}',flush=True)
                return
            if args.native_format_only:
                case('js','setup','setup.js')
                case('js','native-format-start','native-format-start.js')
                case('com','native-format-prepare','native-format-prepare.ps1')
                case('com','native-ime-start','native-ime-start.ps1')
                native_case('native-format-claim','native-format-claim.js')
                for cycle in range(2):
                    case('com',f'native-format-place-{cycle}','native-format-place.ps1')
                    native_case(f'native-format-enter-{cycle}','native-format-enter.js')
                    case('com',f'native-format-outside-{cycle}','native-selection-outside.ps1')
                    native_case(f'native-format-exit-{cycle}','native-format-exit.js')
                    case('com',f'native-format-check-{cycle}','native-format-check.ps1')
                case('com','native-format-place-edit','native-format-place.ps1')
                native_case('native-format-enter-edit','native-format-enter.js')
                case('com','native-format-edit','native-format-edit.ps1')
                native_case('native-format-lost-render','native-format-lost-render.js')
                case('com','native-format-undo-redo-render','native-format-undo-redo-render.ps1')
                case('com','native-format-check-edit','native-format-check.ps1')
                case('com','native-format-place-fault','native-format-place.ps1')
                native_case('native-format-fault-entry','native-format-fault-entry.js')
                case('com','native-format-undo-fault','native-format-undo-entry.ps1')
                case('com','native-format-check-undo-fault','native-format-check.ps1')
                case('com','native-format-place-lost','native-format-place.ps1')
                native_case('native-format-lost-entry','native-format-lost-entry.js')
                case('com','native-format-undo-entry','native-format-undo-entry.ps1')
                case('com','native-format-check-undo','native-format-check.ps1')
                (run/'native-format-summary.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
                print(f'Native typography and Word Undo cases passed. Evidence: {run}',flush=True)
                return
            if args.native_selection_only:
                case('js','setup','setup.js')
                case('js','native-selection-start','native-selection-start.js')
                case('com','native-selection-first','native-selection-first.ps1')
                case('com','native-ime-start','native-ime-start.ps1')
                native_case('native-selection-claim','native-selection-claim.js')
                case('com','native-selection-second','native-selection-second.ps1')
                native_case('native-selection-enroll-second','native-selection-second.js')
                native_case('native-selection-race-start','native-selection-race-start.js')
                case('com','native-selection-race-leave-b','native-selection-first.ps1')
                native_case('native-selection-race-wait','native-selection-race-wait.js')
                case('com','native-selection-race-return-b','native-selection-second.ps1')
                native_case('native-selection-race-finish','native-selection-race-finish.js')
                case('com','native-selection-rapid','native-selection-rapid.ps1')
                native_case('native-selection-latest','native-selection-rapid.js')
                case('com','native-selection-outside','native-selection-outside.ps1')
                native_case('native-selection-rendered','native-selection-rendered.js')
                case('com','native-selection-foreign','native-selection-foreign.ps1')
                native_case('native-selection-reject-foreign','native-selection-reject.js')
                case('com','native-selection-colored','native-selection-colored.ps1')
                native_case('native-selection-reject-color','native-selection-reject.js')
                case('com','native-selection-list','native-selection-list.ps1')
                native_case('native-selection-reject-list','native-selection-reject.js')
                case('com','native-selection-integrity','native-selection-integrity.ps1')
                native_case('native-selection-cache','native-selection-cache.js')
                tamper=case('com','native-selection-tamper','native-selection-tamper.ps1')
                native_case('native-selection-reject-identity','native-selection-conflict.js','globalThis.selectionConflictCode=12;selectionConflictChange.expected='+json.dumps(tamper['value'])+';')
                case('com','native-selection-copy','native-selection-copy.ps1')
                native_case('native-selection-reject-copy','native-selection-conflict.js','globalThis.selectionConflictCode=4;')
                case('com','native-selection-remove-copy','native-selection-remove-copy.ps1')
                case('com','native-selection-reopen','native-flow-reopen.ps1')
                native_case('native-selection-reopened','native-selection-reopened.js')
                case('com','native-selection-first-again','native-selection-first.ps1')
                native_case('native-selection-after-reopen','native-selection-after-reopen.js')
                case('com','native-selection-outside-again','native-selection-outside.ps1')
                native_case('native-selection-rendered-again','native-selection-rendered.js')
                case('com','native-selection-delete','native-selection-delete.ps1')
                native_case('native-selection-deleted','native-selection-deleted.js')
                (run/'native-selection-summary.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
                print(f'Native ownership and selection cases passed. Evidence: {run}',flush=True)
                return
            if args.native_flow_only:
                case('js','setup','setup.js')
                case('js','input-start','input-start.js')
                case('com','input-place','input-place.ps1')
                case('com','native-ime-start','native-ime-start.ps1')
                native_case('native-flow-enter','native-flow-enter.js')
                case('com','native-flow-edit','native-flow-edit.ps1')
                native_case('native-flow-exit','native-flow-exit.js')
                case('com','native-flow-check','native-flow-check.ps1')
                case('com','native-flow-undo','native-flow-undo.ps1')
                native_case('native-flow-undo-check','native-flow-undo-check.js')
                case('com','native-flow-redo','native-flow-redo.ps1')
                for i in range(3):
                    case('com',f'native-cycle-place-{i}','native-flow-place.ps1')
                    native_case(f'native-cycle-enter-{i}','native-flow-cycle.js')
                    case('com',f'native-cycle-outside-{i}','native-flow-outside.ps1')
                    native_case(f'native-cycle-exit-{i}','native-flow-exit.js')
                    case('com',f'native-cycle-check-{i}','native-flow-check.ps1')
                for stage in (1,2,3):
                    case('com',f'native-fault-place-{stage}','native-flow-place.ps1')
                    native_case(f'native-recovery-{stage}','native-flow-recovery.js',f'globalThis.nativeFaultStage={stage};')
                case('com','native-closing-place','native-flow-place.ps1')
                native_case('native-closing-entry','native-flow-save-source.js')
                case('com','native-closing-outside','native-flow-outside.ps1')
                native_case('native-closing-recovery','native-flow-closing-recovery.js')
                case('com','native-reopen-place','native-flow-place.ps1')
                saved = native_case('native-save-source','native-flow-save-source.js')
                case('com','native-reopen','native-flow-reopen.ps1')
                native_case('native-after-reopen','native-flow-after-reopen.js','globalThis.nativeOldSnapshot=' + json.dumps(saved['value']['snapshot']) + ';')
                case('com','native-unicode-entry-place','native-flow-place.ps1')
                native_case('native-unicode-entry','native-flow-save-source.js')
                case('com','native-unicode-edit','native-flow-unicode-edit.ps1')
                native_case('native-unicode-render','native-flow-unicode-render.js')
                case('com','native-unicode-place','native-flow-unicode-place.ps1')
                native_case('native-unicode-source','native-flow-unicode-source.js')
                case('com','native-unicode-outside','native-flow-outside.ps1')
                native_case('native-unicode-final-render','native-flow-unicode-render.js')
                case('com','native-unicode-check','native-flow-check.ps1')
                (run/'native-flow-summary.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
                print(f'Native body transitions passed. Evidence: {run}',flush=True)
                return
            if args.native_guard_only:
                case('js','setup','setup.js')
                case('js','input-start','input-start.js')
                case('com','input-place','input-place.ps1')
                case('js','input-enter','input-enter.js')
                case('com','native-ime-start','native-ime-start.ps1')
                case('com','native-guard-check','native-guard-check.ps1')
                (run/'guard-summary.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
                print(f'Native source-write guard passed. Evidence: {run}',flush=True)
                return
            if args.format_only:
                case('js','setup','setup.js')
                case('js','format-roundtrip','format-roundtrip.js')
                (run/'format-summary.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
                print(f'Formatting round trips passed. Evidence: {run}',flush=True)
                return
            if args.body_input_only:
                case('js','setup','setup.js')
                case('js','input-start','input-start.js')
                case('com','input-place','input-place.ps1')
                case('js','input-enter','input-enter.js')
                case('js','input-watch','input-watch.js')
                if args.native_ime:
                    native_start = case('com','native-ime-start','native-ime-start.ps1')
                    results.append(command(run, 'js', 'native-ime-connect', 'globalThis.nativeEpoch=' + json.dumps(native_start['value']['Epoch']) + ';' + (SCRIPTS / 'cases/native-ime-connect.js').read_text(encoding='utf-8'), worker=word))
                case('com','input-keys','input-keys.ps1')
                case('js','input-check','input-check.js')
                case('com','input-ime','input-ime.ps1')
                if args.native_ime:
                    case('js','native-ime-typed','native-ime-typed.js')
                    case('com','native-ime-leave','native-ime-leave.ps1')
                case('js','native-ime-finish' if args.native_ime else 'input-finish','native-ime-finish.js' if args.native_ime else 'input-finish.js')
                case('com','input-range-place','input-range-place.ps1')
                case('js','input-range-check','input-range-check.js')
                case('js','input-unicode-start','input-unicode-start.js')
                case('com','input-unicode-place','input-unicode-place.ps1')
                case('js','input-unicode-check','input-unicode-check.js')
                (run/'input-summary.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
                print(f'Input probes completed. Inspect IME observability separately: {run}',flush=True)
                return
            if args.body_session_only:
                case('js','setup','setup.js')
                session_cases()
                (run/'session-summary.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
                print(f'Body session cases passed. Evidence: {run}',flush=True)
                return
            case('js', 'setup', 'setup.js')
            case('com', 'add-float', 'add-float.ps1')
            case('js', 'repeat', 'repeat.js')
            case('js', 'missing', 'missing.js')
            case('js', 'style', 'style.js')
            case('js', 'repair', 'repair.js')
            case('com', 'undo-before-style', 'undo-before.ps1')
            case('js', 'change-style', 'change.js')
            case('com', 'undo-after-style', 'undo-after.ps1')
            case('com', 'undo-before-fail', 'undo-before.ps1')
            case('js', 'failure', 'failure.js')
            case('com', 'undo-after-fail', 'undo-after.ps1')
            case('js', 'no-style', 'no-style.js')
            case('com', 'undo-before-plain', 'undo-before.ps1')
            case('js', 'change-plain', 'change-no-style.js')
            case('com', 'undo-after-plain', 'undo-after.ps1')
            case('js', 'retention', 'retention.js')
            if args.compare_raster_ref:
                url = '/test-docs/word-host/' + run.name + '/baseline-raster.ts'
                command(run, 'js', 'raster-reference', 'globalThis.rasterBaselineUrl=' + json.dumps(url) + '; return true;')
            case('js', 'raster', 'raster.js')
            case('js', 'large', 'large.js')
            case('js', 'math-output', 'math-output.js')
            case('js', 'format-roundtrip', 'format-roundtrip.js')
            case('js', 'body-start', 'body-start.js')
            case('com', 'body-enter', 'body-enter.ps1')
            case('js', 'body-source', 'body-source.js')
            case('com', 'body-edit-exit', 'body-edit-exit.ps1')
            case('js', 'body-finish', 'body-finish.js')
            session_cases()
            summarize(run, results)
            print(f'All Word acceptance cases passed. Report: {run / "report.md"}', flush=True)
        finally:
            if word is not None and word.poll() is None:
                try:
                    command(run, 'com', 'close', '$true', 15)
                    word.wait(timeout=20)
                except Exception as error:
                    print(f'Word cleanup needs attention: {error}', flush=True)
            if server is not None:
                server.terminate()
                server.wait(timeout=10)
            if registered:
                subprocess.run(['node', str(settings / 'cli.js'), 'unregister', str(manifest)], check=True)


if __name__ == '__main__':
    main()
