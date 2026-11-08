const operations=bodyUiHarness.harness.host.operations.length;
document.querySelector('[data-body-start]').click();
await waitControls(()=>document.getElementById('body-controls').dataset.state==='error','unfinished record blocks restart on another paragraph');
must(bodyUiHarness.harness.host.operations.length===operations,'no claim or rewrite elsewhere after partial failure');
must(bodyUiHarness.leases.every(lease=>lease.closed),'failure releases lease');
bodyUiHarness.detach();
return {blockedElsewhere:true,writes:0,automaticConversion:false};
