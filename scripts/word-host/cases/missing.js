await selectAll();const before=await snapshot();let error='';
try{await word.replaceSelectionWithMarkdown(originalMd+'\n\n<!-- word:obj id=aaaaaaaa kind=image -->',async()=>true);}catch(e){error=String(e);}
const after=await snapshot();must(error.includes('복원할 수 없는 Word 객체'),'missing original rejected');
must(JSON.stringify(before.paragraphs)===JSON.stringify(after.paragraphs),'paragraphs unchanged');
must(before.tables===after.tables && before.equations===after.equations && brief(before).floats===brief(after).floats,'objects unchanged');
must(JSON.stringify(before.sidecars)===JSON.stringify(after.sidecars),'sidecar unchanged');
return {error,before:brief(before),after:brief(after)};
