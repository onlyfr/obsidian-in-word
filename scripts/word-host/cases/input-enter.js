await bodySession.select('input-a');
const result=await Word.run(async c=>{
 const cc=c.document.contentControls.getByTag(bodyTag('input-a','source')).getFirst();
 const content=cc.getRange('Content');const selection=c.document.getSelection();content.load('start,text');selection.load('start,end');await c.sync();
 return {text:content.text,start:selection.start-content.start,end:selection.end-content.start};
});
must(result.start===10 && result.end===10,'caret remains between bo and ld after source conversion');
return result;
