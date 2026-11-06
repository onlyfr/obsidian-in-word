import {afterEach,expect,it,vi} from 'vitest';
import {loadMathOutput,saveMathOutput} from '../src/taskpane/preferences';
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
