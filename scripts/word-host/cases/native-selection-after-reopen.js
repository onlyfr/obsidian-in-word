const deadline=Date.now()+6000;
while(Date.now()<deadline && (await selectionFlow.host.read('owned-a')).mode!=='source')await new Promise(r=>setTimeout(r,50));
const first=await selectionFlow.host.read('owned-a');
must(first.mode==='source' && first.text==='First **bold** end.','reopened native selection events enter the same owned block');
must(selectionLive.errors.length===0,'reopened selection stream remains healthy');
return {firstId:first.id,signals:selectionLive.signals};
