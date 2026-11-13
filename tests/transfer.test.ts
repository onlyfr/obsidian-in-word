import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {PluginLibrary,LocalDataStore,type StoredPlugin} from '../src/plugins/storage';
import {createTransfer,parseTransfer,importTransfer,recoverTransfer,JOURNAL_KEY,type TransferArchive} from '../src/taskpane/transfer';

const bundle:StoredPlugin={manifest:{id:'transfer-fixture',name:'Fixture',version:'1.0.0'},mainJs:'globalThis.transferRan=true;',enabled:true};
const archive=():TransferArchive=>({format:'obsidian-in-word-settings',version:1,plugins:[{bundle,data:{setting:'new'}}],preferences:{editor:{lineNumbers:false,wrap:false,fontSize:18},mathOutput:'images',mathAppearance:{sizePt:16,color:'#123456'},mathSource:'manual'}});
beforeEach(()=>{
 localStorage.clear();vi.stubGlobal('indexedDB',new IDBFactory());
 vi.stubGlobal('navigator',{locks:{request:(_name:string,action:()=>unknown)=>Promise.resolve().then(action)}});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('exports only installed plugin data and allowed options, never pane/session/document storage',()=>{
 localStorage.setItem('oiw:connection','private-connection');localStorage.setItem('oiw:document','document-body');
 const data=new LocalDataStore();data.set(bundle.manifest.id,{apiKey:'plugin-owned-key'});
 const text=createTransfer([bundle],data),parsed=parseTransfer(text);
 expect(text).not.toContain('private-connection');expect(text).not.toContain('document-body');expect(text).toContain('plugin-owned-key');
 expect(parsed.plugins[0].bundle.enabled).toBe(false);expect(parsed.plugins[0].data).toEqual({apiKey:'plugin-owned-key'});
 expect(parseTransfer('\uFEFF'+text).plugins[0].data).toEqual(parsed.plugins[0].data);
 expect(parseTransfer(createTransfer([bundle],data,archive().preferences)).preferences.mathOutput).toBe('images');
});
it('rejects unknown versions, duplicate identities, invalid preferences and oversized UTF8 metadata before writes',async()=>{
 const variants:unknown[]=[{...archive(),version:2},{...archive(),plugins:[...archive().plugins,...archive().plugins]},
 {...archive(),preferences:{...archive().preferences,mathAppearance:{sizePt:999,color:'#123456'}}},
 {...archive(),plugins:[{bundle:{...bundle,manifest:{id:'fixture',name:'Name',description:'한'.repeat(24000)}}}]}];
 for(const value of variants)expect(()=>parseTransfer(JSON.stringify(value))).toThrow();
 expect(()=>parseTransfer(JSON.stringify(archive()).replace('"sizePt":16','"sizePt":1e999'))).toThrow();
});
it('imports disabled code, plugin settings and preferences persistently without execution',async()=>{
 const library=new PluginLibrary();const result=await importTransfer(archive(),library,true);
 expect(result).toEqual({added:[bundle.manifest.id],skipped:0,preferences:true});
 expect((await new PluginLibrary().list())[0].enabled).toBe(false);expect((globalThis as any).transferRan).toBeUndefined();
 expect(JSON.parse(localStorage.getItem('oiw:data:'+bundle.manifest.id)!)).toEqual({setting:'new'});
 expect(localStorage.getItem('oiw:math-output')).toBe('images');expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();
});
it('keeps existing installed code, enabled state and plugin data on identity conflict',async()=>{
 const library=new PluginLibrary();await library.save({...bundle,mainJs:'original',enabled:true});
 localStorage.setItem('oiw:data:'+bundle.manifest.id,'{"old":true}');localStorage.setItem('oiw:math-output','hybrid');
 const result=await importTransfer(archive(),library,false);
 expect(result.added).toEqual([]);expect(result.skipped).toBe(1);expect((await library.list())[0].mainJs).toBe('original');
 expect((await library.list())[0].enabled).toBe(true);expect(localStorage.getItem('oiw:data:'+bundle.manifest.id)).toBe('{"old":true}');expect(localStorage.getItem('oiw:math-output')).toBe('hybrid');
});
it('aborts all IndexedDB additions and the marker when any add conflicts',async()=>{
 const library=new PluginLibrary();await library.save(bundle);const id=crypto.randomUUID();
 await expect(library.commitTransfer(id,[{...bundle,manifest:{id:'new',name:'New'}},bundle])).rejects.toThrow();
 expect((await library.list()).map(p=>p.manifest.id)).toEqual([bundle.manifest.id]);expect(await library.transferCommitted(id)).toBe(false);
});
it('restores local values if a write fails before the bundle transaction',async()=>{
 const library=new PluginLibrary(),commit=vi.spyOn(library,'commitTransfer');localStorage.setItem('oiw:math-output','hybrid');
 const original=Storage.prototype.setItem;let failed=false;
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key:string,value:string){if(key==='oiw:math-output' && !failed){failed=true;throw new Error('quota');}original.call(this,key,value);});
 await expect(importTransfer(archive(),library,true)).rejects.toThrow('quota');
 expect(commit).not.toHaveBeenCalled();expect(localStorage.getItem('oiw:math-output')).toBe('hybrid');expect(localStorage.getItem('oiw:data:'+bundle.manifest.id)).toBeNull();expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();
});
it('restores orphan data and preferences after bundle transaction failure',async()=>{
 const library=new PluginLibrary();vi.spyOn(library,'commitTransfer').mockRejectedValue(new Error('aborted'));
 localStorage.setItem('oiw:data:'+bundle.manifest.id,'{"orphan":true}');localStorage.setItem('oiw:math-output','hybrid');
 await expect(importTransfer(archive(),library,true)).rejects.toThrow('aborted');
 expect(localStorage.getItem('oiw:data:'+bundle.manifest.id)).toBe('{"orphan":true}');expect(localStorage.getItem('oiw:math-output')).toBe('hybrid');
});
function pending(id:string,before:string|null='hybrid',after='images'){
 localStorage.setItem('oiw:math-output',after);localStorage.setItem(JOURNAL_KEY,JSON.stringify({id,before:[['oiw:math-output',before,after]]}));
}
it('resolves an interrupted uncommitted import before startup without replaying code',async()=>{
 const library=new PluginLibrary();pending(crypto.randomUUID());expect(await recoverTransfer(library)).toBe(true);
 expect(localStorage.getItem('oiw:math-output')).toBe('hybrid');expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();expect(await library.list()).toEqual([]);
});
it('keeps an interrupted committed import and does not submit it again',async()=>{
 const library=new PluginLibrary(),id=crypto.randomUUID();await library.commitTransfer(id,[{...bundle,enabled:false}]);pending(id);
 const commit=vi.spyOn(library,'commitTransfer');await recoverTransfer(library);
 expect(localStorage.getItem('oiw:math-output')).toBe('images');expect(commit).not.toHaveBeenCalled();expect((await library.list())[0].enabled).toBe(false);
});
it('preserves later edits made in another pane when resolving an uncommitted import',async()=>{
 pending(crypto.randomUUID(),'old','imported');localStorage.setItem('oiw:math-output','later-edit');await recoverTransfer(new PluginLibrary());
 expect(localStorage.getItem('oiw:math-output')).toBe('later-edit');
});
it('keeps unknown-outcome records until the commit marker can be read',async()=>{
 const library=new PluginLibrary();pending(crypto.randomUUID());vi.spyOn(library,'transferCommitted').mockRejectedValue(new Error('unavailable'));
 await expect(recoverTransfer(library)).rejects.toThrow('unavailable');expect(localStorage.getItem(JOURNAL_KEY)).not.toBeNull();expect(localStorage.getItem('oiw:math-output')).toBe('images');
});
it('does not mutate arbitrary keys from an invalid interrupted-import record',async()=>{
 localStorage.setItem('secret','keep');localStorage.setItem(JOURNAL_KEY,JSON.stringify({id:crypto.randomUUID(),before:[['secret','erase','keep']]}));
 await expect(recoverTransfer(new PluginLibrary())).rejects.toThrow('키');expect(localStorage.getItem('secret')).toBe('keep');
});
it('recognizes completion even if a completion notification was lost',async()=>{
 const library=new PluginLibrary(),commit=library.commitTransfer.bind(library);let calls=0;
 vi.spyOn(library,'commitTransfer').mockImplementation(async(id,plugins)=>{calls++;await commit(id,plugins);throw new Error('lost completion');});
 expect((await importTransfer(archive(),library,true)).added).toEqual([bundle.manifest.id]);expect(calls).toBe(1);expect(localStorage.getItem('oiw:math-output')).toBe('images');
});
it('requires permanent storage and origin locking before writing imported settings',async()=>{
 vi.stubGlobal('indexedDB',undefined);await expect(importTransfer(archive(),new PluginLibrary(),true)).rejects.toThrow('영구');expect(localStorage.length).toBe(0);
 vi.stubGlobal('navigator',{});await expect(importTransfer(archive(),new PluginLibrary(),true)).rejects.toThrow('잠금');
});
it('resolves a committed record left behind when journal deletion fails without importing again',async()=>{
 const library=new PluginLibrary(),commit=vi.spyOn(library,'commitTransfer');const remove=Storage.prototype.removeItem;let blocked=true;
 vi.spyOn(Storage.prototype,'removeItem').mockImplementation(function(this:Storage,key:string){if(blocked && key===JOURNAL_KEY)throw new Error('blocked');remove.call(this,key);});
 await importTransfer(archive(),library,true);expect(localStorage.getItem(JOURNAL_KEY)).not.toBeNull();blocked=false;
 await recoverTransfer(library);expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();expect(localStorage.getItem('oiw:math-output')).toBe('images');expect(commit).toHaveBeenCalledTimes(1);
});
it('reports a blocked v1 upgrade instead of showing an empty installed list',async()=>{
 const old=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('oiw-plugins',1);request.onupgradeneeded=()=>request.result.createObjectStore('plugins').put(bundle,bundle.manifest.id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 const blocked=new PluginLibrary();await expect(blocked.list()).rejects.toThrow('다른 Word');old.close();
 expect((await new PluginLibrary().list()).map(p=>p.manifest.id)).toEqual([bundle.manifest.id]);
});
it('does not resurrect cached plugins after another pane removes the last persisted entry',async()=>{
 const library=new PluginLibrary();await library.save(bundle);await new PluginLibrary().remove(bundle.manifest.id);
 expect(await library.list()).toEqual([]);
});
