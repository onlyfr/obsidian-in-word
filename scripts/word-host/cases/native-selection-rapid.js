const deadline=Date.now()+6000;
while(Date.now()<deadline && ((await selectionFlow.host.read('owned-a')).mode!=='rendered' || (await selectionFlow.host.read('owned-b')).mode!=='source'))await new Promise(r=>setTimeout(r,50));
must((await selectionFlow.host.read('owned-a')).mode==='rendered' && (await selectionFlow.host.read('owned-b')).mode==='source','rapid moves resolve to the latest block');
must(selectionLive.errors.length===0,'rapid move errors: '+selectionLive.errors.join(';'));
return {signals:selectionLive.signals,operations:selectionFlow.host.operations};
