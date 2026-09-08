import { type WordCount, countWords } from '@monstera/shared';

import type { PageText } from './textStructure.js';
import { linesOf } from './textStructure.js';

/**
 * One page's counts, from the parsed substrate.
 *
 * ## The counting rule is `@monstera/shared`'s and this is only the reader
 *
 * `countWords` lives there for `findInLines`' reason: the browser shim answers
 * `document.pageWordCount` and may not import the kernel, so a rule stated here
 * would be re-stated there and the two would agree until one changed. What this
 * module owns is the step shared cannot take — turning a `PageText` into the
 * lines to count, which needs the substrate's own shape.
 *
 * That split is the same one `textSearch.ts` makes, and it is why this file is
 * four lines: everything decidable without MuPDF's tree is already elsewhere.
 */
export function countPageWords(page: PageText): WordCount {
  return countWords(linesOf(page).map((line) => line.text));
}
