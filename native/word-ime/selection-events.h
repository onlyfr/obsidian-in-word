#pragma once
#include <ocidl.h>
#include <olectl.h>

/** Discover the installed Word event interface/DISPID from its type library; never inspect event selection text. */
class WordSelectionEvents final : public IDispatch {
    LONG refs = 1;
    ComPtr<IConnectionPoint> point;
    IID source = IID_NULL;
    DISPID selection = DISPID_UNKNOWN;
    DWORD cookie = 0;
    void (*changed)();
public:
    explicit WordSelectionEvents(void (*callback)()) : changed(callback) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** result) override {
        if (!result) return E_POINTER; *result = nullptr;
        if (iid != IID_IUnknown && iid != IID_IDispatch && iid != source) return E_NOINTERFACE;
        *result = static_cast<IDispatch*>(this); AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override {return InterlockedIncrement(&refs);}
    ULONG STDMETHODCALLTYPE Release() override {auto n=InterlockedDecrement(&refs);if(!n)delete this;return n;}
    HRESULT STDMETHODCALLTYPE GetTypeInfoCount(UINT* count) override {if(!count)return E_POINTER;*count=0;return S_OK;}
    HRESULT STDMETHODCALLTYPE GetTypeInfo(UINT,LCID,ITypeInfo**) override {return E_NOTIMPL;}
    HRESULT STDMETHODCALLTYPE GetIDsOfNames(REFIID,LPOLESTR*,UINT,LCID,DISPID*) override {return E_NOTIMPL;}
    HRESULT STDMETHODCALLTYPE Invoke(DISPID id,REFIID,LCID,WORD,DISPPARAMS*,VARIANT*,EXCEPINFO*,UINT*) override {
        if(id==selection){AddRef();changed();Release();}return S_OK;
    }
    HRESULT attach(const Dispatch& application) {
        ComPtr<ITypeInfo> appInfo; HRESULT hr=application.object->GetTypeInfo(0,LOCALE_USER_DEFAULT,&appInfo);
        ComPtr<ITypeLib> library;UINT index=0;if(SUCCEEDED(hr))hr=appInfo->GetContainingTypeLib(&library,&index);
        ComPtr<IConnectionPointContainer> container;if(SUCCEEDED(hr))hr=application.object.As(&container);
        ComPtr<IEnumConnectionPoints> points;if(SUCCEEDED(hr))hr=container->EnumConnectionPoints(&points);
        if(FAILED(hr))return hr;
        for(unsigned i=0;i<16;++i){
            ComPtr<IConnectionPoint> candidate;ULONG fetched=0;
            if(points->Next(1,&candidate,&fetched)!=S_OK)break;
            IID iid;candidate->GetConnectionInterface(&iid);ComPtr<ITypeInfo> info;
            if(FAILED(library->GetTypeInfoOfGuid(iid,&info)))continue;
            LPOLESTR name=const_cast<LPOLESTR>(L"WindowSelectionChange");DISPID id;
            if(FAILED(info->GetIDsOfNames(&name,1,&id)))continue;
            source=iid;selection=id;point=candidate;
            hr=point->Advise(static_cast<IDispatch*>(this),&cookie);
            if(SUCCEEDED(hr))return S_OK;point.Reset();
        }
        return CONNECT_E_NOCONNECTION;
    }
    void detach(){if(point && cookie)point->Unadvise(cookie);cookie=0;point.Reset();}
};
