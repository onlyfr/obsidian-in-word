await selectAll();
const state=await snapshot();
const ids=equations.scanOoxml(state.xml).items.filter(x=>x.kind==='mathimg').map(x=>x.id);
if(JSON.stringify(ids)!==JSON.stringify(expected.ids))throw new Error('image identity changed after reopen');
const loaded=await word.readSelectionAsMarkdown();
const spans=s=>equations.findMath(s).map(x=>[x.latex,x.display]);
if(JSON.stringify(spans(loaded.markdown))!==JSON.stringify(spans(expected.md)))throw new Error('LaTeX changed after reopen');
return {source:true,images:ids.length};
