import { BLANK_TOKEN } from "../convert/obsidian";

/**
 * Marker text the apply puts into the inserted HTML and replaces afterwards (`insertOoxml`, `clear`). If one of them is
 * still in the document after the batch, an operation failed and the apply must be reported as failed, never as done.
 * Prefixes must match the markers produced in convert/obsidian.ts (`OWBFLOAT<n>X<id>`, `OWBEQ<n>…`, `OWBTBL<n>…`).
 */
export interface LeftoverCheck {
  /** Text searched for in the document. */
  prefix: string;
  /** What is missing, for the Korean error message. */
  label: string;
  /** Verb phrase for the message. */
  action: string;
}

const CHECKS: Record<"floats" | "equations" | "tables" | "blanks", LeftoverCheck> = {
  floats: { prefix: "OWBFLOAT", label: "부동 개체", action: "복원하지 못했습니다" },
  equations: { prefix: "OWBEQ", label: "수식", action: "삽입하지 못했습니다" },
  tables: { prefix: "OWBTBL", label: "표", action: "삽입하지 못했습니다" },
  blanks: { prefix: BLANK_TOKEN, label: "빈 문단", action: "만들지 못했습니다" },
};

/** Which leftover-marker searches an apply with these kinds of objects has to run. */
export function leftoverChecks(used: { floats: number; equations: number; tables: number; blanks: boolean }): LeftoverCheck[] {
  const out: LeftoverCheck[] = [];
  if (used.floats > 0) out.push(CHECKS.floats);
  if (used.equations > 0) out.push(CHECKS.equations);
  if (used.tables > 0) out.push(CHECKS.tables);
  if (used.blanks) out.push(CHECKS.blanks);
  return out;
}
