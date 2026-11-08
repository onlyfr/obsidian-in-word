await reset('<p>Appearance seed</p>');
const md=String.raw`Inline $x^2$ and $\boxed{E=mc^2}$`;
const styles=[undefined,{sizePt:18,color:'#2457a6'},undefined];
const observations=[];
for(const style of styles){
 await word.replaceSelectionWithMarkdown(md,async()=>true,{mathOutput:'images',mathAppearance:style});
 const state=await snapshot(),entries=[...sidecar.sidecarFromXml(state.sidecars[0]).entries()].filter(([,entry])=>entry.kind==='mathimg');
 const loaded=await word.readSelectionAsMarkdown();
 must(equations.findMath(loaded.markdown).map(q=>q.latex).join('|')===equations.findMath(md).map(q=>q.latex).join('|'),'appearance preserves original TeX');
 must(state.mathImages===2 && state.equations===0,'appearance mode keeps image counts');
 observations.push({images:state.mathImages,entries:entries.map(([id,entry])=>({id,latex:entry.latex,display:!!entry.display,w:entry.w,h:entry.h,profile:entry.renderProfile??'',pngLength:entry.png.length}))});
}
const before=observations[0].entries.find(entry=>entry.latex==='x^2' && !entry.display && !entry.profile),after=observations[1].entries.find(entry=>entry.latex==='x^2' && !entry.display && entry.profile==='pt=18;rgb=2457a6');
must(after.w>before.w && after.h>before.h,'size changes actual image dimensions');
const {createRasterizer}=await import('/src/convert/mathraster.ts');
const raster=await(await createRasterizer({sizePt:18,color:'#2457a6'})).render('x^2',false);
const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src='data:image/png;base64,'+raster.png;});
const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const g=canvas.getContext('2d');g.drawImage(img,0,0);
const pixels=g.getImageData(0,0,img.width,img.height).data;
let coloured=false;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>200 && pixels[i+2]>pixels[i]+40){coloured=true;break;}
must(coloured,'configured blue is present in actual PNG pixels');
const selectionProfiles=[];
for(const font of [{size:18,color:'#2457A6'},{size:14,color:'#a62457'}]){
 await Word.run(async c=>{const range=c.document.getSelection();range.font.size=font.size;range.font.color=font.color;await c.sync();});
 const applied=await word.replaceSelectionWithMarkdown(md,async()=>true,{mathOutput:'images',mathAppearanceSource:'selection',mathAppearance:{sizePt:8,color:'#000000'}});
 const state=await snapshot(),profile=`pt=${font.size};rgb=${font.color.slice(1).toLowerCase()}`;
 const sources=[...sidecar.sidecarFromXml(state.sidecars[0]).entries()];
 const imageIds=equations.scanOoxml(state.xml).items.filter(item=>item.kind==='mathimg').map(item=>item.id);
 must(imageIds.length===2 && imageIds.every(id=>sources.find(([key,entry])=>key===id && entry.renderProfile===profile)),'selection style binds actual inserted image profile');
 must(applied.notes.some(note=>note.includes(`${font.size}pt`)),'selection style reported');
 const loaded=await word.readSelectionAsMarkdown();
 must(equations.findMath(loaded.markdown).map(q=>q.latex).join('|')===equations.findMath(md).map(q=>q.latex).join('|'),'selection style preserves TeX');
 selectionProfiles.push(profile);
}
await reset('<p>Small text</p><p>Large text</p>');
await Word.run(async c=>{const ps=c.document.body.paragraphs;ps.load('items');await c.sync();ps.items[0].font.size=11;ps.items[1].font.size=18;await c.sync();});
await selectAll();
const mixedBefore=await snapshot();let rejected=false;
try{await word.replaceSelectionWithMarkdown(md,async()=>true,{mathOutput:'images',mathAppearanceSource:'selection'});}catch(error){rejected=String(error).includes('직접 지정');}
must(rejected,'mixed sizes refuse instead of choosing an arbitrary profile');
const mixedAfter=await snapshot();
must(JSON.stringify(mixedAfter.paragraphs)===JSON.stringify(mixedBefore.paragraphs) && JSON.stringify(mixedAfter.sidecars)===JSON.stringify(mixedBefore.sidecars),'mixed-format refusal does not change content or sidecar');
await word.replaceSelectionWithMarkdown(md,async()=>true,{mathOutput:'images',mathAppearanceSource:'manual',mathAppearance:{sizePt:16,color:'#123456'}});
must((await snapshot()).mathImages===2,'manual override still works for mixed selection');
await Word.run(async c=>{
 const selection=c.document.getSelection();selection.font.size=12;selection.font.color='#000000';
 const text=c.document.body.search('Inline',{matchCase:true});text.load('items');await c.sync();
 text.items[0].font.color='#ff0000';await c.sync();
});
const colourBefore=await snapshot();let colourRejected=false;
try{await word.replaceSelectionWithMarkdown(md,async()=>true,{mathOutput:'images',mathAppearanceSource:'selection'});}catch(error){colourRejected=String(error).includes('직접 지정');}
const colourAfter=await snapshot();
must(colourRejected && JSON.stringify(colourAfter.paragraphs)===JSON.stringify(colourBefore.paragraphs) && JSON.stringify(colourAfter.sidecars)===JSON.stringify(colourBefore.sidecars),'mixed colours refuse without content or original writes');
await word.replaceSelectionWithMarkdown(md,async()=>true,{mathOutput:'hybrid',mathAppearanceSource:'selection'});
const hybrid=await snapshot();must(hybrid.equations===1 && hybrid.mathImages===1,'hybrid ignores image appearance source even on mixed formatting');
return {observations,colourVerified:true,sourcePreserved:true,selectionProfiles,mixedRefusedWithoutWrites:true,mixedColourRefused:true,hybridUnaffected:true};
