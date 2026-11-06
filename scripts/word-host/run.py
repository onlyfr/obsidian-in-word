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
    parser.add_argument('--body-input-only', action='store_true', help='Run caret/virtual-key/IME observability probes in an owned Word instance')
    args = parser.parse_args()
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
            word = subprocess.Popen(['powershell.exe', '-NoProfile', '-STA', '-File', str(SCRIPTS / 'word-com.ps1'), '-RunDirectory', str(run)], stdout=word_log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
            wait_result(run, 'js', 'ready', 90, word)
            def case(kind, ident, file):
                result = command(run, kind, ident, (SCRIPTS / 'cases' / file).read_text(encoding='utf-8-sig'), worker=word)
                results.append(result)
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
            if args.body_input_only:
                case('js','setup','setup.js')
                case('js','input-start','input-start.js')
                case('com','input-place','input-place.ps1')
                case('js','input-enter','input-enter.js')
                case('js','input-watch','input-watch.js')
                case('com','input-keys','input-keys.ps1')
                case('js','input-check','input-check.js')
                case('com','input-ime','input-ime.ps1')
                case('js','input-finish','input-finish.js')
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
