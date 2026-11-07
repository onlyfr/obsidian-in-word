await waitControls(()=>document.getElementById('body-controls').dataset.state==='error','real observer shutdown stops preparation');
must(bodyUiHarness.leases.every(lease=>lease.closed),'lost observer closes client leases');
must(bodyUiHarness.harness.host.operations.length===1,'disconnect does not re-enroll or render');
return {state:'error',message:document.querySelector('[data-body-status]').textContent};
