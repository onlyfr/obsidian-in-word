const source='**굵게** / _기울임_ / ~~취소~~ / **_함께_**\n\n- **항목**\n- ~~두 번째~~\n\n일반 **bo한글ld** 끝';
await reset('<p>Formatting fixture</p>');
const cycles=[];
for(let i=0;i<5;i++){
 await word.replaceSelectionWithMarkdown(i ? cycles.at(-1).markdown : source,async()=>true);
 const loaded=await word.readSelectionAsMarkdown();
 const html=await Word.run(async c=>{const h=c.document.getSelection().getHtml();await c.sync();return h.value;});
 must(!loaded.markdown.includes('****'),'no doubled bold at cycle '+i+': '+loaded.markdown);
 must(!loaded.markdown.includes('~~~~'),'no doubled strike at cycle '+i);
 must(loaded.markdown.includes('**굵게**') && loaded.markdown.includes('~~취소~~'),'bold/strike retained at cycle '+i+': '+loaded.markdown);
 must((loaded.markdown.match(/^- /gm)||[]).length===2,'two list items at cycle '+i+': '+loaded.markdown);
 if(i)must(loaded.markdown===cycles[0].markdown,'stable Markdown at cycle '+i+': '+JSON.stringify({first:cycles[0].markdown,current:loaded.markdown,firstHtml:cycles[0].html}));
 cycles.push({markdown:loaded.markdown,html});
}
return {source,cycles};
