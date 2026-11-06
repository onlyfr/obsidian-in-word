const {initializeBodyHarness}=await import('/scripts/word-host/session-runtime.ts');initializeBodyHarness();
globalThis.must=(ok,message)=>{if(!ok)throw new Error('ASSERT: '+message);};
const pending=await bodySession.pendingRecovery();must(pending.includes('session-a'),'saved document contains source recovery journal');
must((await bodyPort.read('session-b')).text==='한글 보존','neighbor survived save/reopen');
await moveBody(null);await bodySession.recover('session-a','current');
must((await bodyPort.read('session-a')).text==='Edited first','recover saved source after runtime restart');
await bodySession.resume();await moveBody('session-a');await bodySession.select('session-a');
return {documentReopened:true,pending,sourceRecovered:true};
