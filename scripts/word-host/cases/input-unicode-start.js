await reset('<p>A 😀 <strong>한글</strong> 끝</p><p>Outside Unicode.</p>');
await Word.run(async c=>{const cc=c.document.body.paragraphs.getFirst().getRange('Whole').insertContentControl();cc.tag=bodyTag('input-unicode','rendered');await c.sync();});
globalThis.bodySession=new BodyEditSession(new WordBodyPort(),inlineBodyCodec);
return true;
