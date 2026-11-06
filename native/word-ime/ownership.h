#pragma once
constexpr const wchar_t* ownerNamespace=L"urn:obsidian-in-word:body-owners:v1";
inline std::wstring xmlAttribute(IXMLDOMElement* element,const wchar_t* name){
    StringArgument key(name);VARIANT value{};element->getAttribute(key.value.bstrVal,&value);
    std::wstring text=value.vt==VT_BSTR?value.bstrVal:L"";VariantClear(&value);return text;
}
inline bool safeOwnerKey(const std::wstring& key){return !key.empty() && key.size()<=64 && key.find_first_not_of(L"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-")==std::wstring::npos;}
inline std::wstring registeredControlId(const Dispatch& doc,const std::wstring& key,bool required=true){
    auto parts=doc.child(L"CustomXMLParts");StringArgument ns(ownerNamespace);auto owners=parts.child(L"SelectByNamespace",&ns.value,1);
    LONG found=0;std::wstring id;const auto count=owners.number(L"Count");
    for(LONG i=1;i<=count;++i){
        VARIANT index{};index.vt=VT_I4;index.lVal=i;auto part=owners.child(L"Item",&index,1);
        auto xml=parseXml(part.text(L"XML").c_str());ComPtr<IXMLDOMElement> root;xml->get_documentElement(&root);
        if(!root || nodeText(root.Get(),true)!=ownerNamespace)throw GuardFailure{12};
        BSTR name=nullptr;root->get_baseName(&name);bool valid=name && wcscmp(name,L"bodyOwner")==0;SysFreeString(name);if(!valid)throw GuardFailure{12};
        auto ownerKey=xmlAttribute(root.Get(),L"key");if(!safeOwnerKey(ownerKey))throw GuardFailure{12};
        if(ownerKey==key){++found;id=xmlAttribute(root.Get(),L"controlId");if(id.empty())throw GuardFailure{12};}
    }
    if(found>1 || (required && found!=1))throw GuardFailure{12};return id;
}
inline void verifyOwnership(const Dispatch& doc,const Dispatch& control,const std::wstring& key){
    if(control.number(L"Type")!=0)throw GuardFailure{12};
    if(registeredControlId(doc,key)!=control.text(L"ID"))throw GuardFailure{12};
    auto controls=doc.child(L"ContentControls");LONG matches=0;
    for(LONG i=1;i<=controls.number(L"Count");++i){
        VARIANT index{};index.vt=VT_I4;index.lVal=i;auto cc=controls.child(L"Item",&index,1);const auto tag=cc.text(L"Tag");
        if(tag==L"owb-body:v1:"+key+L":source" || tag==L"owb-body:v1:"+key+L":rendered")++matches;
    }
    if(matches!=1)throw GuardFailure{12};
}
inline void verifyOwnedRequest(const Dispatch& doc,const Dispatch& control,const SourceWrite& request){verifyOwnership(doc,control,blockKey(request));}
inline Dispatch currentNativeView(HWND window){
    GUITHREADINFO gui{sizeof(GUITHREADINFO)};
    if(!GetGUIThreadInfo(GetCurrentThreadId(),&gui) || GetAncestor(gui.hwndFocus,GA_ROOT)!=GetAncestor(window,GA_ROOT))throw GuardFailure{2};
    ComPtr<IDispatch> object;
    if(FAILED(AccessibleObjectFromWindow(gui.hwndFocus,static_cast<DWORD>(OBJID_NATIVEOM),IID_PPV_ARGS(&object))))throw GuardFailure{2};
    return Dispatch(object.Get());
}
inline void validateClaimRange(const Dispatch& doc,const Dispatch& range,const Dispatch& selection,const SourceWrite& expected){
    if(doc.flag(L"TrackRevisions") || range.number(L"StoryType")!=1 || range.child(L"Paragraphs").number(L"Count")!=1
        || range.child(L"Tables").number(L"Count") || range.child(L"ListFormat").number(L"ListType") || range.child(L"Fields").number(L"Count")
        || range.child(L"InlineShapes").number(L"Count") || range.child(L"Revisions").number(L"Count"))throw GuardFailure{6};
    const auto start=range.number(L"Start"),end=range.number(L"End");
    if(selection.number(L"Start")<start || selection.number(L"End")>end)throw GuardFailure{10};
    auto controls=doc.child(L"ContentControls");
    for(LONG i=1;i<=controls.number(L"Count");++i){
        VARIANT index{};index.vt=VT_I4;index.lVal=i;auto cc=controls.child(L"Item",&index,1).child(L"Range");
        if(cc.number(L"StoryType")==1 && cc.number(L"Start")<=end && cc.number(L"End")>=start)throw GuardFailure{12};
    }
    const auto xml=range.text(L"WordOpenXML");
    static const std::wregex objects(LR"(<(?:w:(?:tbl|drawing|pict|object|fldChar|fldSimple|footnoteReference|endnoteReference|ins|del|commentRangeStart|bookmarkStart|bookmarkEnd|numPr)|m:oMath(?:Para)?)[\s/>])");
    if(std::regex_search(xml,objects))throw GuardFailure{6};
    if(range.text(L"Text")!=expected.expected || normalizedXml(xml)!=normalizedXml(expected.xml))throw GuardFailure{5};
}
