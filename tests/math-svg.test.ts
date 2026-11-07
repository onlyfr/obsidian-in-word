import {expect,it} from 'vitest';
import {renderMathSvg,safeMathSvg} from '../src/convert/math-svg';
import {mathMLToElement,mathRenderer} from '../src/plugins/math-impl';
it('keeps boxed and cancellation geometry from the existing LaTeX parser',async()=>{
 await mathRenderer.load();
 for(const latex of [String.raw`\boxed{x}`,String.raw`\cancel{x}`]){
  const math=mathMLToElement(mathRenderer.mathml(latex,true).html!)!;
  const svg=renderMathSvg(new XMLSerializer().serializeToString(math),true);
  expect(svg.querySelector('polygon,line')).not.toBeNull();
 }
});
it('draws the built-in MathJax TeX glyphs as self-contained paths',()=>{
 const svg=renderMathSvg('<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mi>π</mi></math>',false);
 expect(svg.querySelectorAll('path').length).toBeGreaterThan(2);
 expect(svg.querySelector('foreignObject,image,use,script,style')).toBeNull();
 expect(svg.getAttribute('viewBox')).toMatch(/^-?\d/);
 expect(svg.querySelector('[href],[onload]')).toBeNull();
});
it('keeps literal markup text and drops active content and external resources',()=>{
 const svg=safeMathSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20" onload="bad()"><script>bad()</script><image href="https://bad"/><foreignObject><div>bad</div></foreignObject><g style="background:url(https://bad)" fill="url(https://bad)"><path d="M0 0L1 1" onclick="bad()"/><text>&lt;img src=x&gt;</text></g></svg>');
 expect(svg.querySelector('script,image,foreignObject,div,[onload],[onclick],[href],[style],[fill]')).toBeNull();
 expect(svg.querySelector('path')!.getAttribute('d')).toBe('M0 0L1 1');
 expect(svg.querySelector('text')!.textContent).toBe('<img src=x>');
});
