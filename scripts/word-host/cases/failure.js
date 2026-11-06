await selectAll();const loaded=await word.readSelectionAsMarkdown();const before=brief(await snapshot());
const proto=Word.Paragraph.prototype;const original=proto.insertOoxml;const calls=[];
let error='';
proto.insertOoxml=function(xml,where){
 const type=/<m:oMath(?:\s|>)/.test(xml)?'equation':/<w:tbl(?:\s|>)/.test(xml)?'table':'float';calls.push(type);
 return original.call(this,type==='equation'?'<invalid-ooxml/>':xml,where);
};
try{await word.replaceSelectionWithMarkdown(loaded.markdown,async()=>true);}catch(e){error=String(e);}finally{proto.insertOoxml=original;}
const after=brief(await snapshot());
must(error.includes('Ctrl+Z'),'failed apply must be reported');
must(calls.filter(x=>x==='table').length===1,'table scheduled once');
must(calls.filter(x=>x==='float').length===1,'float scheduled once');
must(calls.filter(x=>x==='equation').length===1,'equation scheduled once');
must(after.tables===before.tables,'no duplicated table');
must(after.floats===before.floats,'no duplicated float');
return {before,after,calls,error};
