const {createRasterizer}=await import('/src/convert/mathraster.ts');
const latex=String.raw`\int_0^\infty e^{-x^2}\,dx=\frac{\sqrt{\pi}}{2}\qquad \sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}`;
const preview=await(await createRasterizer()).render(latex,true);
const {renderMathSvg}=await import('/src/convert/math-svg.ts');
const svg=renderMathSvg('<math><mi>x</mi></math>',false);
must(svg.querySelectorAll('path').length>0,'MathJax TeX glyph paths bundled');
must(!svg.querySelector('foreignObject,image,use'),'self-contained glyphs, no external font resources');
return {font:'MathJax TeX',loaded:true,latex,...preview};
