#pragma once
#include <msxml6.h>
#include <memory>
#include <set>

struct BodyTransition {
    SourceWrite source;
    LONG version, mode, selectionStart, selectionEnd, caretStart, caretEnd, failAt;
    wchar_t style[256], partId[128], previousJournal[262144], pendingJournal[262144], completeJournal[262144], renderXml[262144];
};
constexpr const wchar_t* bodyNamespace = L"urn:obsidian-in-word:body-edit:v1";
inline ComPtr<IXMLDOMDocument2> parseXml(const wchar_t* xml) {
    ComPtr<IXMLDOMDocument2> doc;
    if (FAILED(CoCreateInstance(__uuidof(DOMDocument60), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&doc)))) throw GuardFailure{6};
    doc->put_async(VARIANT_FALSE); doc->put_resolveExternals(VARIANT_FALSE); doc->put_validateOnParse(VARIANT_FALSE);
    VARIANT prohibit{}; prohibit.vt = VT_BOOL; prohibit.boolVal = VARIANT_TRUE;
    StringArgument property(L"ProhibitDTD"); doc->setProperty(property.value.bstrVal, prohibit);
    StringArgument text(xml); VARIANT_BOOL loaded = VARIANT_FALSE;
    if (FAILED(doc->loadXML(text.value.bstrVal, &loaded)) || !loaded) throw GuardFailure{6};
    return doc;
}
inline std::wstring nodeText(IXMLDOMNode* node, bool namespaceUri = false) {
    BSTR text = nullptr;
    HRESULT hr = namespaceUri ? node->get_namespaceURI(&text) : node->get_text(&text);
    if (FAILED(hr)) throw GuardFailure{6};
    std::wstring result = text ? text : L""; SysFreeString(text); return result;
}
inline void validateJournal(const wchar_t* xml, const std::wstring& key) {
    auto doc = parseXml(xml); ComPtr<IXMLDOMElement> root; doc->get_documentElement(&root);
    if (!root || nodeText(root.Get(), true) != bodyNamespace) throw GuardFailure{6};
    BSTR name = nullptr; root->get_baseName(&name); bool correct = name && wcscmp(name, L"bodyEdit") == 0; SysFreeString(name);
    if (!correct) throw GuardFailure{6};
    StringArgument keyName(L"key"); VARIANT value{}; root->getAttribute(keyName.value.bstrVal, &value);
    correct = value.vt == VT_BSTR && key == value.bstrVal; VariantClear(&value);
    if (!correct || nodeText(root.Get()).find(L"%22key%22%3A%22" + key + L"%22") == std::wstring::npos) throw GuardFailure{6};
}
inline void validateRender(const wchar_t* xml) {
    auto doc = parseXml(xml); StringArgument all(L"*"); ComPtr<IXMLDOMNodeList> elements; doc->getElementsByTagName(all.value.bstrVal, &elements);
    static const std::set<std::wstring> word{L"document",L"body",L"p",L"r",L"rPr",L"b",L"i",L"strike",L"rFonts",L"t"};
    static const std::set<std::wstring> package{L"package",L"part",L"xmlData"};
    long length = 0, paragraphs = 0, parts = 0, relationships = 0, documents = 0, bodies = 0; elements->get_length(&length);
    for (long i = 0; i < length; ++i) {
        ComPtr<IXMLDOMNode> el; elements->get_item(i, &el); BSTR raw = nullptr; el->get_baseName(&raw);
        std::wstring name = raw ? raw : L""; SysFreeString(raw); const auto ns = nodeText(el.Get(), true);
        if (ns == L"http://schemas.openxmlformats.org/wordprocessingml/2006/main") {
            if (!word.count(name)) throw GuardFailure{6};
            if (name == L"p") paragraphs++;
            if (name == L"document") documents++;
            if (name == L"body") bodies++;
        } else if (ns == L"http://schemas.microsoft.com/office/2006/xmlPackage") {
            if (!package.count(name)) throw GuardFailure{6};
            if (name == L"part") parts++;
        } else if (ns == L"http://schemas.openxmlformats.org/package/2006/relationships") {
            if (name != L"Relationships" && name != L"Relationship") throw GuardFailure{6};
            if (name == L"Relationship") {
                relationships++;
                ComPtr<IXMLDOMElement> element; el.As(&element);
                auto attribute = [&](const wchar_t* key) {
                    StringArgument attr(key); VARIANT value{}; element->getAttribute(attr.value.bstrVal,&value);
                    std::wstring text = value.vt == VT_BSTR ? value.bstrVal : L""; VariantClear(&value); return text;
                };
                if (attribute(L"Target") != L"word/document.xml" || attribute(L"Type") != L"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" || !attribute(L"TargetMode").empty()) throw GuardFailure{6};
            }
        } else throw GuardFailure{6};
    }
    if (paragraphs != 1 || parts != 2 || relationships != 1 || documents != 1 || bodies != 1) throw GuardFailure{6};
}
struct NativeRun { std::wstring text; bool bold = false, italic = false, strike = false, code = false; };
inline std::vector<NativeRun> renderRuns(const wchar_t* xml) {
    auto doc = parseXml(xml); StringArgument all(L"*"); ComPtr<IXMLDOMNodeList> elements; doc->getElementsByTagName(all.value.bstrVal,&elements);
    std::vector<NativeRun> runs; long length = 0; elements->get_length(&length);
    for (long i = 0; i < length; ++i) {
        ComPtr<IXMLDOMNode> node; elements->get_item(i,&node); BSTR raw = nullptr; node->get_baseName(&raw);
        std::wstring name = raw ? raw : L""; SysFreeString(raw);
        if (name != L"r") continue;
        NativeRun run;
        ComPtr<IXMLDOMNodeList> properties;
        StringArgument query(L".//*"); node->selectNodes(query.value.bstrVal,&properties); long count = 0; properties->get_length(&count);
        for (long j = 0; j < count; ++j) {
            ComPtr<IXMLDOMNode> prop; properties->get_item(j,&prop); prop->get_baseName(&raw);
            name = raw ? raw : L""; SysFreeString(raw);
            if (name == L"t") run.text += nodeText(prop.Get());
            if (name == L"b") run.bold = true;
            if (name == L"i") run.italic = true;
            if (name == L"strike") run.strike = true;
            if (name == L"rFonts") {
                ComPtr<IXMLDOMElement> element; prop.As(&element); StringArgument attr(L"w:ascii"); VARIANT value{}; element->getAttribute(attr.value.bstrVal,&value);
                if (value.vt != VT_BSTR || wcscmp(value.bstrVal,L"Consolas") != 0) {VariantClear(&value);throw GuardFailure{6};}
                VariantClear(&value); run.code = true;
            }
        }
        runs.push_back(std::move(run));
    }
    return runs;
}
inline std::wstring blockKey(const SourceWrite& request) {
    std::wstring tag(request.tag); auto end = tag.find_last_of(L':'); auto key = tag.substr(12, end - 12);
    if (key.empty() || key.size() > 64 || key.find_first_not_of(L"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-") != std::wstring::npos) throw GuardFailure{6};
    return key;
}
inline bool validTransition(const BodyTransition& request) {
    return request.version == 1 && request.mode >= 1 && request.mode <= 3 && request.failAt >= 0 && request.failAt <= 3
        && validWrite(request.source, true) && !wcspbrk(request.source.replacement,L"\t\v\f") && terminated(request.style,256) && terminated(request.partId,128)
        && terminated(request.previousJournal,262144) && terminated(request.pendingJournal,262144)
        && terminated(request.completeJournal,262144) && terminated(request.renderXml,262144);
}
inline Dispatch journalPart(const Dispatch& doc, const BodyTransition& request, const std::wstring& key) {
    auto parts = doc.child(L"CustomXMLParts"); StringArgument ns(bodyNamespace);
    auto matches = parts.child(L"SelectByNamespace", &ns.value, 1);
    const auto count = matches.number(L"Count"); Dispatch found;
    for (LONG i = 1; i <= count; ++i) {
        VARIANT index{}; index.vt = VT_I4; index.lVal = i;
        auto part = matches.child(L"Item", &index, 1);
        // Earlier journal records may lack the key attribute; encoded JSON remains compatible.
        const auto xml = part.text(L"XML");
        if (xml.find(L"%22key%22%3A%22" + key + L"%22") != std::wstring::npos) {
            if (found.object) throw GuardFailure{11};
            found = part;
        }
    }
    if (found.object) {
        if (found.text(L"Id") != request.partId || found.text(L"XML") != request.previousJournal) throw GuardFailure{11};
    } else if (*request.partId || *request.previousJournal) throw GuardFailure{11};
    return found;
}
inline void storeJournal(Dispatch& part, const Dispatch& doc, const std::wstring& xml) {
    StringArgument argument(xml.c_str());
    if (!part.object) part = doc.child(L"CustomXMLParts").child(L"Add", &argument.value, 1);
    else {
        auto document = parseXml(xml.c_str()); ComPtr<IXMLDOMElement> root; document->get_documentElement(&root);
        setText(part.child(L"DocumentElement"),L"Text",nodeText(root.Get()).c_str());
    }
}
inline std::wstring stageJournal(const wchar_t* xml, const wchar_t* stage) {
    std::wstring text(xml), before = L"%22nativeStage%22%3A%22prepared%22";
    auto at = text.find(before); if (at == std::wstring::npos) throw GuardFailure{6};
    return text.replace(at, before.size(), L"%22nativeStage%22%3A%22" + std::wstring(stage) + L"%22");
}
struct UndoScope {
    Dispatch record; bool opened = false;
    explicit UndoScope(const Dispatch& doc) : record(doc.child(L"Application").child(L"UndoRecord")) {
        if (record.number(L"CustomRecordLevel") != 0) throw GuardFailure{23};
        StringArgument title(L"Obsidian body transition"); invoke(record,L"StartCustomRecord",&title.value,1); opened = true;
    }
    ~UndoScope() { if (opened) try { invoke(record,L"EndCustomRecord"); } catch (...) {} }
};
