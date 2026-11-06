import {expect,it} from 'vitest';
import {sourceCaret} from '../src/body/caret-map';
import {inlineBodyCodec} from '../src/body/inline-codec';

it.each([
 ['Alpha **bold** tail','Alpha bold tail',8,10],
 ['**한글**과 _문자_','한글과 문자',1,3],
 ['a ***nested*** b','a nested b',4,7],
 ['a ~~gone~~ b','a gone b',4,6],
 ['[label](https://example.test/a "title") after','label after',3,4],
 ['` x ` tail','x tail',1,5],
 ['a \\* b','a * b',3,4],
 ['a &amp; b','a & b',3,7],
 ['a 😀 **한글**','a 😀 한글',6,8],
 ['x&nbsp;y','x\u00a0y',2,7],
])('maps rendered caret to source: %s',(source,rendered,offset,expected)=>{
 expect(sourceCaret(source as string,rendered as string,offset as number)).toBe(expected);
});
it('keeps paragraph boundaries and selection endpoints distinct',()=>{
 expect(sourceCaret('**bold**','bold',0)).toBe(0);expect(sourceCaret('**bold**','bold',4)).toBe(8);
 expect(sourceCaret('a **bold** z','a bold z',3)).toBe(5);expect(sourceCaret('a **bold** z','a bold z',5)).toBe(7);
});
it('refuses content/offset mismatches instead of jumping to an estimated position',()=>{
 expect(()=>sourceCaret('**bold**','different',1)).toThrow('일치하지');
 expect(()=>sourceCaret('text','text',5)).toThrow('일치하지');
 expect(()=>sourceCaret('# heading','heading',1)).toThrow('문단');
});
it('joins Word emphasis runs split by Latin/Korean font/language boundaries before mapping',()=>{
 const source=inlineBodyCodec.markdown('<p><span lang="en">Alpha <b><span>bo</span></b></span><b><span lang="ko">ㅂㅈㄷ가나다</span></b><strong><span> ld</span></strong> tail</p>');
 expect(source).toBe('Alpha **boㅂㅈㄷ가나다 ld** tail');
 expect(sourceCaret(source,'Alpha boㅂㅈㄷ가나다 ld tail',7)).toBe(9);
});
