globalThis.must=(condition,message)=>{if(!condition)throw new Error('ASSERT: '+message);};
const {createNativeHarness}=await import('/scripts/word-host/native-runtime.ts');
globalThis.selectionFlow=createNativeHarness(nativeBodyToken);
const first=await selectionFlow.host.read('owned-a'),second=await selectionFlow.host.read('owned-b');
must(first?.mode==='rendered' && second?.mode==='rendered','saved ownership resolves both rendered blocks after reopen');
globalThis.selectionLive=selectionFlow.connectSelection(first.epoch);
return {firstId:first.id,secondId:second.id,epoch:first.epoch};
