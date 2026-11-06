#pragma once
#include <oleacc.h>
#include <regex>
#include <vector>

// Fixed UTF-16 test protocol. No pointers cross the process boundary; all buffers are validated before use.
struct SourceWrite {
    LONG expectedSequence, caretReserved;
    wchar_t tag[128], controlId[32], expected[4001], replacement[4001], xml[262144];
};
struct GuardFailure { LONG result; HRESULT hr = S_OK; const wchar_t* member = nullptr; };
struct Dispatch {
    ComPtr<IDispatch> object;
    Dispatch() = default;
    explicit Dispatch(IDispatch* value) : object(value) {}
    VARIANT call(const wchar_t* name, WORD flags = DISPATCH_PROPERTYGET, VARIANT* args = nullptr, UINT count = 0) const {
        LPOLESTR member = const_cast<LPOLESTR>(name); DISPID id;
        if (!object) throw GuardFailure{8,E_POINTER,name};
        HRESULT lookup = object->GetIDsOfNames(IID_NULL, &member, 1, LOCALE_USER_DEFAULT, &id);
        if (FAILED(lookup)) throw GuardFailure{8,lookup,name};
        DISPID put = DISPID_PROPERTYPUT;
        DISPPARAMS params{args, flags == DISPATCH_PROPERTYPUT ? &put : nullptr, count, flags == DISPATCH_PROPERTYPUT ? 1U : 0U};
        VARIANT result; VariantInit(&result); EXCEPINFO error{}; UINT badArgument = 0;
        HRESULT hr = object->Invoke(id, IID_NULL, LOCALE_USER_DEFAULT, flags, &params, &result, &error, &badArgument);
        SysFreeString(error.bstrSource); SysFreeString(error.bstrDescription); SysFreeString(error.bstrHelpFile);
        if (FAILED(hr)) { VariantClear(&result); throw GuardFailure{8,hr,name}; }
        return result;
    }
    Dispatch child(const wchar_t* name, VARIANT* args = nullptr, UINT count = 0) const {
        VARIANT value = call(name, count ? DISPATCH_METHOD | DISPATCH_PROPERTYGET : DISPATCH_PROPERTYGET, args, count);
        if (value.vt != VT_DISPATCH) { VariantClear(&value); throw GuardFailure{8}; }
        Dispatch result(value.pdispVal); VariantClear(&value); return result;
    }
    std::wstring text(const wchar_t* name) const {
        VARIANT value = call(name); if (value.vt != VT_BSTR) { VariantClear(&value); throw GuardFailure{8}; }
        std::wstring result(value.bstrVal, SysStringLen(value.bstrVal)); VariantClear(&value); return result;
    }
    LONG number(const wchar_t* name) const {
        VARIANT value = call(name); if (value.vt != VT_I4) { VariantClear(&value); throw GuardFailure{8}; }
        LONG result = value.lVal; VariantClear(&value); return result;
    }
    bool flag(const wchar_t* name) const {
        VARIANT value = call(name); if (value.vt != VT_BOOL) { VariantClear(&value); throw GuardFailure{8}; }
        bool result = value.boolVal != VARIANT_FALSE; VariantClear(&value); return result;
    }
};
struct StringArgument {
    VARIANT value{};
    explicit StringArgument(const wchar_t* text) { value.vt = VT_BSTR; value.bstrVal = SysAllocString(text); if (!value.bstrVal) throw GuardFailure{8}; }
    ~StringArgument() { VariantClear(&value); }
};
inline std::wstring normalizedXml(const std::wstring& xml) {
    static const std::wregex attributes(LR"(\s(?:w:rsid\w*|w14:paraId|w14:textId)="[^"]*")");
    static const std::wregex revisions(LR"(<w:rsid(?:Root)?\s+w:val="[^"]*"\s*/>)");
    return std::regex_replace(std::regex_replace(xml, attributes, L""), revisions, L"");
}
inline bool terminated(const wchar_t* buffer, size_t size) { return wmemchr(buffer, L'\0', size) != nullptr; }
inline bool validWrite(const SourceWrite& request, bool allowRendered = false) {
    return terminated(request.tag, 128) && terminated(request.controlId, 32) && terminated(request.expected, 4001)
        && terminated(request.replacement, 4001) && terminated(request.xml, 262144)
        && wcsncmp(request.tag, L"owb-body:v1:", 12) == 0
        && (std::wstring(request.tag).size() >= 7 && std::wstring(request.tag).compare(wcslen(request.tag) - 7, 7, L":source") == 0
            || allowRendered && std::wstring(request.tag).size() >= 9 && std::wstring(request.tag).compare(wcslen(request.tag) - 9, 9, L":rendered") == 0)
        && !wcspbrk(request.expected, L"\r\n") && !wcspbrk(request.replacement, L"\r\n");
}

// Resolve and validate on Word's UI thread. The caller rechecks live TSF state immediately before the single put.
inline void setNumber(const Dispatch& object, const wchar_t* property, LONG value) {
    VARIANT argument{}; argument.vt = VT_I4; argument.lVal = value;
    VARIANT result = object.call(property, DISPATCH_PROPERTYPUT, &argument, 1); VariantClear(&result);
}
inline void setText(const Dispatch& object, const wchar_t* property, const wchar_t* value) {
    StringArgument argument(value); VARIANT result = object.call(property, DISPATCH_PROPERTYPUT, &argument.value, 1); VariantClear(&result);
}
inline void invoke(const Dispatch& object, const wchar_t* method, VARIANT* args = nullptr, UINT count = 0) {
    VARIANT result = object.call(method, DISPATCH_METHOD, args, count); VariantClear(&result);
}
struct CheckedBody { Dispatch doc, control, range, selection; };
inline CheckedBody checkedBody(HWND window, const wchar_t* documentPath, const SourceWrite& request, bool allowRendered = false) {
    if (!validWrite(request, allowRendered)) throw GuardFailure{6};
    GUITHREADINFO gui{sizeof(GUITHREADINFO)};
    if (!GetGUIThreadInfo(GetCurrentThreadId(), &gui) || GetAncestor(gui.hwndFocus, GA_ROOT) != GetAncestor(window, GA_ROOT)) throw GuardFailure{2};
    ComPtr<IDispatch> native;
    if (FAILED(AccessibleObjectFromWindow(gui.hwndFocus, static_cast<DWORD>(OBJID_NATIVEOM), IID_PPV_ARGS(&native)))) throw GuardFailure{2};
    Dispatch view(native.Get()); Dispatch doc = view.child(L"Document");
    if (_wcsicmp(doc.text(L"FullName").c_str(), documentPath) != 0) throw GuardFailure{4};
    if (doc.flag(L"TrackRevisions")) throw GuardFailure{6};
    StringArgument tag(request.tag);
    Dispatch controls = doc.child(L"SelectContentControlsByTag", &tag.value, 1);
    if (controls.number(L"Count") != 1) throw GuardFailure{4};
    VARIANT index{}; index.vt = VT_I4; index.lVal = 1;
    Dispatch control = controls.child(L"Item", &index, 1);
    if (control.text(L"ID") != request.controlId || control.text(L"Tag") != request.tag) throw GuardFailure{4};
    Dispatch range = control.child(L"Range");
    if (allowRendered && !range.text(L"Text").empty() && range.text(L"Text").back() == L'\r') setNumber(range, L"End", range.number(L"End") - 1);
    if (range.number(L"StoryType") != 1 || range.child(L"Paragraphs").number(L"Count") != 1 || range.child(L"ListFormat").number(L"ListType") != 0 || range.child(L"Tables").number(L"Count")
        || range.child(L"Fields").number(L"Count") || range.child(L"InlineShapes").number(L"Count") || range.child(L"Revisions").number(L"Count")) throw GuardFailure{6};
    const std::wstring xml = range.text(L"WordOpenXML");
    static const std::wregex objects(LR"(<(?:w:(?:drawing|pict|object|fldChar|fldSimple|footnoteReference|endnoteReference|ins|del|commentRangeStart)|m:oMath(?:Para)?)[\s/>])");
    if (std::regex_search(xml, objects)) throw GuardFailure{6};
    if (range.text(L"Text") != request.expected || normalizedXml(xml) != normalizedXml(request.xml)) throw GuardFailure{5};
    return {doc, control, range, view.child(L"Selection").child(L"Range").child(L"Duplicate")};
}
inline Dispatch checkedSourceRange(HWND window, const wchar_t* documentPath, const SourceWrite& request) {
    return checkedBody(window, documentPath, request).range;
}
