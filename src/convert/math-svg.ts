import {mathjax} from 'mathjax-full/js/mathjax.js';
import {MathML} from 'mathjax-full/js/input/mathml.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';

const adaptor=liteAdaptor();
RegisterHTMLHandler(adaptor);
// The default MathJax 3 TeX glyphs are paths, so neither OS fonts nor a CDN affect them.
const renderer=mathjax.document('',{InputJax:new MathML(),OutputJax:new SVG({fontCache:'none'})});
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

export function renderMathSvg(mathml:string,display:boolean):SVGSVGElement{
  const output=renderer.convert(mathml,{display});
  return safeMathSvg(adaptor.outerHTML(output));
}
