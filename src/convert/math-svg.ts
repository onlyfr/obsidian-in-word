import {mathjax} from 'mathjax-full/js/mathjax.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/braket/BraketConfiguration.js';
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js';
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js';
import 'mathjax-full/js/input/tex/enclose/EncloseConfiguration.js';
import 'mathjax-full/js/input/tex/bbox/BboxConfiguration.js';
import 'mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';

const adaptor=liteAdaptor();
RegisterHTMLHandler(adaptor);
// The default MathJax 3 TeX glyphs are paths, so neither OS fonts nor a CDN affect them.
const packages=['base','ams','newcommand','boldsymbol','braket','cancel','color','enclose','bbox','mathtools'];
const NS='http://www.w3.org/2000/svg';
const tags=new Set(['svg','g','path','rect','line','polyline','polygon','circle','ellipse','text','tspan']);
const attrs=new Set(['viewBox','d','transform','x','y','x1','x2','y1','y2','width','height','rx','ry','r','cx','cy','points','fill','stroke','stroke-width','stroke-dasharray','stroke-linecap','stroke-linejoin','fill-rule','font-family','font-size','font-style','font-weight','text-anchor','dx','dy']);

/** Rebuild generated SVG with geometry/text only. No links, external resources, CSS or handlers. */
export function safeMathSvg(markup:string):SVGSVGElement{
  const parsed=new DOMParser().parseFromString(markup,'application/xml');
  const root=parsed.querySelector('svg');
  if(!root || root.namespaceURI!==NS || parsed.querySelector('parsererror'))throw new Error('Invalid math SVG');
  const copy=(source:Element):Element=>{
    const out=document.createElementNS(NS,source.localName);
    for(const attr of source.attributes){
      if(!attr.namespaceURI && attrs.has(attr.name) && !/url\s*\(|[<>]/i.test(attr.value))out.setAttribute(attr.name,attr.value);
    }
    for(const child of source.childNodes){
      if(child.nodeType===3)out.append(document.createTextNode(child.textContent??''));
      else if(child.nodeType===1){
        const el=child as Element;
        if(el.namespaceURI===NS && tags.has(el.localName))out.append(copy(el));
      }
    }
    return out;
  };
  return copy(root) as SVGSVGElement;
}

export function renderMathSvg(latex:string,display:boolean):SVGSVGElement{
  // Per-expression state: user macro definitions and equation labels cannot leak into the next image.
  // All extensions are bundled explicitly; require/autoload/HTML are not enabled.
  const input=new TeX({packages,tags:'none',maxBuffer:10000,maxMacros:1000,
    formatError:(_jax:unknown,error:Error)=>{throw error;}});
  const renderer=mathjax.document('',{InputJax:input,OutputJax:new SVG({fontCache:'none'})});
  const output=renderer.convert(latex,{display});
  return safeMathSvg(adaptor.outerHTML(output));
}
