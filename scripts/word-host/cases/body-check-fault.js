const host=bodyUiHarness.harness.host;
host.failAt=3;
let failure='';try{await bodyUiHarness.harness.session.select(bodyUiFirstKey);}catch(error){failure=String(error);}
must(failure.includes('(9)'),'real native failure injected after source tag mutation');
host.failAt=0;
globalThis.checkFaultOperations=host.operations.length;
document.querySelector('[data-body-check]').click();
await waitControls(()=>document.getElementById('body-controls').dataset.state==='error','partial transition blocks status check');
must(document.querySelector('[data-body-status]').textContent.includes('Ctrl+Z'),'Word Undo guidance');
must(host.operations.length===checkFaultOperations,'status check does not replay partial transition');
return {partialFailure:true,writesByCheck:0};
