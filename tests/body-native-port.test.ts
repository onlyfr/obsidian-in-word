import {expect,it} from "vitest";
import {NativeBodyPort,NativeOutcomeUnknown,nativeBodyBlock,nativeParagraph,type NativeBodyHost,type NativeBodySnapshot,type NativeTransition} from "../src/body/native-port";
import {BodyEditSession,SelectionMoved,type BodyJournal} from "../src/body/session";
import {inlineBodyCodec} from "../src/body/inline-codec";
import {wrapPackage} from "../src/convert/equations";
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const plain=(s:string)=>wrapPackage(`<w:p><w:r><w:t xml:space="preserve">${escape(s)}</w:t></w:r></w:p>`);
function snapshot(markdown='Alpha **bold** tail'):NativeBodySnapshot {
 const xml=nativeParagraph(markdown);const doc=new DOMParser().parseFromString(xml,'application/xml');
 return {key:'a',epoch:'epoch-a',id:'42',mode:'rendered',style:'Normal',xml,text:Array.from(doc.getElementsByTagNameNS(W,'t')).map(t=>t.textContent).join(''),start:1,selectionStart:9,selectionEnd:9};
}
function journal(xml:string):BodyJournal {
 const root=new DOMParser().parseFromString(xml,'application/xml').documentElement;
 return JSON.parse(decodeURIComponent(root.textContent!));
}
class Host implements NativeBodyHost {
 current=snapshot();records:BodyJournal[]=[];calls:NativeTransition[]=[];failure=0;
 async read(){return {...this.current};}
 async journals(){return this.records.map(r=>({...r}));}
 async transition(change:NativeTransition){
  this.calls.push(change);if(this.failure && this.failure!==9)return {code:this.failure};
  this.records=[journal(change.pending)];
  if(change.mode!=='journal'){
   this.current.xml=change.mode==='source'?plain(change.text):change.xml;
   this.current.text=change.mode==='source'?change.text:Array.from(new DOMParser().parseFromString(change.xml,'application/xml').getElementsByTagNameNS(W,'t')).map(t=>t.textContent).join('');
   if(this.failure===9){this.records[0].nativeStage='content';return {code:9};}
   this.current.mode=change.mode;
   this.current.selectionStart=this.current.start+change.caretStart;this.current.selectionEnd=this.current.start+change.caretEnd;
  }
  this.records=[journal(change.complete)];return {code:0};
 }
}
it('runs the full session through native commits with mapped selection and journals',async()=>{
 const host=new Host(),port=new NativeBodyPort(host),session=new BodyEditSession(port,inlineBodyCodec);
 await session.select('a');expect(host.current.text).toBe('Alpha **bold** tail');expect(host.current.selectionStart-host.current.start).toBe(10);
 expect(host.records[0].phase).toBe('editing');host.current.xml=plain('Alpha **edited** tail');host.current.text='Alpha **edited** tail';
 await session.select(null);expect(host.current.mode).toBe('rendered');expect(host.current.text).toBe('Alpha edited tail');expect(host.records[0].phase).toBe('closed');
 expect(host.calls.map(c=>c.mode)).toEqual(['source','rendered']);
});
it('preserves a noncollapsed rendered selection in source coordinates',async()=>{
 const host=new Host();host.current.selectionEnd=10;const port=new NativeBodyPort(host);const block=(await port.read('a'))!;
 await port.commit(block,{mode:'source',markdown:'Alpha **bold** tail',style:'Normal',journal:{version:1,key:'a',originalMarkdown:'Alpha **bold** tail',originalStyle:'Normal',originalRevision:block.revision,phase:'opening'}});
 expect(host.calls[0].caretStart).toBe(10);expect(host.calls[0].caretEnd).toBe(11);
});
it('refuses outside selection before submitting a native mutation',async()=>{
 const host=new Host();host.current.selectionStart=100;host.current.selectionEnd=100;const port=new NativeBodyPort(host);
 const block=(await port.read('a'))!;
 await expect(port.commit(block,{mode:'source',markdown:'Alpha **bold** tail',style:'Normal',journal:{version:1,key:'a',originalMarkdown:'Alpha **bold** tail',originalStyle:'Normal',originalRevision:block.revision,phase:'opening'}})).rejects.toBeInstanceOf(SelectionMoved);
 expect(host.calls).toHaveLength(0);
});
it('keeps the recovery record on interrupted native mutation and rejects ambiguous current recovery',async()=>{
 const host=new Host(),port=new NativeBodyPort(host),session=new BodyEditSession(port,inlineBodyCodec);host.failure=9;
 await expect(session.select('a')).rejects.toThrow('(9)');expect(await session.pendingRecovery()).toEqual(['a']);
 await expect(session.recover('a','current')).rejects.toThrow('원본 복구');host.failure=0;
 await session.recover('a','original');expect(host.current.mode).toBe('rendered');expect(host.current.text).toBe('Alpha bold tail');expect(host.records[0].phase).toBe('closed');
});
it('does not replay rejected or indeterminate native requests',async()=>{
 for(const code of [1,2,3,5,8,24]){
  const host=new Host();host.failure=code;const session=new BodyEditSession(new NativeBodyPort(host),inlineBodyCodec);
  await expect(session.select('a')).rejects.toThrow(`(${code})`);expect(host.calls).toHaveLength(1);expect(session.pausedReason).toBeTruthy();expect(host.current.mode).toBe('rendered');
 }
});
it('requires journaling with transitions rather than standalone source/render writes',async()=>{
 const port=new NativeBodyPort(new Host());await expect(port.source()).rejects.toThrow('commit');await expect(port.render()).rejects.toThrow('commit');
});
it.each(['[link](https://example.com)','$x$','a\n\nb','- list','![x](image.png)','a\0b','a\tb','a\vb'])('refuses unsupported native rendering before dispatch: %s',md=>expect(()=>nativeParagraph(md)).toThrow());
it('refuses mismatched snapshots and unsupported run content',()=>{
 const original=snapshot();expect(()=>nativeBodyBlock({...original,text:'wrong'})).toThrow('일치');
 expect(()=>nativeBodyBlock({...original,xml:original.xml.replace('<w:b/>','<w:u w:val="single"/>')})).toThrow('서식');
});
it('resolves character styles and honors a direct off override',()=>{
 const source=snapshot();source.xml=source.xml.replace('<w:b/>','<w:rStyle w:val="strong"/><w:b w:val="0"/>').replace('</pkg:package>',`<pkg:part pkg:name="/word/styles.xml" pkg:contentType="x"><pkg:xmlData><w:styles xmlns:w="${W}"><w:style w:styleId="strong"><w:rPr><w:b/></w:rPr></w:style></w:styles></pkg:xmlData></pkg:part></pkg:package>`);
 expect(nativeBodyBlock(source).html).not.toContain('<strong>');
});
it('does not accept a different block identity from the host',async()=>{
 const host=new Host();host.current.key='other';await expect(new NativeBodyPort(host).read('a')).rejects.toThrow('다른 문단');
});
it('refuses modified HTML on an otherwise unchanged native snapshot before dispatch',async()=>{
 const host=new Host(),port=new NativeBodyPort(host),block=(await port.read('a'))!;
 block.html='<p>Alpha <em>bold</em> tail</p>';
 await expect(port.commit(block,{mode:'source',markdown:'Alpha _bold_ tail',style:block.style,journal:{version:1,key:'a',originalMarkdown:'Alpha _bold_ tail',originalStyle:block.style,originalRevision:block.revision,phase:'opening'}})).rejects.toThrow('스냅샷');
 expect(host.calls).toHaveLength(0);
});
it('finds a prepared native record even if content has not changed',async()=>{
 const host=new Host(),port=new NativeBodyPort(host),block=(await port.read('a'))!;
 host.records=[{version:1,key:'a',originalMarkdown:'Alpha **bold** tail',originalStyle:'Normal',originalRevision:block.revision,phase:'opening',nativeStage:'prepared'}];
 const session=new BodyEditSession(port,inlineBodyCodec);expect(await session.pendingRecovery()).toEqual(['a']);
 await expect(session.recover('a','current')).rejects.toThrow('원본 복구');
 await session.recover('a','original');expect(host.records[0].phase).toBe('closed');
});
it('finalizes a tagged native render without rewriting the already restored content',async()=>{
 const host=new Host(),port=new NativeBodyPort(host),block=(await port.read('a'))!;
 host.records=[{version:1,key:'a',originalMarkdown:'Alpha **bold** tail',originalStyle:'Normal',originalRevision:block.revision,phase:'closing',nativeStage:'tagged'}];
 const xml=host.current.xml;await new BodyEditSession(port,inlineBodyCodec).recover('a','current');
 expect(host.calls.map(c=>c.mode)).toEqual(['journal']);expect(host.current.xml).toBe(xml);expect(host.records[0].phase).toBe('closed');
});
it.each(['<br>','`<br>`'])('keeps literal HTML-looking text in native paragraph runs: %s',md=>{
 const source=snapshot(md);expect(source.text).toBe('<br>');expect(nativeBodyBlock(source).text).toBe('<br>');
});
it('can inspect unsupported source edits for explicit original recovery',()=>{
 const source=snapshot();source.mode='source';source.text='a\tb\vc';source.xml=wrapPackage('<w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>');
 expect(nativeBodyBlock(source).text).toBe('a\tb\vc');
});
it('pauses and preserves durable typography after a committed source reply is lost without replaying entry',async()=>{
 const host=new Host();host.current.xml=host.current.xml.replace('<w:b/>','<w:b/><w:color w:val="AA5500"/><w:sz w:val="25"/>');
 const original=host.transition.bind(host);let lost=true;host.transition=async change=>{const result=await original(change);if(lost){lost=false;throw new TypeError('network lost after commit');}return result;};
 const session=new BodyEditSession(new NativeBodyPort(host),inlineBodyCodec);
 await expect(session.select('a')).rejects.toBeInstanceOf(NativeOutcomeUnknown);expect(host.calls).toHaveLength(1);expect(session.pausedReason).toBeTruthy();
 expect(host.records[0].nativeFormat?.spans.some(s=>s.format.color==='AA5500' && s.format.size===25)).toBe(true);
 await session.select(null);await session.composition(false);expect(host.calls).toHaveLength(1);expect(host.current.mode).toBe('source');
});
it('does not replay an applied render when its reply is lost',async()=>{
 const host=new Host(),session=new BodyEditSession(new NativeBodyPort(host),inlineBodyCodec);await session.select('a');
 const original=host.transition.bind(host);host.transition=async change=>{await original(change);throw new TypeError('lost reply');};
 await expect(session.select(null)).rejects.toBeInstanceOf(NativeOutcomeUnknown);
 const fresh=new BodyEditSession(new NativeBodyPort(host),inlineBodyCodec);expect(await fresh.pendingRecovery()).toEqual([]);expect(host.calls.map(c=>c.mode)).toEqual(['source','rendered']);
});
