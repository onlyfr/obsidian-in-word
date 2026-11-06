const record=(await bodyPort.journals()).find(j=>j.key==='session-a');
must(record.phase==='closed','redo restores closed checkpoint');
must((await bodyPort.read('session-a')).mode==='rendered','redo preserves rendered mode');
return {redoPreserved:true,recordPhase:record.phase};
