export interface MathAppearance {sizePt:number;color:string;}
export const DEFAULT_MATH_APPEARANCE:Readonly<MathAppearance>={sizePt:11,color:'#000000'};
export function normalizeMathAppearance(value?:Partial<MathAppearance>|null):MathAppearance{
  const size=value?.sizePt,color=value?.color;
  return {sizePt:typeof size==='number' && Number.isFinite(size) && size>=6 && size<=36?Math.round(size*2)/2:11,
    color:typeof color==='string' && /^#[0-9a-f]{6}$/i.test(color)?color.toLowerCase():'#000000'};
}
/** Empty profile preserves existing 11pt/black cache keys. */
export function mathAppearanceKey(value?:Partial<MathAppearance>):string{
  const {sizePt,color}=normalizeMathAppearance(value);
  return sizePt===11 && color==='#000000'?'':`pt=${sizePt};rgb=${color.slice(1)}`;
}
