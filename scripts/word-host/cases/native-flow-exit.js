const run=Word.run;Word.run=()=>{throw new Error('Native flow must not call Office.js');};
try {
 await nativeFlow.session.select(null);
 const block=await nativeFlow.port.read('input-a'), snapshot=await nativeFlow.host.read('input-a');
 must(block.mode==='rendered','native render mode');
 must(block.text==='Alpha edited / more / strike tail','rendered text');
 must(block.html.includes('<strong>edited</strong>') && block.html.includes('<em>more</em>') && block.html.includes('<s>strike</s>'),'native render formatting: '+block.html);
 const records=await nativeFlow.port.journals();must(records[0].phase==='closed' && !records[0].nativeStage,'native render journal complete');
 return {block,snapshot,records,operations:nativeFlow.host.operations};
} finally {Word.run=run;}
