await moveBody(null);await bodySession.select(null);
must((await bodyPort.read('session-a')).mode==='rendered','leave before undo');
return (await bodyPort.journals()).map(j=>({key:j.key,phase:j.phase}));
