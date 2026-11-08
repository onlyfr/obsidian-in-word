import {afterEach,expect,it} from 'vitest';
import {normalizeMathAppearance,mathAppearanceKey} from '../src/convert/math-appearance';
import {loadMathAppearance,saveMathAppearance} from '../src/taskpane/preferences';
import {MemorySidecar} from '../src/convert/sidecar';
import {renderWithSidecar} from '../src/convert/obsidian';
import {applyMathImages} from '../src/convert/mathimg';
afterEach(()=>localStorage.clear());
it('normalizes safe size/colour values and keeps default cache identity',()=>{
 expect(normalizeMathAppearance({sizePt:999,color:'url(evil)'})).toEqual({sizePt:11,color:'#000000'});
 expect(normalizeMathAppearance({sizePt:12.2,color:'#ABCDEF'})).toEqual({sizePt:12,color:'#abcdef'});
 expect(mathAppearanceKey()).toBe('');expect(mathAppearanceKey({sizePt:16,color:'#123456'})).not.toBe('');
});
it('persists image appearance independently of editor options',()=>{
 saveMathAppearance({sizePt:16,color:'#123456'});expect(loadMathAppearance()).toEqual({sizePt:16,color:'#123456'});
 localStorage.setItem('oiw:math-image-appearance','broken');expect(loadMathAppearance()).toEqual({sizePt:11,color:'#000000'});
});
it('keeps source identity while separating size/colour caches and reuses the selected profile',async()=>{
 const sc=new MemorySidecar(),q=renderWithSidecar('$x^2$',sc);let renders=0;
 const loader=async()=>({render:async()=>{renders++;return {png:'AAAA',w:30,h:20,baseline:16,scale:3};}});
 const first=await applyMathImages(q.html,q.equations,sc,loader,'images');
 const next=await applyMathImages(q.html,q.equations,sc,loader,'images',{sizePt:16,color:'#123456'});
 expect([...first.pictures.values()][0].body).not.toBe([...next.pictures.values()][0].body);
 await applyMathImages(q.html,q.equations,sc,loader,'images',{sizePt:16,color:'#123456'});expect(renders).toBe(2);
 expect([...sc.entries()].map(([,entry])=>entry.latex)).toEqual(['x^2','x^2']);
});
