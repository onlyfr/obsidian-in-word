must(await selectionFlow.host.read('owned-b')===null,'deleted owned control is not reconstructed from matching text');
let rejected=false;try{await selectionFlow.session.select('owned-b');}catch{rejected=true;}
must(rejected,'missing owned identity refuses entry');
must(selectionFlow.session.pausedReason,'missing owned identity pauses the session');
selectionLive.dispose();
return {paused:selectionFlow.session.pausedReason};
