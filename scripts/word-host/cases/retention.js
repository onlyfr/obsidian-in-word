await reset('<p>Region A</p><p>Region B</p>');
const latex='\\boxed{'+Array.from({length:32},(_,i)=>'x_{'+i+'}').join('+')+'}';
const source='Region A\n\n$$\n'+latex+'\n$$\n\nRegion B';
const applied=await word.replaceSelectionWithMarkdown(source,async()=>true);
let storedId='';let oldT=0;
await Word.run(async c=>{
 const parts=c.document.customXmlParts.getByNamespace(sidecar.SIDECAR_NAMESPACE);parts.load('items');await c.sync();
 const xmls=parts.items.map(p=>p.getXml());await c.sync();
 const store=new sidecar.MemorySidecar();for(const x of xmls)sidecar.sidecarFromXml(x.value,store);
 const id=equations.mathImgKey(latex,true);storedId=id;const entry=store.get(id);must(!!entry,'long formula stored as mathimg');
 oldT=sidecar.dayNumber()-100;store.set(id,{...entry,t:oldT});
 parts.items.forEach(p=>p.delete());c.document.customXmlParts.add(sidecar.sidecarToXml(store));await c.sync();
 const b=c.document.body.search('Region B',{matchCase:true});b.load('items');await c.sync();b.items[0].paragraphs.getFirst().getRange('Whole').select();await c.sync();
});
const regionB=await word.readSelectionAsMarkdown();must(regionB.markdown==='Region B','other region read');
const snap=await snapshot();let found;for(const xml of snap.sidecars){const store=sidecar.sidecarFromXml(xml);found=store.get(storedId)??found;}
must(found?.latex===latex,'100-day-old original retained');must(found.t===oldT,'unrelated read does not touch date');
await selectAll();const reread=await word.readSelectionAsMarkdown();must(reread.markdown.includes(latex),'long formula remains editable');
must(snap.mathImages===1,'one math picture');return {latexLength:latex.length,storedId,oldT,regionB,applied,state:brief(snap),roundTrip:true};
