const {createNativeHarness}=await import('/scripts/word-host/native-runtime.ts');
globalThis.formatFlow=createNativeHarness(nativeBodyToken);formatFlow.host.dropReply=true;
let failure='';try{await formatFlow.session.select('format-a');}catch(e){failure=e.constructor.name;}
must(failure==='NativeOutcomeUnknown','lost HTTP reply has explicit unknown outcome');
must(formatFlow.host.operations.length===1,'source request is not replayed');
must((await formatFlow.host.read('format-a')).mode==='source','worker actually committed before reply loss');
return {failure,records:await formatFlow.host.journals()};
