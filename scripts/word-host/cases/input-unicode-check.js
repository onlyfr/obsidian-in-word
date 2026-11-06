await bodySession.select('input-unicode');
const caret=await Word.run(async c=>{
 const cc=c.document.contentControls.getByTag(bodyTag('input-unicode','source')).getFirst();const r=cc.getRange('Content');r.load('start,text');const s=c.document.getSelection();s.load('start,end');await c.sync();return {text:r.text,start:s.start-r.start,end:s.end-r.start};
});
must(caret.text==='A 😀 **한글** 끝' && caret.start===8 && caret.end===8,'native UTF-16 caret agrees with emoji/Korean source map');
return caret;
