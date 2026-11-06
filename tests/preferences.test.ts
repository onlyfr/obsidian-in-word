import {afterEach,expect,it,vi} from 'vitest';
import {loadMathOutput,saveMathOutput,loadEditorPreferences,saveEditorPreferences} from '../src/taskpane/preferences';
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();});
it('defaults to hybrid and ignores unknown persisted values',()=>{
 expect(loadMathOutput()).toBe('hybrid');localStorage.setItem('oiw:math-output','broken');expect(loadMathOutput()).toBe('hybrid');
});
it('persists and reloads each choice',()=>{
 saveMathOutput('images');expect(loadMathOutput()).toBe('images');saveMathOutput('hybrid');expect(loadMathOutput()).toBe('hybrid');
});
it('works when storage is blocked',()=>{
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('blocked');});
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
 expect(loadMathOutput()).toBe('hybrid');expect(()=>saveMathOutput('images')).not.toThrow();
});
it('persists editor options and defaults malformed individual values',()=>{
 saveEditorPreferences({lineNumbers:false,wrap:false,fontSize:18});
 expect(loadEditorPreferences()).toEqual({lineNumbers:false,wrap:false,fontSize:18});
 localStorage.setItem('oiw:editor-options','{"lineNumbers":"false","wrap":false,"fontSize":999}');
 expect(loadEditorPreferences()).toEqual({lineNumbers:true,wrap:false,fontSize:14});
 localStorage.setItem('oiw:editor-options','broken');expect(loadEditorPreferences()).toEqual({lineNumbers:true,wrap:true,fontSize:14});
});
it('keeps editor options usable when persistence is blocked',()=>{
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('blocked');});
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
 expect(loadEditorPreferences()).toEqual({lineNumbers:true,wrap:true,fontSize:14});
 expect(()=>saveEditorPreferences({lineNumbers:false,wrap:true,fontSize:16})).not.toThrow();
});
