const must=(ok,message)=>{if(!ok)throw new Error(message);};
const wait=async(fn,message)=>{const until=Date.now()+15000;while(Date.now()<until && !fn())await new Promise(r=>setTimeout(r,25));must(fn(),message);};
const row=id=>document.querySelector(`[data-plugin-id="${id}"]`);
await wait(()=>row('transfer-new-fixture')?.textContent.includes('로드됨') && !document.getElementById('transfer-file').disabled,'imported enabled plugin persists after Word reopen');
must(document.getElementById('math-output').value==='images' && localStorage.getItem('oiw:transfer-pending')===null,'uncommitted interruption resolved before preferences and plugins initialize');
must(document.getElementById('editor-font-size').value==='18' && row('transfer-shared-fixture').textContent.includes('9.0.0'),'preferences and existing version persist');
must(JSON.parse(localStorage.getItem('oiw:data:transfer-new-fixture')).origin==='source','imported data persists');
document.getElementById('open-settings').click();document.getElementById('plugins-tab').click();
for(const id of ['transfer-new-fixture','transfer-shared-fixture']){
 Array.from(row(id).querySelectorAll('button')).find(b=>b.textContent==='삭제').click();await wait(()=>!row(id) && !document.getElementById('transfer-file').disabled,'fixture cleanup');localStorage.removeItem('oiw:data:'+id);
}
for(const [key,value] of transferExpected.previous){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}
return {pluginsPersisted:true,preferencesPersisted:true,interruptionResolved:true,fixtureRemoved:true};
