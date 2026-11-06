formatFlow.host.dropReply=true;
let failure='';try{await formatFlow.session.select(null);}catch(e){failure=e.constructor.name;}
must(failure==='NativeOutcomeUnknown','render response loss is indeterminate to caller');
must(formatFlow.host.operations.length===2,'source and render each submitted once');
const {createNativeHarness}=await import('/scripts/word-host/native-runtime.ts');
globalThis.formatFlow=createNativeHarness(nativeBodyToken);
must((await formatFlow.session.pendingRecovery()).length===0,'completed closing journal needs no replay');
const result=await formatFlow.host.read('format-a');must(result.mode==='rendered' && result.text==='Start redWorks blueTail.','real native render retained local edit');
must(formatFlow.host.operations.length===0,'fresh runtime only inspects the completed outcome');return result;
