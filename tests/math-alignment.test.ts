import {expect,it} from 'vitest';
import {renderMathSvg} from '../src/convert/math-svg';

// MathJax emits nested translate/scale transforms. Compare actual glyph positions, not nonempty output.
function position(path:Element){
 let x=0,y=0;
 for(let node:Element|null=path;node;node=node.parentElement){
  const transforms=[...(node.getAttribute('transform')??'').matchAll(/(translate|scale)\(([^)]+)\)/g)];
  for(const [,kind,args] of transforms.reverse()){
   const [a,b]=args.trim().split(/[ ,]+/).map(Number);
   if(kind==='translate'){x+=a;y+=b??0;}else{x*=a;y*=b??a;}
  }
 }
 return {x,y};
}
it.each(['aligned','align'])('aligns unequal-length rows at & in %s',environment=>{
 const equals=renderMathSvg('=',false).querySelector('path')!.getAttribute('d');
 const svg=renderMathSvg(String.raw`\begin{${environment}}a&=b+c\\longname&=d\end{${environment}}`,true);
 const matches=[...svg.querySelectorAll('path')].filter(path=>path.getAttribute('d')===equals).map(position);
 expect(matches).toHaveLength(2);expect(matches[0].x).toBeCloseTo(matches[1].x,3);
 expect(Math.abs(matches[0].y-matches[1].y)).toBeGreaterThan(500);
});
it('keeps both alignment pairs in alignedat',()=>{
 const equals=renderMathSvg('=',false).querySelector('path')!.getAttribute('d');
 const svg=renderMathSvg(String.raw`\begin{alignedat}{2}a&=b+c&\qquad u&=v\\longname&=d&w&=z+q\end{alignedat}`,true);
 const points=[...svg.querySelectorAll('path')].filter(path=>path.getAttribute('d')===equals).map(position);
 expect(points).toHaveLength(4);expect(points[0].x).toBeCloseTo(points[2].x,3);expect(points[1].x).toBeCloseTo(points[3].x,3);
});
it('does not leak user macros or accept malformed/unavailable commands as successful images',()=>{
 expect(()=>renderMathSvg(String.raw`\newcommand{\owbtest}{x}\owbtest`,false)).not.toThrow();
 for(const source of [String.raw`\owbtest`,String.raw`\frac{a}`,String.raw`\require{html}`,String.raw`\href{https://example.test}{x}`]){
  expect(()=>renderMathSvg(source,false)).toThrow();
 }
});
