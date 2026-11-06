const {initializeBodyHarness}=await import('/scripts/word-host/session-runtime.ts');initializeBodyHarness();
await reset('<p>Alpha <strong>bold</strong> tail</p><p>Outside caret target.</p>');
await Word.run(async c=>{
 const cc=c.document.body.paragraphs.getFirst().getRange('Whole').insertContentControl();cc.tag=bodyTag('input-a','rendered');
 c.document.body.paragraphs.getLast().getRange('Start').select();await c.sync();
});
return {desktop14:Office.context.requirements.isSetSupported('WordApiDesktop','1.4')};
