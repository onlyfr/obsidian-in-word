const {createNativeHarness}=await import('/scripts/word-host/native-runtime.ts');
globalThis.formatFlow=createNativeHarness(nativeBodyToken);
must(await formatFlow.ownership.claimSelected('format-a')==='format-a','concrete color/font/size paragraph enrolls');
return await formatFlow.host.read('format-a');
