const operations=bodyUiHarness.harness.host.operations.length;
document.querySelector('[data-body-check]').click();
await waitControls(()=>document.getElementById('body-controls').dataset.state==='checked','unregistered status check');
must(document.querySelector('[data-body-status]').textContent.includes('등록되지'),'unregistered is reported');
must(bodyUiHarness.harness.host.operations.length===operations,'unregistered status check never enrolls');
return {unregistered:true,writes:0};
