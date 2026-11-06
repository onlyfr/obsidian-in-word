const pending=await nativeFlow.session.pendingRecovery(),records=await nativeFlow.port.journals();
must(pending.includes('input-a'),'native undo leaves an explicitly recoverable source');
return {pending,records,block:await nativeFlow.port.read('input-a')};
