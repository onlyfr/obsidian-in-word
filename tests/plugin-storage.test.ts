import {afterEach,expect,it,vi} from 'vitest';
import {PluginLibrary} from '../src/plugins/storage';
afterEach(()=>vi.unstubAllGlobals());
const plugin={manifest:{id:'fixture',name:'Fixture',version:'1.0.0'},mainJs:'fixture',enabled:false};
it('rejects a transaction abort after request success instead of reporting a saved plugin',async()=>{
 let write:any;
 const db={transaction:()=>{
   const tx:any={objectStore:()=>({put:()=>{const request:any={result:'fixture'};write={tx,request};return request;}})};return tx;
 }};
 vi.stubGlobal('indexedDB',{open:()=>{const request:any={result:db};queueMicrotask(()=>request.onsuccess());return request;}});
 const library=new PluginLibrary();let completed=false;
 const saving=library.save(plugin).then(()=>{completed=true;});
 await vi.waitFor(()=>expect(write).toBeDefined());
 write.request.onsuccess?.();await Promise.resolve();expect(completed).toBe(false);
 write.tx.onabort();await expect(saving).rejects.toThrow('저장소');
});
it('reports session-only storage when IndexedDB is unavailable',async()=>{
 vi.stubGlobal('indexedDB',undefined);const library=new PluginLibrary();
 expect(await library.save(plugin)).toBe('session');expect(await library.list()).toEqual([plugin]);
 await library.remove('fixture');expect(await library.list()).toEqual([]);
});
