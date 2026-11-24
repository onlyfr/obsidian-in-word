// Equal signs are isolated pairs of flat strokes. Require one common x coordinate in every row.
function checkAlignment(px,width,height) {
 const strokes=[];
 for(let y=1;y<height-1;y++) {
  for(let x=1;x<width-1;x++) {
   if(px[(y*width+x)*4+3]<96)continue;
   const start=x;
   while(x<width && px[(y*width+x)*4+3]>=96)x++;
   if(x-start>=16 && x-start<=42)strokes.push({x:start,y,w:x-start});
  }
 }
 const pairs=strokes.filter(a=>strokes.some(b=>Math.abs(b.x-a.x)<=1 && Math.abs(b.w-a.w)<=1 && b.y-a.y>=5 && b.y-a.y<=15));
 const aligned=pairs.some(a=>{
  let last=-100,rows=0;
  for(const b of pairs)if(Math.abs(b.x-a.x)<=1 && b.y-last>25){last=b.y;rows++;}
  return rows===5;
 });
 must(aligned,'five equal signs aligned in the final Word PNG');
}
await reset('<p>Document font fixture</p>');
const md = 'Inline $123+x_i^2$ next.\n\n$$\n' + String.raw`\begin{align}
P(A\cup B\cup C)&=P(A\cup(B\cup C))\\
&=P(A)+P(B\cup C)-P(A\cap(B\cup C))\\
P(A\cap(B\cup C))&=P((A\cap B)\cup(A\cap C))\\
&=P(A\cap B)+P(A\cap C)-P(A\cap B\cap C)&\\
&=P(A)+P(B)+P(C)-P(B\cap C)-P(A\cap B)-P(C\cap A)+P(A\cap B\cap C)
\end{align}`+'\n$$';
const observations=[];
for(const name of ['Cambria Math','Arial','Cambria Math']){
 await Word.run(async c=>{
  const r=c.document.getSelection();r.font.name=name;r.font.size=11;r.font.color='#000000';await c.sync();
 });
 const applied=await word.replaceSelectionWithMarkdown(md,async()=>true,{mathOutput:'images',mathAppearanceSource:'document'});
 must(applied.notes.some(n=>n.includes(name)),'actual Word font reported');
 const state=await snapshot(),entries=sidecar.sidecarFromXml(state.sidecars[0]);
 const ids=equations.scanOoxml(state.xml).items.filter(x=>x.kind==='mathimg').map(x=>x.id);
 must(ids.length===2,'both formulas inserted');
 const [inline,block]=ids.map(id=>entries.get(id));
 must(inline.baseline>0 && inline.baseline<inline.h && /<w:position w:val="-\d+"/.test(state.xml),'inline descent applied in actual Word');
 const img=new Image();img.src='data:image/png;base64,'+block.png;await img.decode();
 const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;
 const ctx=cv.getContext('2d');ctx.drawImage(img,0,0);
 const px=ctx.getImageData(0,0,cv.width,cv.height).data;
 let ink=0;for(let i=3;i<px.length;i+=4)if(px[i]>32){
  const point=(i-3)/4,x=point%cv.width,y=Math.floor(point/cv.width);
  must(x>1 && y>1 && x<cv.width-2 && y<cv.height-2,'final PNG has transparent edge');ink++;
 }
 checkAlignment(px,cv.width,cv.height);
 must(ink>0 && block.display,'visible block');
 observations.push({ids,png:inline.png,block:block.png});
}
must(observations[0].ids.every((id,i)=>id!==observations[1].ids[i]),'distinct font cache IDs');
must(observations[0].png!==observations[1].png,'font changes actual inline PNG');
must(JSON.stringify(observations[0])===JSON.stringify(observations[2]),'returning to font restores original bytes');
return {md,ids:observations[2].ids};
