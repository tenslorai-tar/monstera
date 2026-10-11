import type { FormFieldKind } from '@monstera/contract';

import type { PDFWidget } from './mupdfRaw.js';

/**
 * What kind of field a widget is, asked through MuPDF's own predicates.
 *
 * In a module of its own so the field appearance's finishing step (`fieldFaces.ts`), which `pageAnnotations.ts` calls, can
 * ask it without importing `formFields.ts`, which imports `pageAnnotations.ts` (the module graph has no cycles).
 *
 * **The predicates rather than `getFieldType()`'s string**, because the
 * classification is MuPDF's rule and re-deriving it from a name would be a
 * second opinion about it (B3a) — one that agrees until a version spells a type
 * differently. The string is still what answers `signature`, which has no
 * predicate of its own.
 *
 * **Push button before checkbox**, because `isButton()` covers all three and
 * the order is what separates them. Measured names, 2026-09-07: `text`,
 * `checkbox`, `radiobutton`, `combobox`, `listbox`, `signature`.
 */
export function kindOf(widget: PDFWidget): FormFieldKind {
  if (widget.isPushButton()) return 'button';
  if (widget.isCheckbox()) return 'checkbox';
  if (widget.isRadioButton()) return 'radio';
  if (widget.isText()) return 'text';
  if (widget.isComboBox()) return 'dropdown';
  if (widget.isListBox()) return 'listbox';
  // `'other'` IS THE HONEST ANSWER for a type this build cannot name — and it
  // is UNREACHABLE against MuPDF 1.28.0, measured 2026-09-07 while auditing.
  // A widget whose `/FT` is `/Xx`, and a widget with no `/FT` at all, both
  // resolve to `getFieldType() === 'button'` with `isPushButton()` true: the
  // engine defaults an unknown or absent type to push button, so every widget
  // it hands us matches a predicate above.
  //
  // KEPT RATHER THAN DELETED, for JJJ-1's reason. The fact it encodes is true,
  // and removing it would leave this function with no fallback the day a
  // version answers with a string these predicates do not cover — which is a
  // false positive manufactured to tidy away a branch. `formFields.test.ts`
  // carries the reading, so the claim expires with the version rather than
  // sitting here as an assertion nobody can date.
  return widget.getFieldType() === 'signature' ? 'signature' : 'other';
}
