const {createNativeHarness}=await import('/scripts/word-host/native-runtime.ts');
globalThis.formatFlow=createNativeHarness(nativeBodyToken);
await formatFlow.session.select('format-a');
const record=(await formatFlow.host.journals())[0];must(record.nativeFormat?.spans.length>1,'durable typography stored before source mutation');
return {source:await formatFlow.host.read('format-a'),record};
