const {createRasterizer}=await import('/src/convert/mathraster.ts');
const {mathImgAlt}=await import('/src/convert/mathimg.ts');
const {png}=await (await createRasterizer()).render('x^2',false);
await Word.run(async c=>{
 const cell=c.document.body.tables.getFirst().getCell(0,0);
 cell.body.insertInlinePictureFromBase64(png,'End').altTextDescription=mathImgAlt(equations.mathImgKey('x^2',false),'x^2',false);
 await c.sync();
});
await selectAll();
const loaded=await word.readSelectionAsMarkdown();
const before=await snapshot();
const edit=loaded.markdown.replace('Start fixture','Edited fixture');
must(edit!==loaded.markdown,'fixture paragraph was loaded');
await word.applyParagraphEdit(edit);
const after=await snapshot();
must(after.xml.includes('Edited fixture') && !after.xml.includes('Start fixture'),'text changed');
const objects=xml=>{
 const d=new DOMParser().parseFromString(xml,'application/xml');
 return ['tbl','anchor','binaryData'].map(name=>Array.from(d.getElementsByTagNameNS('*',name),e=>new XMLSerializer().serializeToString(e).replace(/ w:rsid\w*="[^"]*"/g,'')));
};
const original=objects(before.xml);
must(original.every(group=>group.length>0),'table, float, embedded picture present');
must(JSON.stringify(original)===JSON.stringify(objects(after.xml)),'original table, anchor and image data preserved');
return {partial:true,table:true,float:true,picture:true};
