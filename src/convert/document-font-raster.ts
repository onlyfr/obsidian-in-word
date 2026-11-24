import {mathMLToElement,mathRenderer} from '../plugins/math-impl';
import {LIMITS,RasterError,type MathRasterizer} from './mathimg';
import type {MathAppearance} from './math-appearance';
import {svgPng} from './svg-png';

export async function documentFontRaster(style:MathAppearance,family:string):Promise<MathRasterizer> {
  if (!await mathRenderer.load()) throw new RasterError('unavailable',mathRenderer.error);
  return {async render(latex,display) {
    const result=mathRenderer.mathml(latex,display);
    const math=result.html && mathMLToElement(result.html) as MathMLElement|null;
    if (!math) throw new RasterError('unsupported',result.err);
    math.removeAttribute('display');
    math.classList.remove('tml-display');
    math.style.display='inline math';
    math.style.fontFamily='"'+family+'", math';
    math.style.setProperty('math-style',display?'normal':'compact');
    for(const cell of math.querySelectorAll<MathMLElement>('mtable,mtd'))
      if(cell.style.width.endsWith('%')) cell.style.removeProperty('width');

    const box=document.createElement('div');
    box.style.cssText='position:absolute;width:max-content;white-space:nowrap;line-height:normal';
    box.style.fontSize=style.sizePt*96/72+'px';
    box.style.color=style.color;
    const sheet=document.createElement('style');
    sheet.textContent=mathRenderer.css;
    const probe=document.createElement('span');
    probe.style.display='inline-block';
    box.append(sheet,math,probe);
    const host=document.createElement('div');
    host.style.cssText='position:fixed;left:-2000px;top:0;visibility:hidden';
    host.append(box);document.body.append(host);
    const pad=4;
    let w:number,h:number,baseline:number;
    try {
      const bounds=math.getBoundingClientRect(),origin=box.getBoundingClientRect();
      if (!(bounds.width>0 && bounds.height>0)) throw new RasterError('blank');
      w=Math.ceil(bounds.width)+2*pad;h=Math.ceil(bounds.height)+2*pad;
      if(w>LIMITS.maxWidth || h>LIMITS.maxHeight) throw new RasterError('too-large');
      baseline=probe.getBoundingClientRect().bottom-bounds.top+pad;
      box.style.left=pad-(bounds.left-origin.left)+'px';
      box.style.top=pad-(bounds.top-origin.top)+'px';
    } finally {host.remove();}
    const markup=new XMLSerializer().serializeToString(box);
    const xml=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="${w}" height="${h}">${markup}</foreignObject></svg>`;
    return svgPng(xml,w,h,baseline);
  }};
}
