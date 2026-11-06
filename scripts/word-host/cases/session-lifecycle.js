await moveBody('session-a');await bodySession.select('session-a');
must((await bodyPort.read('session-a')).mode==='source','enter a');
await editBody('session-a','Edited **first**');
await moveBody('session-b');await bodySession.select('session-b');
must((await bodyPort.read('session-a')).text==='Edited first','render edited a');
// Requests may arrive while the previous read/journal/write is awaiting a host sync. The latest target wins.
await moveBody('session-a');const first=bodySession.select('session-a');
await moveBody('session-b');const second=bodySession.select('session-b');
await moveBody('session-a');const third=bodySession.select('session-a');
await Promise.all([first,second,third]);must(bodySession.activeKey==='session-a','latest rapid target a');
await bodySession.composition(true);await moveBody('session-b');await bodySession.select('session-b');
must((await bodyPort.read('session-a')).mode==='source','composition defers rendering');
must((await bodyPort.read('session-b')).mode==='rendered','composition defers entering');
await bodySession.composition(false);must(bodySession.activeKey==='session-b','composition drains latest target');
await editBody('session-b','한글 **보존**');
const restarted=new BodyEditSession(new WordBodyPort(),inlineBodyCodec);
must((await restarted.pendingRecovery()).includes('session-b'),'document journal survives controller replacement');
await moveBody(null);await restarted.recover('session-b','current');
must((await bodyPort.read('session-b')).text==='한글 보존','recover current Korean source');
// A real Word write succeeds, then a simulated bridge failure occurs before the mode tag can be changed.
const interruptedPort=new WordBodyPort();let writes=0;
interruptedPort.source=async(expected,markdown)=>{
 writes++;await editBody(expected.key,markdown);throw new Error('Injected bridge interruption after text write');
};
const interrupted=new BodyEditSession(interruptedPort,inlineBodyCodec);
await moveBody('session-a');let failed='';try{await interrupted.select('session-a');}catch(e){failed=String(e);}
must(failed.includes('Injected') && writes===1,'partial entry fails without retry');
const recovery=new BodyEditSession(new WordBodyPort(),inlineBodyCodec);
must((await recovery.pendingRecovery()).includes('session-a'),'partial rendered-tag/source-text state is recoverable');
let ambiguous='';try{await recovery.recover('session-a','current');}catch(e){ambiguous=String(e);}
must(ambiguous.includes('판단할 수 없습니다'),'ambiguous state does not auto interpret source');
await recovery.recover('session-a','original');must((await bodyPort.read('session-a')).text==='Edited first','explicit original restore');
globalThis.bodySession=new BodyEditSession(new WordBodyPort(),inlineBodyCodec);
await moveBody('session-a');await bodySession.select('session-a');
return {rapidTarget:'session-a',compositionGate:true,koreanRecovery:true,partialWriteAttempts:writes,explicitRestore:true,
 records:(await bodyPort.journals()).map(j=>({key:j.key,phase:j.phase})),bText:(await bodyPort.read('session-b')).text};
