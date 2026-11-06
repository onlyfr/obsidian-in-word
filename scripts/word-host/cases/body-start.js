// Feasibility probe only: one ordinary paragraph, a stable content control, and the common selection event.
// Not a shipping editor: IME, coauthoring, crashes/reload, undo reconciliation and rapid moves still need design.
await reset('<p>Probe target with <strong>bold</strong> text.</p><p>Probe outside.</p>');
globalThis.bodyProbe={mode:'rendered',events:0,transitions:[],error:null,busy:false,timer:null};
const p=bodyProbe;
await Word.run(async c=>{
 const control=c.document.body.paragraphs.getFirst().getRange('Whole').insertContentControl();
 control.tag='owb-body-source-probe';control.title='Experimental source paragraph';control.load('id');
 c.document.body.paragraphs.getLast().getRange('Start').select();await c.sync();p.id=control.id;
});
p.handler=()=>{
 p.events++;
 if(p.busy || p.error)return;
 clearTimeout(p.timer);
 p.timer=setTimeout(async()=>{
  if(p.busy || p.error)return;p.busy=true;
  try{
   await Word.run(async c=>{
    const control=c.document.contentControls.getById(p.id);
    const selected=c.document.getSelection();
    const position=control.getRange('Content').compareLocationWith(selected);await c.sync();
    const inside=['Contains','ContainsStart','ContainsEnd','Equal'].includes(position.value);
    if(inside && p.mode==='rendered'){
     const html=control.getRange('Content').getHtml();await c.sync();
     const markdown=obsidian.htmlToMarkdown(html.value,new sidecar.MemorySidecar());
     must(!markdown.includes('\n'),'single-paragraph probe');
     control.insertText(markdown,'Replace');p.mode='source';
     control.getRange('Content').getRange('End').select();await c.sync();
     p.transitions.push({to:'source',markdown,at:performance.now()});
    }else if(!inside && p.mode==='source'){
     control.load('text');await c.sync();const markdown=control.text.trim();
     must(!markdown.includes('\n'),'single-paragraph source');
     c.trackedObjects.add(selected);
     try{control.insertHtml(obsidian.markdownToHtml(markdown),'Replace');p.mode='rendered';await c.sync();selected.select();await c.sync();}
     finally{selected.untrack();}
     p.transitions.push({to:'rendered',markdown,at:performance.now()});
    }
   });
  }catch(e){p.error=String(e);}finally{p.busy=false;}
 },150);
};
await new Promise((resolve,reject)=>Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged,p.handler,r=>r.status===Office.AsyncResultStatus.Succeeded?resolve():reject(r.error)));
return {id:p.id,registered:true};
