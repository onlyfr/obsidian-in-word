const notified=Date.now()+3000;
while(Date.now()<notified && selectionLive.signals.at(-1)?.selection===selectionRaceRevision)await new Promise(r=>setTimeout(r,25));
must(selectionLive.signals.at(-1)?.selection!==selectionRaceRevision,'return-to-B native selection hint arrived');
await new Promise(r=>setTimeout(r,350)); // The debounce must elapse while the conversion still awaits its reply.
const reads=selectionFlow.host.selectionReads;
selectionFlow.host.transition=selectionRaceOriginal;selectionRaceFinish();
const deadline=Date.now()+6000;
while(Date.now()<deadline && (await selectionFlow.host.read('owned-b')).mode!=='source')await new Promise(r=>setTimeout(r,50));
must((await selectionFlow.host.read('owned-b')).mode==='source','B re-enters source after B → A → B during the pending render');
must(selectionFlow.host.selectionReads>reads,'latest selection is re-read after pending conversion completes');
must(selectionLive.errors.length===0,'delayed conversion did not fail the connection');
return {readsAfter:selectionFlow.host.selectionReads,readsBefore:reads,operations:selectionFlow.host.operations};
