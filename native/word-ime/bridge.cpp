// Development-only TSF observer and checked body transitions. No key suppression or add-in registration.
#include <windows.h>
#include <msctf.h>
#include <wrl/client.h>
#include <fstream>
#include <string>
using Microsoft::WRL::ComPtr;
#include "write-command.h"
#include "body-transition.h"

struct Config {
    HWND window; wchar_t output[1024], epoch[80], documentPath[1024]; volatile LONG stop, detached, sequence;
    volatile LONG writeState, writeResult, writeKind; ULONGLONG writeDeadline; SourceWrite write; BodyTransition transition;
};
constexpr WPARAM marker = 0x4f574249;
std::wstring mappingName(DWORD pid) { return L"Local\\OwbWordIme-" + std::to_wstring(pid); }

#ifdef IME_OBSERVER_DLL
Config* config = nullptr;
HANDLE mapping = nullptr;
long sequence = 0;
int lastState = -2;
LONG observerDepth = 0;
struct ObserverCall {ObserverCall(){++observerDepth;} ~ObserverCall(){--observerDepth;}};
void publish(int state, HRESULT hr = S_OK, bool force = false, const char* cause = "refresh") {
    if (!config || (state == lastState && !force)) return;
    lastState = state;
    std::ofstream file(config->output, std::ios::app);
    std::string epoch;
    for (const wchar_t* p = config->epoch; *p; ++p) epoch.push_back(static_cast<char>(*p));
    file << "{\"epoch\":\"" << epoch << "\",\"seq\":" << ++sequence
         << ",\"state\":\"" << (state < 0 ? "unknown" : state ? "active" : "idle")
         << "\",\"hr\":" << hr << ",\"cause\":\"" << cause << "\"}" << std::endl;
    InterlockedExchange(&config->sequence, sequence);
}

class Observer final : public ITfThreadMgrEventSink, public ITfTextEditSink {
    LONG refs = 1;
    ComPtr<ITfThreadMgr> manager;
    ComPtr<ITfSource> managerSource, contextSource;
    ComPtr<ITfContext> context;
    DWORD managerCookie = TF_INVALID_COOKIE, contextCookie = TF_INVALID_COOKIE;
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** result) override {
        if (!result) return E_POINTER;
        *result = nullptr;
        if (iid == IID_IUnknown || iid == IID_ITfThreadMgrEventSink) *result = static_cast<ITfThreadMgrEventSink*>(this);
        else if (iid == IID_ITfTextEditSink) *result = static_cast<ITfTextEditSink*>(this);
        else return E_NOINTERFACE;
        AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs); }
    ULONG STDMETHODCALLTYPE Release() override { auto n = InterlockedDecrement(&refs); if (!n) delete this; return n; }
    HRESULT start() {
        ObserverCall call;
        HRESULT hr = CoCreateInstance(CLSID_TF_ThreadMgr, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&manager));
        if (SUCCEEDED(hr)) hr = manager.As(&managerSource);
        if (SUCCEEDED(hr)) hr = managerSource->AdviseSink(IID_ITfThreadMgrEventSink, static_cast<ITfThreadMgrEventSink*>(this), &managerCookie);
        if (SUCCEEDED(hr)) refresh(); else publish(-1, hr);
        return hr;
    }
    void detachContext() {
        if (contextSource && contextCookie != TF_INVALID_COOKIE) contextSource->UnadviseSink(contextCookie);
        contextCookie = TF_INVALID_COOKIE; contextSource.Reset(); context.Reset();
    }
    void stop() {
        detachContext();
        if (managerSource && managerCookie != TF_INVALID_COOKIE) managerSource->UnadviseSink(managerCookie);
        managerCookie = TF_INVALID_COOKIE; managerSource.Reset(); manager.Reset(); publish(-1);
    }
    void refresh(bool force = false) {
        ObserverCall call;
        ComPtr<ITfDocumentMgr> doc; ComPtr<ITfContext> next;
        HRESULT hr = manager->GetFocus(&doc);
        if (SUCCEEDED(hr) && doc) hr = doc->GetTop(&next);
        if (FAILED(hr) || !next) { detachContext(); publish(-1, FAILED(hr) ? hr : E_FAIL, force); return; }
        // COM identity, rather than an untrusted address from another process.
        ComPtr<IUnknown> oldIdentity, newIdentity;
        if (context) context.As(&oldIdentity);
        next.As(&newIdentity);
        if (oldIdentity.Get() != newIdentity.Get()) {
            detachContext(); context = next;
            hr = context.As(&contextSource);
            if (SUCCEEDED(hr)) hr = contextSource->AdviseSink(IID_ITfTextEditSink, static_cast<ITfTextEditSink*>(this), &contextCookie);
        }
        if (FAILED(hr) || contextCookie == TF_INVALID_COOKIE) { publish(-1, FAILED(hr) ? hr : E_FAIL, force); return; }
        sample(force);
    }
    void sample(bool force = false, const char* cause = "refresh") {
        ObserverCall call;
        HWND foreground = GetForegroundWindow();
        GUITHREADINFO gui{sizeof(GUITHREADINFO)};
        GetGUIThreadInfo(GetCurrentThreadId(), &gui);
        wchar_t cls[64]{}; GetClassNameW(gui.hwndFocus, cls, 64);
        // Refuse task-pane/ribbon focus and other Word windows. This experiment targets the native document view only.
        if (GetAncestor(foreground, GA_ROOT) != GetAncestor(config->window, GA_ROOT) || wcscmp(cls, L"_WwG") != 0) { publish(-1, S_OK, force); return; }
        ComPtr<ITfContextComposition> compositions; ComPtr<IEnumITfCompositionView> items;
        HRESULT hr = context.As(&compositions);
        if (SUCCEEDED(hr)) hr = compositions->EnumCompositions(&items);
        if (FAILED(hr)) { publish(-1, hr, force); return; }
        ComPtr<ITfCompositionView> item; ULONG fetched = 0;
        hr = items->Next(1, &item, &fetched);
        publish(FAILED(hr) ? -1 : fetched ? 1 : 0, hr, force, cause);
    }
    HRESULT STDMETHODCALLTYPE OnEndEdit(ITfContext*, TfEditCookie, ITfEditRecord*) override { sample(false, "edit"); return S_OK; }
    HRESULT STDMETHODCALLTYPE OnSetFocus(ITfDocumentMgr*, ITfDocumentMgr*) override { refresh(); return S_OK; }
    HRESULT STDMETHODCALLTYPE OnPushContext(ITfContext*) override { refresh(); return S_OK; }
    HRESULT STDMETHODCALLTYPE OnPopContext(ITfContext*) override { refresh(); return S_OK; }
    HRESULT STDMETHODCALLTYPE OnInitDocumentMgr(ITfDocumentMgr*) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE OnUninitDocumentMgr(ITfDocumentMgr*) override { refresh(); return S_OK; }
};
Observer* observer = nullptr;
void guardedSourceWrite() {
    LONG result = 8;
    try {
        if (GetTickCount64() > config->writeDeadline) throw GuardFailure{7};
        observer->refresh();
        if (lastState != 0) throw GuardFailure{lastState == 1 ? 1L : 2L};
        Dispatch range = checkedSourceRange(config->window, config->documentPath, config->write);
        StringArgument replacement(config->write.replacement);
        // Native boundary: resolve everything first, then check real TSF and the observation generation again.
        observer->refresh();
        if (lastState != 0) throw GuardFailure{lastState == 1 ? 1L : 2L};
        if (config->write.expectedSequence != sequence) throw GuardFailure{3};
        if (GetTickCount64() > config->writeDeadline) throw GuardFailure{7};
        VARIANT value = range.call(L"Text", DISPATCH_PROPERTYPUT, &replacement.value, 1); VariantClear(&value);
        result = 0;
    } catch (const GuardFailure& failure) { result = failure.result; }
      catch (...) { result = 8; }
    InterlockedExchange(&config->writeResult, result);
    InterlockedExchange(&config->writeState, 3);
}
void requireIdle() {
    if (GetTickCount64() > config->writeDeadline) throw GuardFailure{7};
    observer->refresh();
    if (lastState != 0) throw GuardFailure{lastState == 1 ? 1L : 2L};
}
void guardedBodyTransition() {
    LONG result = 8;
    try {
        const auto& request = config->transition;
        if (!validTransition(request)) throw GuardFailure{6};
        const auto key = blockKey(request.source);
        validateJournal(request.pendingJournal, key); validateJournal(request.completeJournal, key);
        if (request.mode == 2) validateRender(request.renderXml);
        const auto runs = request.mode == 2 ? renderRuns(request.renderXml) : std::vector<NativeRun>{};
        std::wstring rendered; for (const auto& run : runs) rendered += run.text;
        if (rendered.size() > 4000 || rendered.find_first_of(L"\r\n\t\v\f") != std::wstring::npos) throw GuardFailure{6};
        requireIdle();
        auto target = checkedBody(config->window, config->documentPath, request.source, true);
        auto part = journalPart(target.doc, request, key);
        if (target.selection.number(L"StoryType") != 1 || target.selection.number(L"Start") != request.selectionStart || target.selection.number(L"End") != request.selectionEnd) throw GuardFailure{10};
        if (request.mode == 1 && (request.selectionStart < target.range.number(L"Start") || request.selectionEnd > target.range.number(L"End")
            || request.caretStart < 0 || request.caretEnd < request.caretStart || request.caretEnd > static_cast<LONG>(wcslen(request.source.replacement)))) throw GuardFailure{10};
        requireIdle();
        if (request.source.expectedSequence != sequence) throw GuardFailure{3};
        UndoScope undo(target.doc);
        storeJournal(part,target.doc,request.pendingJournal);
        if (request.failAt == 1) throw GuardFailure{9};
        if (request.mode != 3) {
            requireIdle();
            if (request.mode == 1) setText(target.range,L"Text",request.source.replacement);
            else setText(target.range,L"Text",rendered.c_str());
            storeJournal(part,target.doc,stageJournal(request.pendingJournal,L"content"));
            if (request.failAt == 2) throw GuardFailure{9};
            requireIdle();
            auto content = target.control.child(L"Range");
            if (content.child(L"Paragraphs").number(L"Count") != 1) throw GuardFailure{6};
            if (request.mode == 1) invoke(content.child(L"Font"),L"Reset");
            else {
                VARIANT index{}; index.vt = VT_I4; index.lVal = 1;
                setText(content.child(L"Paragraphs").child(L"Item",&index,1),L"Style",request.style);
                invoke(content.child(L"Font"),L"Reset");
                LONG position = content.number(L"Start");
                for (const auto& run : runs) {
                    if (run.text.empty()) continue;
                    auto segment = content.child(L"Duplicate");
                    setNumber(segment,L"Start",position); position += static_cast<LONG>(run.text.size()); setNumber(segment,L"End",position);
                    auto font = segment.child(L"Font");
                    requireIdle(); setNumber(font,L"Bold",run.bold ? -1 : 0);
                    requireIdle(); setNumber(font,L"Italic",run.italic ? -1 : 0);
                    requireIdle(); setNumber(font,L"StrikeThrough",run.strike ? -1 : 0);
                    if (run.code) {requireIdle();setText(font,L"Name",L"Consolas");}
                }
            }
            const auto nextTag = L"owb-body:v1:" + key + (request.mode == 1 ? L":source" : L":rendered");
            setText(target.control,L"Tag",nextTag.c_str());
            storeJournal(part,target.doc,stageJournal(request.pendingJournal,L"tagged"));
            if (request.failAt == 3) throw GuardFailure{9};
            requireIdle();
            if (request.mode == 1) {
                auto selection = target.control.child(L"Range"); LONG start = selection.number(L"Start");
                setNumber(selection,L"Start",start + request.caretStart); setNumber(selection,L"End",start + request.caretEnd); invoke(selection,L"Select");
            } else invoke(target.selection,L"Select");
        }
        requireIdle(); storeJournal(part,target.doc,request.completeJournal);
        result = 0;
    } catch (const GuardFailure& failure) {
        result = failure.result;
        std::wofstream error(std::wstring(config->output) + L".errors", std::ios::app);
        error << L"result=" << failure.result << L" hr=" << failure.hr << L" member=" << (failure.member ? failure.member : L"guard") << std::endl;
    }
      catch (...) { result = 8; }
    InterlockedExchange(&config->writeResult,result); InterlockedExchange(&config->writeState,3);
}
extern "C" __declspec(dllexport) LRESULT CALLBACK ImeHook(int code, WPARAM wp, LPARAM lp) {
    if (code >= 0 && wp == PM_REMOVE) {
        auto message = reinterpret_cast<MSG*>(lp);
        if (message->message == WM_NULL && message->wParam == marker) {
            if (!config) {
                mapping = OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, mappingName(GetCurrentProcessId()).c_str());
                if (mapping) config = static_cast<Config*>(MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(Config)));
                if (config) {
                    if (config->stop) {
                        InterlockedExchange(&config->detached,1); UnmapViewOfFile(config); CloseHandle(mapping); config=nullptr; mapping=nullptr;
                        return CallNextHookEx(nullptr,code,wp,lp);
                    }
                    // Keep callback code valid even if shutdown cannot unadvise a busy host. Unloaded when this Word exits.
                    HMODULE module; GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN, reinterpret_cast<LPCWSTR>(&ImeHook), &module);
                    observer = new Observer(); observer->start();
                }
            }
            if (config && observer) {
                if (config->stop) {
                    // A COM call can pump messages. Do not release callback state under an executing write.
                    if (config->writeState != 2 && observerDepth == 0) {
                        observer->stop(); observer->Release(); observer = nullptr;
                        InterlockedExchange(&config->detached, 1);
                        UnmapViewOfFile(config); CloseHandle(mapping); config = nullptr; mapping = nullptr; sequence = 0; lastState = -2;
                    }
                }
                else if (InterlockedCompareExchange(&config->writeState, 2, 1) == 1) { if (config->writeKind == 1) guardedBodyTransition(); else guardedSourceWrite(); }
                else observer->refresh(true); // bootstrap, focus change or one-second health snapshot; edits use OnEndEdit.
            }
        }
    }
    return CallNextHookEx(nullptr, code, wp, lp);
}
#else
HWND targetWindow = nullptr;
void CALLBACK foregroundChanged(HWINEVENTHOOK, DWORD, HWND, LONG, LONG, DWORD, DWORD) { PostMessageW(targetWindow, WM_NULL, marker, 0); }
int wmain(int argc, wchar_t** argv) {
    if (argc == 5 && (wcscmp(argv[1], L"--write-source") == 0 || wcscmp(argv[1], L"--body-transition") == 0)) {
        const bool transition = wcscmp(argv[1], L"--body-transition") == 0;
        DWORD pid = wcstoul(argv[2], nullptr, 10);
        HANDLE shared = OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, mappingName(pid).c_str()); if (!shared) return 20;
        auto config = static_cast<Config*>(MapViewOfFile(shared, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(Config)));
        if (!config || wcscmp(config->epoch, argv[3]) != 0 || config->stop) return 21;
        auto body = std::make_unique<BodyTransition>(); SourceWrite request{}; std::ifstream input(argv[4], std::ios::binary);
        if (transition) { input.read(reinterpret_cast<char*>(body.get()), sizeof(BodyTransition)); if (input.gcount() != sizeof(BodyTransition) || !validTransition(*body)) return 22; }
        else { input.read(reinterpret_cast<char*>(&request), sizeof(request)); if (input.gcount() != sizeof(request) || !validWrite(request)) return 22; }
        if (InterlockedCompareExchange(&config->writeState, -1, 0) != 0) return 23;
        config->writeKind = transition ? 1 : 0;
        if (transition) { config->transition = *body; if (!body->source.expectedSequence) config->transition.source.expectedSequence = config->sequence; }
        else { config->write = request; if (!request.expectedSequence) config->write.expectedSequence = config->sequence; }
        config->writeDeadline = GetTickCount64() + (transition ? 5000 : 2000);
        InterlockedExchange(&config->writeState, 1); PostMessageW(config->window, WM_NULL, marker, 0);
        while (config->writeState != 3 && GetTickCount64() < config->writeDeadline + 500) Sleep(10);
        if (config->writeState == 3) { LONG result = config->writeResult; InterlockedExchange(&config->writeState, 0); UnmapViewOfFile(config); CloseHandle(shared); return static_cast<int>(result); }
        // Cancel only before execution. A running/indeterminate native mutation is never replayed.
        InterlockedCompareExchange(&config->writeState, 0, 1); return 24;
    }
    // Exact HWND, its PID, output, stop file, random run epoch.
    if (argc != 7) return 2;
    if (!*argv[5]) return 2;
    for (const wchar_t* p = argv[5]; *p; ++p) if (!((*p >= L'0' && *p <= L'9') || (*p >= L'a' && *p <= L'z') || *p == L'-')) return 2;
    targetWindow = reinterpret_cast<HWND>(_wcstoui64(argv[1], nullptr, 10));
    DWORD pid = 0; DWORD thread = GetWindowThreadProcessId(targetWindow, &pid);
    if (!thread || pid != wcstoul(argv[2], nullptr, 10)) return 3;
    wchar_t cls[64]{}; GetClassNameW(targetWindow, cls, 64);
    if (wcscmp(cls, L"OpusApp") != 0) return 4;
    HANDLE mapping = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0, sizeof(Config), mappingName(pid).c_str());
    if (!mapping || GetLastError() == ERROR_ALREADY_EXISTS) return 5;
    auto config = static_cast<Config*>(MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(Config)));
    if (!config) return 6;
    config->window = targetWindow;
    if (wcscpy_s(config->output, argv[3]) || wcscpy_s(config->epoch, argv[5])) return 7;
    if (wcscpy_s(config->documentPath, argv[6])) return 7;
    // DLL lives next to the executable; never search PATH or load an arbitrary command argument.
    wchar_t executable[MAX_PATH]; GetModuleFileNameW(nullptr, executable, MAX_PATH);
    std::wstring dllPath(executable); dllPath = dllPath.substr(0, dllPath.find_last_of(L"\\/") + 1) + L"word-ime-observer.dll";
    HMODULE dll = LoadLibraryExW(dllPath.c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (!dll) return 8;
    auto callback = reinterpret_cast<HOOKPROC>(GetProcAddress(dll, "ImeHook"));
    HHOOK hook = callback ? SetWindowsHookExW(WH_GETMESSAGE, callback, dll, thread) : nullptr;
    if (!hook) return 9;
    HWINEVENTHOOK focusHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr, foregroundChanged, 0, 0, WINEVENT_OUTOFCONTEXT);
    if (!focusHook) { UnhookWindowsHookEx(hook); return 10; }
    HANDLE process = OpenProcess(SYNCHRONIZE, FALSE, pid);
    ULONGLONG deadline = GetTickCount64() + 300000, nextHealth = 0;
    while (GetTickCount64() < deadline && IsWindow(targetWindow) && GetFileAttributesW(argv[4]) == INVALID_FILE_ATTRIBUTES) {
        if (process && WaitForSingleObject(process, 0) == WAIT_OBJECT_0) break;
        if (GetTickCount64() >= nextHealth) { PostMessageW(targetWindow, WM_NULL, marker, 0); nextHealth = GetTickCount64() + 1000; }
        MSG msg; while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
        MsgWaitForMultipleObjects(0, nullptr, FALSE, 50, QS_ALLINPUT);
    }
    InterlockedExchange(&config->stop, 1); PostMessageW(targetWindow, WM_NULL, marker, 0);
    auto cleanupDeadline = GetTickCount64() + 3000;
    while (!config->detached && IsWindow(targetWindow) && GetTickCount64() < cleanupDeadline) {PostMessageW(targetWindow,WM_NULL,marker,0);Sleep(20);}
    UnhookWinEvent(focusHook); UnhookWindowsHookEx(hook);
    if (process) CloseHandle(process);
    UnmapViewOfFile(config); CloseHandle(mapping); FreeLibrary(dll);
    return 0;
}
#endif
