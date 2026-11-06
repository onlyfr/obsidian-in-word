try{
 const typed=await bodyPort.read('input-a');
 must(typed.mode==='source','unobserved IME state never auto-renders');must(inputEvents.reads===0,'unknown gate does not poll Word while typing');
 const korean=typed.text.includes('가나다');
 await Word.run(async c=>{
  const outside=c.document.body.paragraphs.getLast().getRange('Content');outside.load('start,end');await c.sync();
  const start=outside.start;outside.start=start+4;outside.end=start+4;outside.select();await c.sync();
 });
 // The probe's Space key committed the sequence. This explicit test signal is not an automatic TSF/IME bridge.
 await inputDriver.signal('idle');
 const restored=await bodyPort.read('input-a');must(restored.mode==='rendered','explicit committed-input signal releases the pending render');
 const caret=await Word.run(async c=>{const p=c.document.body.paragraphs.getLast().getRange('Content');const s=c.document.getSelection();p.load('start');s.load('start,end');await c.sync();return {start:s.start-p.start,end:s.end-p.start};});
 must(caret.start===4 && caret.end===4,'outside cursor remains at its relative position');
 await new Promise(r=>setTimeout(r,300));must(inputEvents.errors.length===0,'event driver has no errors');
 return {sourceBeforeCommit:typed.text,koreanCommitted:korean,caret,events:inputEvents.events,readsAfterExplicitIdle:inputEvents.reads,unknownGateVerified:true,automaticImeBridge:false};
}finally{
 inputDriver.dispose();
 await new Promise((resolve,reject)=>Office.context.document.removeHandlerAsync(Office.EventType.DocumentSelectionChanged,{handler:inputHandler},r=>r.status===Office.AsyncResultStatus.Succeeded?resolve():reject(r.error)));
}
