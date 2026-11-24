const before=await snapshot(),realFetch=globalThis.fetch;
const item={id:'community-download-fixture',name:'Community <img> fixture',author:'Fixture Maker',description:'Math editor fixture',repo:'fixture/community-test'};
const catalog=[item,...Array.from({length:44},(_,i)=>({id:'other-'+i,name:'Other '+i,author:'Other Maker',description:'Other editor',repo:'fixture/other-'+i}))];
let version='1.0.0',failCode=false;
const main=()=>`const {Plugin,PluginSettingTab}=require('obsidian');module.exports=class extends Plugin{async onload(){
 document.body.dataset.communityRuns=String(Number(document.body.dataset.communityRuns||0)+1);
 const previous=await this.loadData();await this.saveData({kept:previous?.kept||'fixture-data'});
 this.addCommand({id:'insert',name:'Community insert fixture',editorCallback:editor=>editor.replaceSelection('COMMUNITY_APPLIED')});
 this.addSettingTab(new class extends PluginSettingTab{display(){this.containerEl.createEl('p',{text:'Community fixture ${version} settings'});}}(this.app,this));
}};`;
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const wait=async(predicate,message)=>{const end=Date.now()+10000;while(Date.now()<end && !predicate())await new Promise(r=>setTimeout(r,25));must(predicate(),message);};
const row=()=>document.querySelector('[data-plugin-id="'+item.id+'"]');
const button=(text)=>Array.from(row()?.querySelectorAll('button')??[]).find(button=>button.textContent===text);
try{
 globalThis.fetch=async(url,options)=>{
  const address=String(url);
  if(address.includes('obsidian-releases/master/community-plugins.json'))return json(catalog);
  const files={'manifest.json':JSON.stringify({id:item.id,name:item.name,version}),'main.js':main(),'styles.css':'.community-fixture {color:blue}'};
  if(address===`https://api.github.com/repos/${item.repo}/releases/latest`){
   const assets=await Promise.all(Object.entries(files).map(async([name,source],i)=>{
    const bytes=new TextEncoder().encode(source),hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    return {id:i+1,name,size:bytes.length,digest:'sha256:'+Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('')};
   }));
   return json({tag_name:version,draft:false,prerelease:false,assets});
  }
  if(address.startsWith(`https://gh-proxy.com/https://github.com/${item.repo}/releases/download/${version}/`)){
   const name=address.split('/').pop();
   if(failCode && name==='main.js')throw new TypeError('Synthetic interrupted download');
   return new Response(files[name]);
  }
  return realFetch(url,options);
 };
 document.getElementById('open-settings').click();document.getElementById('plugins-tab').click();
 const filter=document.getElementById('community-search');filter.value='';filter.dispatchEvent(new Event('input'));
 document.getElementById('community-load').click();
 await wait(()=>document.querySelector('[data-community-id="community-download-fixture"]') && document.querySelectorAll('[data-community-id]').length===20,'catalog page limited to 20 rows');
 must(!document.getElementById('community-results').querySelector('img'),'catalog metadata rendered as text');
 document.getElementById('community-next').click();must(document.getElementById('community-page').textContent.includes('2 / 3'),'catalog pagination works');
 const search=document.getElementById('community-search');search.value='math maker';search.dispatchEvent(new Event('input'));
 must(document.querySelectorAll('[data-community-id]').length===1,'search uses combined name/description/author terms');
 must(!document.querySelector('[data-community-id] button').disabled,'web downloads available');
 const download=()=>document.querySelector('[data-community-id] button').click();
 download();await wait(()=>!!button('켜기') && !button('켜기').disabled,'download stored disabled');
 must(!document.body.dataset.communityRuns,'download did not execute code');
 const {PluginLibrary,LocalDataStore}=await import('/src/plugins/storage.ts');
 const stored=(await new PluginLibrary().list()).find(p=>p.manifest.id===item.id);
 must(stored && !stored.enabled && stored.source.tag==='1.0.0','download persists bundle/version/source in IndexedDB');
 button('켜기').click();await wait(()=>!!button('설정') && !button('설정').disabled,'downloaded plugin activated');
 must(document.body.dataset.communityRuns==='1','plugin loaded exactly once');
 must(document.head.querySelector('style[data-plugin="'+item.id+'"]')?.textContent.includes('community-fixture'),'downloaded stylesheet applied');
 const commands=document.getElementById('plugin-commands');commands.value=Array.from(commands.options).find(option=>option.textContent==='Community insert fixture').value;
 document.getElementById('plugin-run').click();must(document.querySelector('.cm-content').textContent.includes('COMMUNITY_APPLIED'),'downloaded command edits task pane');
 button('설정').click();must(document.getElementById('plugin-settings').textContent.includes('1.0.0 settings'),'downloaded plugin settings work');document.getElementById('settings-back').click();
 version='2.0.0';failCode=true;download();await wait(()=>document.getElementById('community-status').textContent.includes('실패'),'interrupted update shown');
 must(row().textContent.includes('1.0.0') && !!button('끄기'),'failed download preserves active installed version');
 failCode=false;download();await wait(()=>!!document.getElementById('inline-confirm-no'),'replacement reviewed after download');document.getElementById('inline-confirm-no').click();
 await wait(()=>document.getElementById('community-status').textContent.includes('취소'),'cancelled replacement shown');must(row().textContent.includes('1.0.0') && !!button('끄기'),'cancel preserves active version');
 download();await wait(()=>!!document.getElementById('inline-confirm-yes'),'replacement confirmation');document.getElementById('inline-confirm-yes').click();
 await wait(()=>row().textContent.includes('2.0.0') && !!button('켜기') && !button('켜기').disabled,'replacement disabled until explicitly enabled');
 must(document.body.dataset.communityRuns==='1','replacement does not execute automatically');
 button('켜기').click();await wait(()=>!!button('설정') && !button('설정').disabled,'new version enabled');
 must(document.body.dataset.communityRuns==='2','new version loads once');
 must(Array.from(commands.options).filter(option=>option.textContent==='Community insert fixture').length===1,'replacement does not duplicate commands');
 must(document.head.querySelectorAll('style[data-plugin="'+item.id+'"]').length===1,'replacement does not duplicate stylesheet');
 must(new LocalDataStore().get(item.id).kept==='fixture-data','plugin settings retained through replacement');
 const after=await snapshot();must(JSON.stringify(before.paragraphs)===JSON.stringify(after.paragraphs) && before.tables===after.tables && before.equations===after.equations,'community operations leave Word content unchanged');
 document.getElementById('close-settings').click();
 return {pagination:true,search:true,downloadWithoutExecution:true,enabledCommand:true,settings:true,failedAndCancelledUpdatePreserved:true,replacedVersion:'2.0.0',documentUnchanged:true};
}finally{globalThis.fetch=realFetch;}
