import type { MathOutputMode } from "../convert/mathimg";

const MATH_OUTPUT_KEY = "oiw:math-output";

export function loadMathOutput(): MathOutputMode {
  try { return localStorage.getItem(MATH_OUTPUT_KEY) === "images" ? "images" : "hybrid"; }
  catch { return "hybrid"; }
}

export function saveMathOutput(mode: MathOutputMode): void {
  try { localStorage.setItem(MATH_OUTPUT_KEY, mode); }
  catch { /* The active select still works if storage is unavailable. */ }
}
