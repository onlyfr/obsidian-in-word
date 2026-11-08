const operations=bodyUiHarness.harness.host.operations.length;
document.querySelector('[data-body-check]').click();
await waitControls(()=>document.getElementById('body-controls').dataset.state==='error','Undo with leftover transition record stays stopped');
must(bodyUiHarness.harness.host.operations.length===operations,'Undo inspection is read-only');
must(document.querySelector('[data-body-status]').textContent.includes('Ctrl+Z'),'Undo guidance retained');
return {refused:true,writes:0};
