try {
 const typed=nativeTyped;
 await new Promise(r=>setTimeout(r,200));
 const active=nativeImeEvents.filter(e=>e.state==='active' && e.cause==='edit');
 must(active.length>0,'TSF OnEndEdit observed an actual composition');
 must(nativeImeEvents.some(e=>e.state==='idle' && e.cause==='edit' && e.seq>active.at(-1).seq),'TSF OnEndEdit observed composition finalization');
 must(inputEvents.illegalReads===0,'no Word selection queries while composition active/unknown');
 // Do not interrogate getHtml/getOoxml repeatedly while testing selection-event delivery.
 await new Promise(r=>setTimeout(r,600));
 must((await bodyPort.read('input-a')).mode==='rendered','native signal + selection event released rendering without a manual idle signal: '+JSON.stringify({state:inputDriver.state,events:inputEvents,paused:bodySession.pausedReason,composing:bodySession.composing}));
 const caret=await Word.run(async c=>{const p=c.document.body.paragraphs.getLast().getRange('Content');const s=c.document.getSelection();p.load('start');s.load('start,end');await c.sync();return {start:s.start-p.start,end:s.end-p.start};});
 must(caret.start===4 && caret.end===4,'outside cursor preserved');
 nativeImeSource.close();nativeImeConnection.disconnect();
 const reads=inputEvents.reads;inputDriver.notify();await new Promise(r=>setTimeout(r,200));
 must(inputDriver.state==='unknown' && inputEvents.reads===reads,'disconnect closes the gate');
 must(inputEvents.errors.length===0,'native driver has no errors');
 return {source:typed.text,caret,automaticImeBridge:true,activeEditEvents:active.length,signals:nativeImeEvents,reads:inputEvents.reads,illegalReads:inputEvents.illegalReads,disconnectGate:true};
} finally {
 nativeImeSource.close();nativeImeConnection.disconnect();inputDriver.dispose();
 await new Promise((resolve,reject)=>Office.context.document.removeHandlerAsync(Office.EventType.DocumentSelectionChanged,{handler:inputHandler},r=>r.status===Office.AsyncResultStatus.Succeeded?resolve():reject(r.error)));
}
