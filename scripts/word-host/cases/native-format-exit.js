await formatFlow.session.select(null);
const result=await formatFlow.host.read('format-a');must(result.mode==='rendered','restored native paragraph');return result;
