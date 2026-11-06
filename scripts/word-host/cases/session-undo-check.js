const before=await bodyPort.read('session-a');const recordsBefore=await bodyPort.journals();
const observer=new BodyEditSession(new WordBodyPort(),inlineBodyCodec);
await moveBody('session-a');let error='';try{await observer.select('session-a');}catch(e){error=String(e);}
must(!!observer.pausedReason && error.includes('복구'),'undo state pauses');
must(JSON.stringify(await bodyPort.journals())===JSON.stringify(recordsBefore),'undo observation does not rewrite journals');
must((await bodyPort.read('session-a')).revision===before.revision,'undo observation does not overwrite content');
return {paused:true,error,journalPhase:recordsBefore.find(j=>j.key==='session-a').phase};
