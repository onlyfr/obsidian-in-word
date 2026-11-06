globalThis.bodySession=new BodyEditSession(new WordBodyPort(),inlineBodyCodec);
try{await bodySession.select('input-a');}catch(e){const b=await bodyPort.read('input-a');throw new Error(String(e)+' '+JSON.stringify({text:b.text,markdown:inlineBodyCodec.markdown(b.html),paragraph:new DOMParser().parseFromString(b.html,'text/html').querySelector('p')?.outerHTML}));}
const selected=await Word.run(async c=>{const s=c.document.getSelection();s.load('text,start,end');await c.sync();return {text:s.text,length:s.end-s.start};});
must(selected.text==='o' && selected.length===1,'non-collapsed selection survives source conversion');
return selected;
