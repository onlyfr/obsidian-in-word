const {createNativeHarness}=await import('/scripts/word-host/native-runtime.ts');
nativeFlow.host.failAt=2;
let failure='';try{await nativeFlow.session.select(null);}catch(e){failure=String(e);}
must(failure.includes('(9)'),'closing interruption reported');
globalThis.nativeFlow=createNativeHarness(nativeBodyToken);
const records=await nativeFlow.port.journals();
must(records[0].phase==='closing' && records[0].nativeStage==='content','closing content-stage journal');
let refused=false;try{await nativeFlow.session.recover('input-a','current');}catch{refused=true;}
must(refused,'rendered text with stale source tag is not interpreted as Markdown');
await nativeFlow.session.recover('input-a','original');
const restored=await nativeFlow.port.read('input-a');
must(restored.mode==='rendered' && restored.text==='Alpha edited / more / strike tail','closing interruption original recovery');
globalThis.nativeFlow=createNativeHarness(nativeBodyToken);
return {records,restored};
