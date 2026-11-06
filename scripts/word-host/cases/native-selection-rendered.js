{
 const deadline=Date.now()+6000;
 while(Date.now()<deadline && (await selectionFlow.host.read('owned-a')).mode!=='rendered')await new Promise(r=>setTimeout(r,50));
 const block=await selectionFlow.port.read('owned-a');
 must(block.mode==='rendered' && block.text==='First bold end.','native event alone renders on exit');
 must(selectionLive.errors.length===0,'native selection driver errors: '+selectionLive.errors.join(';'));
 const events=selectionLive.signals.filter(s=>s.cause==='selection');must(events.length>0,'Word COM selection event received');
 const second=await selectionFlow.host.read('owned-b');must(second.mode==='rendered','second block renders on exit');
 const transitions=selectionFlow.host.operations.length,reads=selectionFlow.host.selectionReads;
 await new Promise(r=>setTimeout(r,1300));
 must(selectionFlow.host.operations.length===transitions,'no selection feedback mutation loop');
 must(selectionFlow.host.selectionReads-reads<=1,'health frames do not poll selection');
 return {block,signals:selectionLive.signals,reads:selectionFlow.host.selectionReads,operations:selectionFlow.host.operations};
}
