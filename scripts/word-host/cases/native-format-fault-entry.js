const {createNativeHarness}=await import('/scripts/word-host/native-runtime.ts');
globalThis.formatFlow=createNativeHarness(nativeBodyToken);formatFlow.host.failAt=2;
let failure='';try{await formatFlow.session.select('format-a');}catch(e){failure=String(e);}
must(failure.includes('(9)'),'injected failure after text mutation reported');
must(formatFlow.host.operations.length===1 && formatFlow.session.pausedReason,'partial entry is paused and not replayed');
must((await formatFlow.host.read('format-a')).text==='Start **redWorks** blueTail.','partial mutation really happened');
return {failure,operations:formatFlow.host.operations};
