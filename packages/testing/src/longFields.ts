/**
 * The one reading of ADR-0157's rule, for the dialog gallery's capture and the rendered cases alike: a field holding a
 * long value takes its row's width.
 *
 * ## Long is the platform's own measure
 *
 * A field holds a long value when its value has more characters than its `size`, which is the width in characters the
 * browser draws a field at when nothing sizes it (20 by default). That is the field at which the defect showed: every
 * key and endpoint drew at 168 px, its `size`.
 *
 * ## The row, not the control column
 *
 * The owner's wording is *narrower than its row's control column*, and a Settings row's control column sizes to its
 * control, so a key field at 168 px sat in a control column of 168 px and the literal reading passes the defect. The
 * width that separates the two is the row's: a field that runs long takes its own line and the row's whole width
 * (ADR-0157 Decision 1), so it is measured against that.
 *
 * Self-contained, because Playwright serialises it into the page: it names nothing it imports.
 */
export function readLongFields(root: Element): {
  readonly seen: number;
  readonly short: readonly string[];
} {
  const short: string[] = [];
  let seen = 0;
  for (const field of root.querySelectorAll<HTMLInputElement>('input.m-input')) {
    if (field.value.length <= field.size) continue;
    seen += 1;
    const row = field.closest('.m-dialog-row, .m-settings-row');
    if (row === null) continue;
    const width = field.getBoundingClientRect().width;
    const rowWidth = row.clientWidth;
    if (width + 1 < rowWidth) {
      const name = field.labels?.[0]?.textContent ?? field.getAttribute('aria-label') ?? '(unnamed)';
      short.push(`${name}: ${String(Math.round(width))} px in a row of ${String(Math.round(rowWidth))}`);
    }
  }
  return { seen, short };
}
