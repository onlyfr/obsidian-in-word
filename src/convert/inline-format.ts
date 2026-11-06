const marks: Record<string, number> = {B: 1, STRONG: 1, I: 2, EM: 2, S: 4, STRIKE: 4};
const kind = (node: Node | null): number => node?.nodeType === 1 ? marks[(node as Element).tagName] ?? 0 : 0;

/** Normalize only the convertible HTML, after opaque Word originals have been captured unchanged. */
export function normalizeInlineFormatting(root: Element): void {
  // Turndown has no representation for these font/language wrappers. Removing them exposes adjacent runs.
  for (const span of Array.from(root.querySelectorAll("span,font")).reverse()) span.replaceWith(...Array.from(span.childNodes));
  const merge = (left: Element, right: Element): void => {
    const last = left.lastChild, first = right.firstChild;
    if (kind(last) && kind(last) === kind(first)) merge(last as Element, first as Element);
    left.append(...Array.from(right.childNodes)); right.remove();
  };
  const walk = (parent: Element, active: number): void => {
    for (const el of Array.from(parent.children)) {
      const mark = kind(el);
      walk(el, active | mark);
      if (mark & active) el.replaceWith(...Array.from(el.childNodes));
      else {
        // Word can alternate <em><b> and <strong><i> on every import/export. Give equivalent full-run
        // combinations one order (bold, italic, strike), without moving formatting across partial text.
        while (mark && el.childNodes.length === 1 && kind(el.firstChild) && mark > kind(el.firstChild)) {
          const child = el.firstChild as Element;
          el.replaceWith(child); el.append(...Array.from(child.childNodes)); child.append(el);
        }
      }
    }
    for (const el of Array.from(parent.children)) {
      const mark = kind(el);
      while (mark && kind(el.nextSibling) === mark) merge(el, el.nextSibling as Element);
    }
  };
  walk(root, 0);
}
