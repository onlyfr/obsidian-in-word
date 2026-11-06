const blocks=Array.from({length:30},(_,i)=>`Section ${i}\n\n`+('Content '+i+' lorem ipsum dolor sit amet. ').repeat(30)+`\n\n| H1 | H2 |\n| --- | --- |\n| Row ${i} | Value ${i} |\n\n$$\nx_{${i}}^2+1\n$$\n\n$$\n\\frac{a_{${i}}}{b+1}\n$$\n\n<!-- word:blank -->`).join('\n\n');
await reset('<p>Large fixture seed</p>');
const seedStart=performance.now();await word.replaceSelectionWithMarkdown(blocks,async()=>true);const seedMs=performance.now()-seedStart;
await selectAll();const start=performance.now();const loaded=await word.readSelectionAsMarkdown();const loadMs=performance.now()-start;
const before=brief(await snapshot());const cycles=[];
for(let i=0;i<3;i++){
 const t=performance.now();await word.replaceSelectionWithMarkdown(loaded.markdown,async()=>true);const ms=performance.now()-t;
 const after=brief(await snapshot());must(after.tables===30,'large tables');must(after.equations===60,'large equations');must(after.markers.length===0,'large no markers');
 must(JSON.stringify(after.paragraphs.map(p=>p.text))===JSON.stringify(before.paragraphs.map(p=>p.text)),'large paragraph stability '+i);
 cycles.push({ms,paragraphs:after.paragraphs.length,tables:after.tables,equations:after.equations});
}
return {markdownLength:loaded.markdown.length,seedMs,loadMs,paragraphs:before.paragraphs.length,cycles};
