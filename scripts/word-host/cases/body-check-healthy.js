const before=await snapshot(),operations=bodyUiHarness.harness.host.operations.length;
document.querySelector('[data-body-check]').click();
await waitControls(()=>document.getElementById('body-controls').dataset.state==='checked','read-only check finishes');
const after=await snapshot();
must(bodyUiHarness.harness.host.operations.length===operations,'status check does not claim, transition or repair');
must(document.querySelector('[data-body-status]').textContent.includes('등록 문단'),'owned rendered paragraph verified');
must(JSON.stringify(before.paragraphs)===JSON.stringify(after.paragraphs),'status check leaves text and styles unchanged');
must(bodyUiHarness.leases.every(lease=>lease.closed),'status check releases its lease');
return {writes:0,unchanged:true,state:'checked'};
