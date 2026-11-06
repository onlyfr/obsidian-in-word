const deadline=performance.now()+7000;
while(bodyProbe.mode!=='source' && !bodyProbe.error && performance.now()<deadline)await new Promise(r=>setTimeout(r,100));
must(!bodyProbe.error,bodyProbe.error);must(bodyProbe.mode==='source','selection enters source mode');
return {mode:bodyProbe.mode,events:bodyProbe.events,transitions:bodyProbe.transitions};
