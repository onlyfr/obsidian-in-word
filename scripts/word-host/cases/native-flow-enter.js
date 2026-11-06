const {createNativeHarness}=await import('/scripts/word-host/native-runtime.ts');
globalThis.nativeFlow=createNativeHarness(nativeBodyToken);
globalThis.nativeFlowOriginal=await nativeFlow.port.read('input-a');
must(nativeFlowOriginal.html.includes('<strong>bold</strong>'),'native OOXML reader recognizes Word character styles: '+nativeFlowOriginal.html);
const run=Word.run;Word.run=()=>{throw new Error('Native flow must not call Office.js');};
try {
 await nativeFlow.session.select('input-a');
 const source=await nativeFlow.host.read('input-a');
 must(source.mode==='source' && source.text==='Alpha **bold** tail','native source entry');
 must(source.selectionStart-source.start===10 && source.selectionEnd===source.selectionStart,'native source caret preserved');
 const records=await nativeFlow.port.journals();must(records.length===1 && records[0].phase==='editing','native entry journal complete');
 return {source,records,operations:nativeFlow.host.operations};
} finally {Word.run=run;}
