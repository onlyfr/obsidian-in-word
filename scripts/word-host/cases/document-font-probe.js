const {mathRenderer,mathMLToElement}=await import('/src/plugins/math-impl.ts');
must(await mathRenderer.load(),'Temml ready');
await reset('<p>Font probe</p>');
const families=['Cambria Math','Arial','Times New Roman'];
const corpus={digits:'123',variable:'x',sum:String.raw`\sum_{i=1}^{n}i`,aligned:String.raw`\begin{aligned}a&=b+c\\longname&=d\end{aligned}`};
corpus.align=String.raw`\begin{align}a&=b+c\\&=d&\\longname&=e\end{align}`;
const results={};
let samplePng;
for(const family of families){
 const actual=await Word.run(async c=>{
  const range=c.document.body.paragraphs.getFirst().getRange('Content');
  range.font.name=family;await c.sync();range.font.load('name');await c.sync();return range.font.name;
 });
 must(actual===family,'Word returned requested font');
 const samples={};
 for(const [name,source] of Object.entries(corpus)){
  const math=mathMLToElement(mathRenderer.mathml(source,true).html);
  must(math,'MathML root');
  math.removeAttribute('display');math.classList.remove('tml-display');
  math.style.display='inline math';math.style.fontFamily='"'+actual+'", math';math.style.mathStyle='normal';
  // A standalone picture has no page-width alignment gutters.
  for(const el of math.querySelectorAll('mtable,mtd'))if(el.style.width.endsWith('%'))el.style.removeProperty('width');
  const box=document.createElement('div');
  box.style.cssText='width:max-content;font-size:20px;color:black;white-space:nowrap;line-height:normal';
  const style=document.createElement('style');style.textContent=mathRenderer.css;
  const baseline=document.createElement('span');baseline.style.display='inline-block';
  box.append(style,math,baseline);
  const host=document.createElement('div');host.style.cssText='width:max-content;position:fixed;left:-2000px;top:0;visibility:hidden';
  host.append(box);document.body.append(host);
  let metrics;
  try {
   const rect=math.getBoundingClientRect();
   const equals=[...math.querySelectorAll('mo')].filter(e=>e.textContent==='=').map(e=>e.getBoundingClientRect().left-rect.left);
   metrics={width:rect.width,height:rect.height,baseline:baseline.getBoundingClientRect().bottom-rect.top,equals};
  }finally{host.remove();}
  const xml=new XMLSerializer().serializeToString(box);
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="420" height="180"><foreignObject width="420" height="180">'+xml+'</foreignObject></svg>';
  const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();
  const canvas=document.createElement('canvas');canvas.width=840;canvas.height=360;
  const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,840,360);
  const pixels=ctx.getImageData(0,0,840,360).data;
  must(pixels.some((v,i)=>i%4===3 && v>32),'visible glyph pixels: '+family+' '+name);
  if(family==='Cambria Math' && name==='sum')samplePng=canvas.toDataURL('image/png').split(',')[1];
  const digest=await crypto.subtle.digest('SHA-256',pixels);
  samples[name]={...metrics,pixels:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')};
 }
 results[family]=samples;
}
await reset('<p>Document font image</p>');
await Word.run(async c=>{
 const picture=c.document.getSelection().insertInlinePictureFromBase64(samplePng,'Replace');
 picture.altTextDescription=mathimg.mathImgAlt(equations.mathImgKey(corpus.sum,false),corpus.sum,false);
 c.document.body.getRange('Whole').select();await c.sync();
});
const loaded=await word.readSelectionAsMarkdown();
must(equations.findMath(loaded.markdown).some(q=>q.latex===corpus.sum),'Word image retains editable source');
return {fonts:results,sourceRoundtrip:true};
