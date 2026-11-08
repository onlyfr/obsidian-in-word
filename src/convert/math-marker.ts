/** Explicit app-owned marker, not visual recognition. Shared by HTML and OOXML identity checks. */
export function parseMathImgAlt(alt:string):{id:string;display:boolean;latex?:string}|null{
  const match=/^owb:math:([0-9a-f]{8})(:d)?(?: (.*))?$/s.exec(alt);
  if(!match)return null;
  return {id:match[1],display:!!match[2],latex:match[3]===undefined || match[3].endsWith('…')?undefined:match[3]};
}
export const normalizedMathSource=(source:string)=>source.replace(/\s+/g,' ').trim();
