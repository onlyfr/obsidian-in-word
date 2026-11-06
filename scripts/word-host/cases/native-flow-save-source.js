await nativeFlow.session.select('input-a');
const current=await nativeFlow.port.read('input-a');
must(current.mode==='source','saved fixture enters source');
return {current,snapshot:await nativeFlow.host.read('input-a'),records:await nativeFlow.port.journals()};
