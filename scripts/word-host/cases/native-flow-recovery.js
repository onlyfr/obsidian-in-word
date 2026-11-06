const {createNativeHarness}=await import('/scripts/word-host/native-runtime.ts');
const before=await nativeFlow.port.read('input-a');
nativeFlow.host.failAt=nativeFaultStage;
let failure='';try {await nativeFlow.session.select('input-a');}catch(e){failure=String(e);}
must(failure.includes('(9)'),'injected native interruption reported: '+failure);
globalThis.nativeFlow=createNativeHarness(nativeBodyToken);
const records=await nativeFlow.port.journals(), pending=await nativeFlow.session.pendingRecovery();
must(pending.includes('input-a'),'fresh controller finds native recovery record');
must(records[0].nativeStage===['','prepared','content','tagged'][nativeFaultStage],'native interruption stage persisted');
if(nativeFaultStage<3){
 let refused=false;try{await nativeFlow.session.recover('input-a','current');}catch{refused=true;}
 must(refused,'ambiguous current content is not guessed');
 await nativeFlow.session.recover('input-a','original');
}else await nativeFlow.session.recover('input-a','current');
const restored=await nativeFlow.port.read('input-a');
must(restored.mode==='rendered' && restored.text===before.text,'explicit native recovery restores rendered paragraph');
must((await nativeFlow.port.journals())[0].phase==='closed','native recovery closes journal');
globalThis.nativeFlow=createNativeHarness(nativeBodyToken);
return {stage:nativeFaultStage,pending,records,restored};
