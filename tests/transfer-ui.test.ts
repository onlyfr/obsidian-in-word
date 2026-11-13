import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {initTransferUi} from '../src/taskpane/transfer-ui';
import {PluginLibrary,LocalDataStore} from '../src/plugins/storage';
import {createTransfer,TRANSFER_LIMIT} from '../src/taskpane/transfer';
import {readFileSync} from 'node:fs';
import {EditorView} from '@codemirror/view';
import {Compartment} from '@codemirror/state';
import {initPlugins} from '../src/taskpane/plugins-ui';
beforeEach(()=>{
 localStorage.clear();vi.stubGlobal('indexedDB',new IDBFactory());
 document.body.innerHTML='<div id="plugins"><button id="transfer-export"></button><input id="transfer-file"><input id="transfer-preferences" type="checkbox" checked><p id="transfer-status"></p><details id="transfer-json" hidden><textarea id="transfer-json-text"></textarea></details></div>';
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function mount(){const library=new PluginLibrary(),dataStore=new LocalDataStore();initTransferUi({library,dataStore,installed:()=>[],runOperation:action=>action(),exclusive:action=>action(),preferencesChanged(){},changed:async()=>{}});return {library,dataStore};}
it('keeps usable JSON when the Word webview cannot start a download',async()=>{
 vi.stubGlobal('URL',{createObjectURL(){throw new Error('downloads blocked');}});mount();document.getElementById('transfer-export')!.click();
 await vi.waitFor(()=>expect(document.getElementById('transfer-status')!.textContent).toContain('시작하지 못했습니다'));
 expect(document.getElementById('transfer-json')!.hidden).toBe(false);
 expect(JSON.parse((document.getElementById('transfer-json-text') as HTMLTextAreaElement).value).format).toBe('obsidian-in-word-settings');
});
it('cancels a valid preview without changing installed bundles or options',async()=>{
 const {library,dataStore}=mount(),input=document.getElementById('transfer-file') as HTMLInputElement;
 const text=createTransfer([{manifest:{id:'new',name:'New'},mainJs:'code',enabled:true}],dataStore);
 Object.defineProperty(input,'files',{value:[{size:text.length,text:async()=>text}]});input.dispatchEvent(new Event('change'));
 await vi.waitFor(()=>expect(document.getElementById('inline-confirm-no')).not.toBeNull());document.getElementById('inline-confirm-no')!.click();
 await vi.waitFor(()=>expect(document.getElementById('transfer-status')!.textContent).toContain('취소'));
 expect(await library.list()).toEqual([]);expect(localStorage.length).toBe(0);
});
it('rejects oversized files before reading their contents',async()=>{
 mount();const input=document.getElementById('transfer-file') as HTMLInputElement,text=vi.fn();
 Object.defineProperty(input,'files',{value:[{size:TRANSFER_LIMIT+1,text}]});input.dispatchEvent(new Event('change'));
 await vi.waitFor(()=>expect(document.getElementById('transfer-status')!.textContent).toContain('50MB'));expect(text).not.toHaveBeenCalled();
});
it('initializes plugins during an unrelated Word operation when no import record needs resolving',async()=>{
 document.body.innerHTML=new DOMParser().parseFromString(readFileSync('src/taskpane/index.html','utf8'),'text/html').body.innerHTML;
 const compartment=new Compartment(),view=new EditorView({extensions:[compartment.of([])],parent:document.getElementById('editor')!});
 const attempted=vi.fn();const exclusive=async<T>(_action:()=>Promise<T>):Promise<T>=>{attempted();throw new Error('Word operation busy');};
 try{await initPlugins(view,compartment,()=>{},()=>{},{exclusive,preferencesChanged(){}});expect(attempted).not.toHaveBeenCalled();expect((document.getElementById('transfer-file') as HTMLInputElement).disabled).toBe(false);}
 finally{view.destroy();}
});
it('clears a selected file when the Word-operation lock refuses import so the same file can be retried',async()=>{
 const library=new PluginLibrary(),dataStore=new LocalDataStore();
 initTransferUi({library,dataStore,installed:()=>[],runOperation:action=>action(),exclusive:async()=>{throw new Error('Word busy');},preferencesChanged(){},changed:async()=>{}});
 const input=document.getElementById('transfer-file') as HTMLInputElement,text=vi.fn();let value='fixture.json';
 Object.defineProperty(input,'value',{get:()=>value,set:next=>{value=next;}});Object.defineProperty(input,'files',{value:[{size:10,text}]});input.dispatchEvent(new Event('change'));
 await vi.waitFor(()=>expect(value).toBe(''));expect(text).not.toHaveBeenCalled();expect(document.getElementById('transfer-status')!.textContent).toContain('Word busy');
});
