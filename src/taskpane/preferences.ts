import type { MathOutputMode } from "../convert/mathimg";
import {normalizeMathAppearance,type MathAppearance} from '../convert/math-appearance';
const MATH_APPEARANCE_KEY='oiw:math-image-appearance';
export function loadMathAppearance():MathAppearance{
  try{return normalizeMathAppearance(JSON.parse(localStorage.getItem(MATH_APPEARANCE_KEY)??'null'));}catch{return normalizeMathAppearance();}
}
export function saveMathAppearance(value:MathAppearance):void{
  try{localStorage.setItem(MATH_APPEARANCE_KEY,JSON.stringify(normalizeMathAppearance(value)));}catch{/* Active options remain usable. */}
}

const MATH_OUTPUT_KEY = "oiw:math-output";
const EDITOR_KEY = "oiw:editor-options";
export interface EditorPreferences {lineNumbers:boolean;wrap:boolean;fontSize:12|14|16|18|20;}
const defaults:EditorPreferences={lineNumbers:true,wrap:true,fontSize:14};
export function loadEditorPreferences():EditorPreferences{
  try{
    const data=JSON.parse(localStorage.getItem(EDITOR_KEY)??"null");
    return {
      lineNumbers:typeof data?.lineNumbers==="boolean"?data.lineNumbers:defaults.lineNumbers,
      wrap:typeof data?.wrap==="boolean"?data.wrap:defaults.wrap,
      fontSize:[12,14,16,18,20].includes(data?.fontSize)?data.fontSize:defaults.fontSize,
    };
  }catch{return {...defaults};}
}
export function saveEditorPreferences(preferences:EditorPreferences):void{
  try{localStorage.setItem(EDITOR_KEY,JSON.stringify(preferences));}catch{/* Active editor options still work without storage. */}
}

export function loadMathOutput(): MathOutputMode {
  try { return localStorage.getItem(MATH_OUTPUT_KEY) === "images" ? "images" : "hybrid"; }
  catch { return "hybrid"; }
}

export function saveMathOutput(mode: MathOutputMode): void {
  try { localStorage.setItem(MATH_OUTPUT_KEY, mode); }
  catch { /* The active select still works if storage is unavailable. */ }
}
