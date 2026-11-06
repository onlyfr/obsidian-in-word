const block=await bodyPort.read('session-a');must(block.mode==='source','undo restores source mode and text together');
const fresh=new BodyEditSession(new WordBodyPort(),inlineBodyCodec);
must((await fresh.pendingRecovery()).includes('session-a'),'undo source has recovery record');
await moveBody(null);await fresh.recover('session-a','current');
must((await bodyPort.read('session-a')).text==='Edited first','recover after undo');
return {modeBeforeRecovery:block.mode,text:(await bodyPort.read('session-a')).text,undoRecoverable:true};
