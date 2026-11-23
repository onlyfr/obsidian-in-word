const change=async(index,value)=>Word.run(async c=>{
 const ps=c.document.body.paragraphs;ps.load('items');await c.sync();
 ps.items[index].getRange('Content').insertText(value,'Replace');
 c.document.body.getRange('Whole').select();await c.sync();
});
const texts=async()=>Word.run(async c=>{const ps=c.document.body.paragraphs;ps.load('items/text');await c.sync();return ps.items.map(p=>p.text);});
await reset('<p>First sentence</p><p>Second sentence</p>');
const base=await word.readSelectionAsMarkdown();
const draft=base.markdown.replace('First sentence','Pane edit');
await change(1,'Second  sentence');
let blocked=false;
try{await word.replaceSelectionWithMarkdown(draft,async message=>{blocked=message.includes('2번째 문단');return false;});}catch{}
must(blocked,'full apply refuses even a whitespace-only Word change');
await word.applyParagraphEdit(draft);
must((await texts()).slice(0,2).join('|')==='Pane edit|Second  sentence','partial apply preserves independent Word text after refused full apply');
await change(0,'Word edit');
blocked=false;
try{await word.applyParagraphEdit(draft.replace('Pane edit','Another edit'));}
catch(e){blocked=String(e).includes('바뀌었습니다');}
must(blocked && (await texts())[0]==='Word edit','same paragraph conflict preserves Word edit');
await word.readSelectionAsMarkdown();
await reset('<p>Word edit</p><p>Second  sentence</p>');
let prompted=false;
try{await word.replaceSelectionWithMarkdown(draft,async()=>{prompted=true;return false;});}catch{}
must(prompted && (await texts())[0]==='Word edit','same text in a different set of paragraphs asks before replacement');
let refusedLateEdit=false;
try{
 await word.replaceSelectionWithMarkdown(draft,async()=>{await change(1,'Edited during confirmation');return true;});
}catch(e){refusedLateEdit=String(e).includes('준비하는 동안');}
must(refusedLateEdit && (await texts())[1]==='Edited during confirmation','late Word edit survives confirmation');
return {lateEdit:true,exactText:true,independentEdit:true,conflict:true,identity:true};
