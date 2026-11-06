const {initializeBodyHarness}=await import('/scripts/word-host/session-runtime.ts');initializeBodyHarness();
await reset('<p>Twin <strong>bold</strong></p><p>Twin <strong>bold</strong></p><p>Outside untouched.</p>');
await Word.run(async c=>{
 const ps=c.document.body.paragraphs;ps.load('items');await c.sync();
 for(const [i,key] of ['session-a','session-b'].entries()){
  const cc=ps.items[i].getRange('Whole').insertContentControl();cc.tag=bodyTag(key,'rendered');cc.title='Body session experiment';
 }
 ps.items[2].getRange('Start').select();await c.sync();
});
return {a:await bodyPort.read('session-a'),b:await bodyPort.read('session-b')};
