export interface MathAppearance {sizePt:number;color:string;fontFamily?:string;}
export type MathAppearanceSource='manual'|'selection'|'document';
export function appearanceSource(value:unknown):MathAppearanceSource {
  return value === 'document' || value === 'selection' ? value : 'manual';
}
export function documentFontName(value:unknown):string {
  if(typeof value !== 'string' || !/^[\p{L}\p{M}\p{N} ._-]{1,100}$/u.test(value) || !value.trim())
    throw new Error('선택 영역의 글꼴 이름을 확인할 수 없습니다. 한 글꼴로 통일하거나 MathJax TeX를 선택하세요.');
  return value.trim();
}
/** Mixed/unknown selection formatting must not silently become the default image profile. */
export function selectionMathAppearance(font:{size?:unknown;color?:unknown}):MathAppearance{
  const {size,color}=font;
  if(typeof size!=='number' || !Number.isFinite(size) || size<6 || size>36 || Math.round(size*2)!==size*2 ||
    typeof color!=='string' || !/^#[0-9a-f]{6}$/i.test(color))
    throw new Error('선택 영역의 수식 크기·색을 확정할 수 없습니다. 크기(6–36pt)와 색을 통일하거나 옵션에서 ‘직접 지정’을 선택하세요');
  return {sizePt:size,color:color.toLowerCase()};
}
export const DEFAULT_MATH_APPEARANCE:Readonly<MathAppearance>={sizePt:11,color:'#000000'};
export function normalizeMathAppearance(value?:Partial<MathAppearance>|null):MathAppearance{
  const size=value?.sizePt,color=value?.color;
  return {sizePt:typeof size==='number' && Number.isFinite(size) && size>=6 && size<=36?Math.round(size*2)/2:11,
    color:typeof color==='string' && /^#[0-9a-f]{6}$/i.test(color)?color.toLowerCase():'#000000',...(value?.fontFamily ? {fontFamily:documentFontName(value.fontFamily)} : {})};
}
/** Empty profile preserves existing 11pt/black cache keys. */
export function mathAppearanceKey(value?:Partial<MathAppearance>):string{
  const {sizePt,color}=normalizeMathAppearance(value);
  return sizePt===11 && color==='#000000' && !value?.fontFamily?'':`pt=${sizePt};rgb=${color.slice(1)}${value?.fontFamily ? ";native1="+encodeURIComponent(value.fontFamily) : ""}`;
}
