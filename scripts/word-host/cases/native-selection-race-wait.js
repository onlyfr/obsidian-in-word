const deadline=Date.now()+6000;
while(Date.now()<deadline && !selectionRaceWaiting)await new Promise(r=>setTimeout(r,50));
must(selectionRaceWaiting,'real B render committed while completion is deliberately delayed');
globalThis.selectionRaceRevision=selectionLive.signals.at(-1)?.selection;
return {revision:selectionRaceRevision};
