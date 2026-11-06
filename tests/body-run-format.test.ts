import {expect,it} from "vitest";
import {captureRunFormat,applyRunFormat,type NativeRunFormat} from "../src/body/run-format";
import {nativeParagraph} from "../src/body/native-port";
import {wrapPackage} from "../src/convert/equations";
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const original=wrapPackage('<w:p><w:r><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="맑은 고딕"/><w:sz w:val="25"/><w:color w:val="AA5500"/></w:rPr><w:t>red🙂</w:t></w:r><w:r><w:rPr><w:color w:val="0000FF"/></w:rPr><w:t>blue</w:t></w:r></w:p>');
const capture=()=>captureRunFormat(original,'red🙂blue');
const inspect=(xml:string)=>Array.from(new DOMParser().parseFromString(xml,'application/xml').getElementsByTagNameNS(W,'r')).map(r=>({text:r.getElementsByTagNameNS(W,'t')[0]?.textContent,color:r.getElementsByTagNameNS(W,'color')[0]?.getAttributeNS(W,'val'),size:r.getElementsByTagNameNS(W,'sz')[0]?.getAttributeNS(W,'val'),font:r.getElementsByTagNameNS(W,'rFonts')[0]?.getAttributeNS(W,'ascii')}));
it('restores concrete typography across new Markdown mark boundaries and Unicode',()=>{
  const result=inspect(applyRunFormat(nativeParagraph('**red**🙂_blue_'),capture()));
  expect(result.map(r=>r.text).join('')).toBe('red🙂blue');expect(result.filter(r=>r.text!=='blue').every(r=>r.color==='AA5500' && r.size==='25' && r.font==='Cambria')).toBe(true);expect(result.at(-1)?.color).toBe('0000FF');
});
it('inherits one original appearance for a local replacement, and preserves the suffix',()=>{
  expect(inspect(applyRunFormat(nativeParagraph('richer🙂blue'),capture()))).toEqual([{text:'richer🙂',color:'AA5500',size:'25',font:'Cambria'},{text:'blue',color:'0000FF',size:undefined,font:undefined}]);
});
it('refuses ambiguous replacement and insertion at an appearance boundary',()=>{
  expect(()=>applyRunFormat(nativeParagraph('new'),capture())).toThrow('여러 원본 서식');
  expect(()=>applyRunFormat(nativeParagraph('red🙂Xblue'),capture())).toThrow('여러 원본 서식');
});
it('keeps deletion safe and rejects inconsistent or forged recovery typography',()=>{
  expect(inspect(applyRunFormat(nativeParagraph('red🙂'),capture())).map(r=>r.text).join('')).toBe('red🙂');
  for(const data of [{...capture(),text:'wrong'},{...capture(),spans:[{text:'red🙂blue',format:{size:999999}}]},{...capture(),spans:[{text:'red🙂blue',format:{color:'bad'}}]},{...capture(),spans:[{text:'red🙂blue',format:{ascii:'x\0y'}}]}])expect(()=>applyRunFormat(nativeParagraph('red🙂blue'),data as NativeRunFormat)).toThrow();
});
it('gives explicit code syntax priority over preserved fonts and removes semantic Consolas on exit',()=>{
  const data=captureRunFormat(nativeParagraph('`code`'),'code');expect(data.spans[0].format).toEqual({});
  expect(inspect(applyRunFormat(nativeParagraph('code'),data))[0].font).toBeUndefined();
  expect(inspect(applyRunFormat(nativeParagraph('`red🙂`blue'),capture()))[0]).toMatchObject({font:'Consolas',color:'AA5500',size:'25'});
});
it('rejects newly added unsupported direct formatting during source entry, not just enrollment',()=>{
  expect(()=>captureRunFormat(original.replace('w:val="AA5500"','w:val="AA5500" w:themeColor="accent1"'),'red🙂blue')).toThrow('서식');
});
