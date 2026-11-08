await reset('<p>Identity seed</p>');
const seed=String.raw`Mixed $x^2$ and CAT_END end.

- list-inline $\boxed{E=mc^2}$ and LIST_CAT
- repeated $x^2$

$$
\begin{aligned}a&=b+c\\longname&=d\end{aligned}
$$`;
await word.replaceSelectionWithMarkdown(seed,async()=>true,{mathOutput:'images'});
const initial=await snapshot(),stored=sidecar.sidecarFromXml(initial.sidecars[0]);
const [mathId,mathEntry]=[...stored.entries()].find(([,entry])=>entry.kind==='mathimg');
const png=mathEntry.png;
await Word.run(async c=>{
 for(const label of ['CAT_END','LIST_CAT']){
  const found=c.document.body.search(label,{matchCase:true});found.load('items');await c.sync();
  const picture=found.items[0].insertInlinePictureFromBase64(png,'Replace');picture.altTextDescription='ordinary-cat-'+label;
 }
 const table=c.document.body.insertTable(2,2,'End',[['Table math','CELL_EQ'],['plain','cell']]);
 const picture=table.getCell(0,0).body.insertInlinePictureFromBase64(png,'End');
 picture.altTextDescription=mathimg.mathImgAlt(mathId,mathEntry.latex,!!mathEntry.display);
 await c.sync();
 const found=c.document.body.search('CELL_EQ',{matchCase:true});found.load('items');await c.sync();
 found.items[0].insertOoxml(equations.equationPackage('<m:oMath><m:sSup><m:e><m:r><m:t>z</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>'),'Replace');
 c.document.body.getRange('Whole').select();await c.sync();
});
const before=await snapshot();
const full=await word.readSelectionAsMarkdown();
const spans=md=>equations.findMath(md).map(q=>({latex:q.latex,display:q.display}));
must(JSON.stringify(spans(full.markdown))===JSON.stringify(spans(seed)),'whole selection exposes all editable math sources');
must((full.markdown.match(/word:img id=/g)||[]).length===2,'ordinary images have inline references');
must(full.notes.some(note=>note.includes('수식 2개') && note.includes('원본')),'table math explicitly preserved as table original');
await Word.run(async c=>{const p=c.document.body.paragraphs.getFirst();p.getRange('Whole').select();await c.sync();});
const paragraph=await word.readSelectionAsMarkdown();
must(spans(paragraph.markdown).length===1 && spans(paragraph.markdown)[0].latex==='x^2','paragraph selection finds same inline math');
await Word.run(async c=>{const pictures=c.document.body.inlinePictures;pictures.load('items');await c.sync();pictures.items[0].getRange().select();await c.sync();});
const individual=await word.readSelectionAsMarkdown();
must(spans(individual.markdown).length===1 && spans(individual.markdown)[0].latex==='x^2','individual picture selection finds same math');
await Word.run(async c=>{const pictures=c.document.body.tables.getFirst().getCell(0,0).body.inlinePictures;pictures.load('items');await c.sync();pictures.items[0].getRange().select();await c.sync();});
const inCell=await word.readSelectionAsMarkdown();
must(spans(inCell.markdown).length===1,'individual table picture can be read without capturing the surrounding table');
must(!inCell.markdown.includes('kind=table'),'partial picture selection does not adopt whole table');
await selectAll();
const refusalBefore=await snapshot();
let missingRejected=false;
try{await word.replaceSelectionWithMarkdown(full.markdown.replace(/word:img id=[0-9a-f]{8}/,'word:img id=0badf00d'),async()=>true,{mathOutput:'images'});}catch(error){missingRejected=String(error).includes('0badf00d');}
must(missingRejected,'missing inline image source refuses before document mutation');
const refusalAfter=await snapshot();
must(JSON.stringify(refusalAfter.paragraphs)===JSON.stringify(refusalBefore.paragraphs) && JSON.stringify(refusalAfter.sidecars)===JSON.stringify(refusalBefore.sidecars),'refused apply keeps document and originals unchanged');
const cycles=[];
for(let i=0;i<3;i++){
 await word.replaceSelectionWithMarkdown(full.markdown,async()=>true,{mathOutput:'images'});
 const after=await snapshot();
 must(after.tables===before.tables && after.pictures===before.pictures && after.equations===before.equations && after.mathImages===before.mathImages,'mixed object counts stable cycle '+i);
 must(JSON.stringify(after.paragraphs.map(p=>p.text.replace(/\s+/g,' ').trim()))===JSON.stringify(before.paragraphs.map(p=>p.text.replace(/\s+/g,' ').trim())),'paragraph count and text stable cycle '+i);
 const loaded=await word.readSelectionAsMarkdown();
 must(JSON.stringify(spans(loaded.markdown))===JSON.stringify(spans(seed)),'all math sources retained cycle '+i);
 must(!after.markers.length,'no unresolved internal marker');cycles.push(brief(after));
}
return {whole:spans(full.markdown),individual:spans(individual.markdown),paragraph:spans(paragraph.markdown),notes:full.notes,before:brief(before),cycles};
