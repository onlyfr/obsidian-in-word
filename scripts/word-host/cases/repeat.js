await selectAll();
const loaded=await word.readSelectionAsMarkdown();
globalThis.originalMd=loaded.markdown;
globalThis.baseline=brief(await snapshot());
const cycles=[];
for(let i=0;i<3;i++){
 const started=performance.now();const result=await word.replaceSelectionWithMarkdown(originalMd,async()=>true);
 const state=brief(await snapshot());
 must(state.tables===baseline.tables,'table count at cycle '+i);
 must(state.equations===baseline.equations,'equation count at cycle '+i);
 must(state.floats===baseline.floats,'floating count at cycle '+i);
 must(state.paragraphs.length===baseline.paragraphs.length,'paragraph count at cycle '+i);
 must(JSON.stringify(state.paragraphs.map(p=>p.text))===JSON.stringify(baseline.paragraphs.map(p=>p.text)),'paragraph text at cycle '+i);
 must(state.markers.length===0,'no markers at cycle '+i);
 must(!state.isEmpty,'selection retained at cycle '+i);
 cycles.push({ms:performance.now()-started,state,result});
}
const reread=await word.readSelectionAsMarkdown();must(reread.markdown===originalMd,'markdown round trip');
return {baseline,markdown:originalMd,cycles,roundTrip:true};
