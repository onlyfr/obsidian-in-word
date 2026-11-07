import fontData from '../assets/latin-modern-math/latinmodern-math.otf?inline';

export const MATH_IMAGE_FONT='Owb Latin Modern Math';
/** Embedded in SVG too: image documents cannot fetch the application's font files. */
export const mathFontCss=`@font-face{font-family:'${MATH_IMAGE_FONT}';src:url('${fontData}') format('opentype');font-weight:normal;font-style:normal;}
math{font-family:'${MATH_IMAGE_FONT}' !important;}`;
let loading:Promise<void>|undefined;
export function prepareMathFont():Promise<void>{
  return loading??=(async()=>{
    const face=new FontFace(MATH_IMAGE_FONT,`url('${fontData}') format('opentype')`);
    await face.load();
    document.fonts.add(face);
  })();
}
