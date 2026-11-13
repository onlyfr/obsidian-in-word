const before=await snapshot();
document.getElementById('open-settings').click();document.getElementById('plugins-tab').click();
const wait=async(fn,message)=>{const until=Date.now()+10000;while(Date.now()<until && !fn())await new Promise(r=>setTimeout(r,25));must(fn(),message);};
const installed=[];
for(const id of ['transfer-shared-fixture','transfer-new-fixture']){
 const code=`const {Plugin}=require('obsidian');module.exports=class extends Plugin{async onload(){await this.saveData({origin:'source',apiKey:'fixture-only'});}};`;
 const files=new DataTransfer();files.items.add(new File([JSON.stringify({id,name:id,version:'1.0.0'})],'manifest.json'));files.items.add(new File([code],'main.js'));
 const input=document.getElementById('plugin-files');input.files=files.files;input.dispatchEvent(new Event('change'));
 await wait(()=>document.getElementById('inline-confirm-yes'),'source install confirmation');document.getElementById('inline-confirm-yes').click();
 await wait(()=>document.querySelector(`[data-plugin-id="${id}"]`) && !document.getElementById('transfer-export').disabled,'source plugin installed');installed.push(id);
}
for(const [id,value] of [['editor-font-size','18'],['math-output','images'],['math-image-size','16'],['math-image-color','#2457a6']]){const control=document.getElementById(id);control.value=value;control.dispatchEvent(new Event('change'));}
const wrap=document.getElementById('editor-wrap');wrap.checked=false;wrap.dispatchEvent(new Event('change'));
localStorage.setItem('oiw:connection','must-not-export-connection');localStorage.setItem('oiw:document','must-not-export-document');
let exported;const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;
try{URL.createObjectURL=blob=>{exported=blob;return 'blob:transfer-fixture';};HTMLAnchorElement.prototype.click=function(){};
 document.getElementById('transfer-export').click();await wait(()=>!!exported && document.getElementById('transfer-status').textContent.includes('생성 완료'),'product export button generated JSON');
}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}
const text=await exported.text(),archive=JSON.parse(text);
must(document.getElementById('transfer-json-text').value===text,'manual copy fallback matches generated file');
must(archive.plugins.length===2 && archive.plugins.every(p=>p.data.origin==='source'),'source archive includes bundles and plugin data');
must(!text.includes('must-not-export-connection') && !text.includes('must-not-export-document'),'pane connection and document keys omitted');
const after=await snapshot();must(JSON.stringify(after.paragraphs)===JSON.stringify(before.paragraphs) && after.equations===before.equations,'export does not edit Word');
return {archive:text,origin:location.origin,plugins:installed,documentUnchanged:true};
