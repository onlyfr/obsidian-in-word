const host=bodyUiHarness.harness.host,original=host.claim;
globalThis.bodyClaimCommitted=false;
host.claim=async(candidate,key)=>{
 const result=await original(candidate,key);must(result.code===0,'second paragraph registration actually committed');
 bodyClaimCommitted=true;await new Promise(resolve=>{globalThis.releaseBodyClaim=resolve;});return result;
};
document.querySelector('[data-body-start]').click();
await waitControls(()=>bodyClaimCommitted,'registration request in flight');
const reads=host.selectionReads;
document.querySelector('[data-body-stop]').click();
must(document.getElementById('body-controls').dataset.state==='stopping','stop waits for the pending result');
must(document.querySelector('[data-body-start]').disabled,'cannot start a second controller while stopping');
must(!bodyUiHarness.leases.at(-1).closed,'lease is retained until the pending result is known');
releaseBodyClaim();host.claim=original;
await waitControls(()=>document.getElementById('body-controls').dataset.state==='stopped','stop completes after result arrives');
must(host.selectionReads===reads,'no verification reads after stop');
must(host.operations.length===2,'pending operation was not replayed');
return {claims:host.operations.length,postStopReads:host.selectionReads-reads};
