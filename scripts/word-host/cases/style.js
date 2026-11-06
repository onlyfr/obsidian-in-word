await selectAll();await word.replaceSelectionWithMarkdown(originalMd,async()=>true);
const before=brief(await snapshot());
const unknown=originalMd;
const proto=Word.Paragraph.prototype;const original=proto.insertOoxml;const calls=[];
const descriptor=Object.getOwnPropertyDescriptor(proto,'style');
Object.defineProperty(proto,'style',{...descriptor,set(value){descriptor.set.call(this,'OWBInjectedMissingStyle_'+Date.now());}});
proto.insertOoxml=function(xml,where){calls.push(/<m:oMath(?:\s|>)/.test(xml)?'equation':/<w:tbl(?:\s|>)/.test(xml)?'table':'float');return original.call(this,xml,where);};
let result;try{result=await word.replaceSelectionWithMarkdown(unknown,async()=>true);}finally{proto.insertOoxml=original;Object.defineProperty(proto,'style',descriptor);}
const after=brief(await snapshot());
must(result.notes.some(n=>n.includes('스타일')),'unknown style warning');
must(after.markers.length===0,'no markers');must(after.tables===before.tables && after.equations===before.equations && after.floats===before.floats,'objects preserved');
must(calls.length===3,'three object insertions total');
return {result,calls,before,after};
