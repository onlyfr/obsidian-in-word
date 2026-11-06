/** Empty text alone does not imply spacing: picture-only paragraphs have empty Office.js text too. */
export function trailingBlankParagraphs(
  paragraphs: { text: string; tableNestingLevel: number; hasInlinePictures: boolean }[],
): number {
  let count = 0;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i];
    if (p.tableNestingLevel !== 0 || p.text.trim() || p.hasInlinePictures) break;
    count++;
  }
  return count;
}
