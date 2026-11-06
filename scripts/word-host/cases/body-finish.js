const p=bodyProbe;const deadline=performance.now()+7000;
while((p.mode!=='rendered'||p.busy) && !p.error && performance.now()<deadline)await new Promise(r=>setTimeout(r,100));
try{
 must(!p.error,p.error);must(p.mode==='rendered','exit restores rendered paragraph');
 const result=await Word.run(async c=>{
  const cc=c.document.contentControls.getById(p.id);cc.load('text');
  const html=cc.getRange('Content').getHtml();const all=c.document.body;all.load('text');await c.sync();
  must(cc.text.trim()==='Probe edited and more.','edited content is rendered');
  const markdown=obsidian.htmlToMarkdown(html.value,new sidecar.MemorySidecar());
  must(/Probe \*\*edited\*\* and (?:\*more\*|_more_)\./.test(markdown),'bold and italic roundtrip');
  must(all.text.includes('Probe outside.'),'outside paragraph retained');
  return {text:cc.text,markdown};
 });
 await new Promise(r=>setTimeout(r,500));must(p.transitions.length===2,'no conversion feedback loop');
 return {...result,events:p.events,transitions:p.transitions,experimental:true};
}finally{
 clearTimeout(p.timer);
 await new Promise((resolve,reject)=>Office.context.document.removeHandlerAsync(Office.EventType.DocumentSelectionChanged,{handler:p.handler},r=>r.status===Office.AsyncResultStatus.Succeeded?resolve():reject(r.error)));
}
