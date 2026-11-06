# Word TSF observer experiment

This is development infrastructure for the eventual native host, not an installed product add-in. It observes actual TSF composition on the specified Word UI thread using `ITfThreadMgrEventSink` and `ITfTextEditSink::OnEndEdit`. `ITfContextComposition::EnumCompositions` determines active/idle; missing context, focus outside the native `_WwG` document view, and errors produce unknown. The observer does not read document text or suppress keys. A separate, explicit source-write command now validates and replaces one owned source paragraph; see below.

The launcher checks the exact HWND/PID and `OpusApp` class, loads its adjacent x64 observer DLL, and attaches a thread-specific `WH_GETMESSAGE` bootstrap hook. That callback subscribes to TSF on Word's UI thread without activating a new thread manager. Edit notifications report state changes; one-second snapshots check observer health. There is no per-keystroke Office.js polling. The helper watches foreground changes and has a two-minute experimental lifetime.

The runner owns the synthetic Word document and process, supplies a random run epoch, then signals shutdown. Shutdown unadvises sinks and removes hooks. The DLL is pinned until that Word process exits so late COM callbacks cannot call unloaded code. No registry/add-in registration is added by this observer. The Office.js test harness still performs its own temporary registration as before.

Build with Visual Studio x64 C++ tools and the Windows SDK:

```powershell
powershell.exe -NoProfile -File native/word-ime/build.ps1 -OutputDirectory test-docs/native-ime
npm run test:word -- --body-input-only --native-ime
```

The test command builds into its ignored run directory. It takes foreground and sends real keys: close Word first and avoid other input until it finishes. The ordinary Word suite does not attach this observer. No compiled binaries are committed.

The development transport is append-only JSONL → a read-only local SSE stream → `NativeImeConnection` → `BodySelectionDriver`. Epoch/sequence validation, duplicate rejection, a 2.5-second health timeout and disconnect handling keep uncertain state closed. A broken sequence requires a new connection. Duplicate idle snapshots do not cause Word selection reads.

This asynchronous transport is not an atomic mutation lock: a newly starting composition can race an Office.js batch already submitted to Word. Before a production body editor, the native host must guard mutation on the UI thread, test reconnection/host shutdown and broader IMEs, and package/install the host independently of npm/Pages. The current observer supports this Windows x64 test path only.

API references: [TSF compositions](https://learn.microsoft.com/en-us/windows/win32/tsf/compositions), [ITfTextEditSink](https://learn.microsoft.com/en-us/windows/win32/api/msctf/nn-msctf-itftexteditsink), [TextEdit pattern](https://learn.microsoft.com/en-us/windows/win32/winauto/textedit-control-pattern). External IMM32 and UI Automation TextEdit observation did not provide composition state on the measured Word build; this is a local observation, not a general Word capability claim.


## Checked native source-write primitive

`npm run test:word -- --native-guard-only` builds and tests a source-only write boundary without injecting keys. The native UI callback resolves the exact document and uniquely tagged control, checks its ID, main-body story, text and normalized WordOpenXML, and refuses multiline content, objects, fields, revisions or enabled change tracking. Immediately before its single `Range.Text` put, it rechecks actual TSF state, the observation sequence and a two-second request deadline. The request holds fixed UTF-16 buffers without cross-process pointers. Tests prepare packets in files; the SSE endpoint cannot submit writes.

The existing launcher binds the document path at startup. `--write-source PID epoch packet.bin` can submit only to that already-attached process/run. Results: 0 committed; 1 composing; 2 unknown/focus unavailable; 3 stale observation; 4 identity mismatch; 5 text/XML conflict; 6 unsupported content; 7 expired; 8 COM failure (possibly indeterminate); 20 missing observer; 21 wrong run/stopping; 22 invalid packet; 23 busy; 24 timed out (possibly indeterminate). A pending request can expire/cancel before execution; running or ambiguous mutations must never be replayed.

This primitive has not replaced `WordBodyPort.source/render`, selection handling or recovery journaling. It closes the asynchronous gap for its own checked text call, but does not lock TSF across reentrant Word COM internals or make existing Office.js batches atomic. Full native host integration remains the next step.
