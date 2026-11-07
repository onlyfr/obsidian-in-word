const {renderMathSvg}=await import('/src/convert/math-svg.ts');
const {createRasterizer}=await import('/src/convert/mathraster.ts');
const sources=['aligned','align'].map(env=>String.raw`\begin{${env}}a&=b+c\\longname&=d\end{${env}}`);
sources.push(String.raw`\begin{align}
P(A \cup B \cup C) & =P(A \cup (B \cup C)) \\
 & =P(A)+P(B \cup C)-P(A \cap (B \cup C)) \\
P(A \cap (B \cup C)) & =P( (A \cap B) \cup (A \cap C)) \\
 & =P(A \cap B)+P(A \cap C)-P((A \cap B)\cap(A\cap C)) \\
 & =P(A  \cap B)+P(A \cap C)-P(A \cap B \cap C) &  \\
\therefore P(A \cup B \cup C) & = P(A)+(P(B)+P(C)-P(B \cap C))-(P(A \cap  B)+P(A \cap C)-P(A \cap B \cap C)) \\
 & =P(A)+P(B)+P(C)-(P(A \cap B )+P(B \cap C)+P(C \cap A))+P(A \cap B \cap C)${' '}
\end{align}`);
const equals=renderMathSvg('=',false).querySelector('path').getAttribute('d');
function position(path){
 let x=0,y=0;
 for(let node=path;node;node=node.parentElement){
  const transforms=[...(node.getAttribute('transform')??'').matchAll(/(translate|scale)\(([^)]+)\)/g)];
  for(const [,kind,args] of transforms.reverse()){
   const [a,b]=args.trim().split(/[ ,]+/).map(Number);
   if(kind==='translate'){x+=a;y+=b??0;}else{x*=a;y*=b??a;}
  }
 }
 return {x,y};
}
const positions=sources.map((latex,index)=>{
 const svg=renderMathSvg(latex,true);
 const points=[...svg.querySelectorAll('path')].filter(path=>path.getAttribute('d')===equals).map(position);
 must(points.length===(index===2?7:2) && points.every(point=>Math.abs(points[0].x-point.x)<0.01),'equal signs share an x coordinate');
 must(Math.abs(points[0].y-points[1].y)>500,'two distinct rows');return points;
});
const md=sources.map(source=>'$$\n'+source+'\n$$').join('\n\n');
await reset('<p>Alignment seed</p>');
await word.replaceSelectionWithMarkdown(md,async()=>true,{mathOutput:'images'});
const first=await snapshot();must(brief(first).mathImages===3 && brief(first).equations===0,'aligned, align and user probability formula inserted as images');
const loaded=await word.readSelectionAsMarkdown();
must(JSON.stringify(equations.findMath(loaded.markdown).map(q=>q.latex))===JSON.stringify(sources),'alignment source and ampersands preserved');
await word.replaceSelectionWithMarkdown(loaded.markdown,async()=>true,{mathOutput:'images'});
const second=await snapshot();must(brief(second).mathImages===3,'no duplicate alignment images');
const preview=await(await createRasterizer()).render(sources[2],true);
return {positions,roundtrip:true,images:3,...preview};
