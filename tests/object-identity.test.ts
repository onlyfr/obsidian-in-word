import {expect,it} from 'vitest';
import {htmlToMarkdown,markdownToHtml,renderWithSidecar,type MathReport} from '../src/convert/obsidian';
import {scanOoxml} from '../src/convert/equations';
import {MemorySidecar,sidecarFromXml,sidecarToXml} from '../src/convert/sidecar';
import {placeholderIds} from '../src/convert/blocks';
import {scanTables} from '../src/convert/tables';
const image=(alt:string)=>`<w:r><w:drawing><wp:inline><wp:docPr descr="${alt}"/></wp:inline></w:drawing></w:r>`;
const alt='owb:math:1234abcd x^2';
const body=`<w:body><w:p>${image(alt)}${image('cat')}</w:p></w:body>`;
it('keeps math editable alongside an ordinary picture in the same paragraph',()=>{
 const sc=new MemorySidecar(),report:MathReport={total:0,latex:0,opaque:0,unpaired:0};
 const md=htmlToMarkdown(`<p>before <img alt="${alt}"> and <img alt="cat"> after</p>`,sc,new Map(),['TUFUSA==','Q0FU'],undefined,undefined,scanOoxml(body).items,report);
 expect(md).toContain('$x^2$');expect(md).toContain('before');expect(md).toContain('after');
 const rendered=renderWithSidecar(md,sc);expect(rendered.equations).toHaveLength(1);expect(rendered.html).toContain('Q0FU');expect(rendered.missing).toEqual([]);
});
it('keeps math editable in list items containing ordinary pictures',()=>{
 const sc=new MemorySidecar();
 const md=htmlToMarkdown(`<ul><li>math <img alt="${alt}"></li><li>cat <img alt="cat"></li></ul>`,sc,new Map(),['TUFUSA==','Q0FU'],undefined,undefined,scanOoxml(body).items);
 expect(md).toContain('$x^2$');expect(md).toMatch(/^- /m);expect(renderWithSidecar(md,sc).equations).toHaveLength(1);
});
it('does not scan unrelated document parts after the selected body',()=>{
 const pkg=body+`<pkg:part><w:hdr>${image('header')}</w:hdr></pkg:part>`;
 expect(scanOoxml(pkg).items).toHaveLength(2);
});
it('ignores compatibility fallback pictures and unrelated header tables',()=>{
 const xml=`<w:body><w:p><mc:AlternateContent><mc:Choice Requires="w14">${image(alt)}</mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:p></w:body><w:hdr><w:tbl><w:tr/></w:tbl></w:hdr>`;
 expect(scanOoxml(xml).items).toHaveLength(1);expect(scanTables(xml)).toEqual([]);
});
it('reads escaped attributes without confusing XML encoding with the original TeX',()=>{
 expect(scanOoxml(`<w:body>${image('owb:math:1234abcd a&#38;b&#x3C;c&apos;')}</w:body>`).items[0]).toMatchObject({latex:"a&b<c'"});
});
it('refuses conflicting HTML/OOXML identities and sidecar sources',()=>{
 const report:MathReport={total:0,latex:0,opaque:0,unpaired:0};
 const md=htmlToMarkdown('<p><img alt="owb:math:99999999 x"></p>',new MemorySidecar(),new Map(),undefined,undefined,undefined,scanOoxml(`<w:body>${image(alt)}</w:body>`).items,report);
 expect(report.unpaired).toBe(1);expect(md).not.toContain('$x^2$');
 const sc=new MemorySidecar();sc.set('1234abcd',{kind:'mathimg',html:'',latex:'different',display:false});
 const next:MathReport={total:0,latex:0,opaque:0,unpaired:0};
 const converted=htmlToMarkdown(`<p><img alt="${alt}"></p>`,sc,new Map(),undefined,undefined,undefined,scanOoxml(`<w:body>${image(alt)}</w:body>`).items,next);
 expect(converted).not.toContain('$different$');expect(next.unpaired).toBe(1);
});
it('inline image references survive missing source checks, literal code and repeated images',()=>{
 const sc=new MemorySidecar();const md=htmlToMarkdown('<p><img id="Picture1" alt="cat"> twice <img id="Picture2" alt="cat"></p>',sc,new Map(),['Q0FU','Q0FU']);
 const refs=[...placeholderIds(md)];expect(refs).toHaveLength(1);
 const rendered=renderWithSidecar(md,sc);expect(rendered.html.match(/<img/g)).toHaveLength(2);
 expect(renderWithSidecar(md,new MemorySidecar()).missing).toHaveLength(2);
 expect(renderWithSidecar('`'+md.split(' twice ')[0]+'`',new MemorySidecar()).missing).toEqual([]);
});
it('refuses blank replacements when ordinary image bytes cannot be matched',()=>{
 const sc=new MemorySidecar(),md=htmlToMarkdown('<p><img src="~WRS.files/a.png"></p>',sc,new Map(),[]);
 expect(renderWithSidecar(md,sc).lost).toHaveLength(1);
});
it('preserves math-containing tables as complete packages with explicit equation accounting',()=>{
 const sc=new MemorySidecar(),report:MathReport={total:0,latex:0,opaque:0,unpaired:0};
 const table=`<w:tbl><w:tr><w:tc><w:p>${image(alt)}</w:p></w:tc></w:tr></w:tbl>`;
 const md=htmlToMarkdown(`<table><tr><td><img alt="${alt}"></td></tr></table>`,sc,new Map(),['TUFUSA=='],undefined,undefined,scanOoxml(table).items,report,[{raw:table,gz:table,pkg:'complete-table-package',mathCount:1}]);
 const result=renderWithSidecar(md,sc);expect(result.opaqueEquations).toBe(1);expect(result.floats[0]).toMatchObject({ooxml:'complete-table-package',table:true});expect(report.unpaired).toBe(0);expect(report.preserved).toBe(1);
});
it('preserves math together with floating objects without hiding unresolved equation tokens',()=>{
 const sc=new MemorySidecar(),report:MathReport={total:0,latex:0,opaque:0,unpaired:0};
 const md=htmlToMarkdown(`<p><img align="left" alt="float"> next <img alt="${alt}"></p>`,sc,new Map(),['TUFUSA=='],['original-floating-paragraph'],undefined,scanOoxml(`<w:body><wp:anchor/>${image(alt)}</w:body>`).items,report);
 const rendered=renderWithSidecar(md,sc);expect(rendered.opaqueEquations).toBe(1);expect(rendered.floats[0].ooxml).toBe('original-floating-paragraph');
 expect([...sc.entries()].map(([,entry])=>entry.html).join('')).not.toContain('OWBEQ');
});
it('rejects corrupt or conflicting source parts before overwriting existing bindings',()=>{
 const sc=new MemorySidecar();sc.set('1234abcd',{kind:'mathimg',html:'',latex:'original'});
 const other=new MemorySidecar();other.set('1234abcd',{kind:'mathimg',html:'',latex:'different'});
 expect(()=>sidecarFromXml(sidecarToXml(other),sc)).toThrow('충돌');expect(sc.get('1234abcd')!.latex).toBe('original');
 for(const payload of [null,[],{'1234abcd':null},{bad:{kind:'image',html:''}}])expect(()=>sidecarFromXml('<sidecar>'+encodeURIComponent(JSON.stringify(payload))+'</sidecar>')).toThrow();
});
it('keeps typed marker text literal and does not resolve images outside a sidecar-aware render',()=>{
 const sc=new MemorySidecar();sc.set('1234abcd',{kind:'image',html:'<img src="data:image/png;base64,Q0FU">',inline:true});
 const text=htmlToMarkdown('<p>&lt;!-- word:img id=1234abcd --&gt;</p>');
 expect(renderWithSidecar(text,sc).html).not.toContain('<img');
 expect(markdownToHtml('<!-- word:img id=1234abcd -->')).toContain('&lt;!--');
});
it('refuses a math-looking HTML marker when OOXML says it is an ordinary image',()=>{
 const sc=new MemorySidecar(),report:MathReport={total:0,latex:0,opaque:0,unpaired:0};
 const md=htmlToMarkdown(`<p><img alt="${alt}"></p>`,sc,new Map(),['Q0FU'],undefined,undefined,[{kind:'pic'}],report);
 expect(report.unpaired).toBe(1);expect(renderWithSidecar(md,sc).lost).toHaveLength(1);
});
