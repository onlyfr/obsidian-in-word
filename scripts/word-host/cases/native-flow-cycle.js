await nativeFlow.session.select('input-a');
const snapshot=await nativeFlow.host.read('input-a');
must(snapshot.mode==='source','repeat entry mode');
must(snapshot.text==='Alpha **edited** / _more_ / ~~strike~~ tail','repeat Markdown stays stable: '+snapshot.text);
must(snapshot.text.slice(snapshot.selectionStart-snapshot.start,snapshot.selectionEnd-snapshot.start)==='dit','noncollapsed selection preserved');
return {text:snapshot.text,selection:[snapshot.selectionStart-snapshot.start,snapshot.selectionEnd-snapshot.start],records:await nativeFlow.port.journals()};
