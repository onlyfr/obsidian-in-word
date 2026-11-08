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
return {observations,colourVerified:true,sourcePreserved:true};
