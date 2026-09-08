import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  WORD_COUNT_CHARACTERS_LABEL,
  WORD_COUNT_CHARACTERS_TIGHT_LABEL,
  WORD_COUNT_PAGES_LABEL,
  WORD_COUNT_PARTIAL,
  WORD_COUNT_WORDS_LABEL,
} from '../messages/en.js';

/**
 * The word count dialog's body.
 *
 * ## It renders what the command counted, and holds no opinion about it
 *
 * The totals are the command's, passed as validated props, for `AboutBody`'s
 * reason: `DialogRegistry.openWith` validates at the open call, which is the
 * only place both the schema and the values exist.
 *
 * ## THE PARTIAL LINE IS THE ONE THAT MATTERS
 *
 * A walk that stopped early gives a total that is smaller than the document and
 * indistinguishable from a correct total for a shorter one. So when fewer pages
 * were counted than the document has, the dialog says so — a figure a reader
 * would quote must not be quietly short.
 *
 * The numbers are formatted through the i18n catalogue rather than
 * interpolated: thousands separators are a locale's business, and `12,345` and
 * `12.345` are different documents to different readers.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function WordCountBody({
  words,
  characters,
  charactersNoSpaces,
  pagesCounted,
  pageCount,
}: {
  readonly words: number;
  readonly characters: number;
  readonly charactersNoSpaces: number;
  readonly pagesCounted: number;
  readonly pageCount: number;
}): ReactElement {
  const { _, i18n } = useLingui();
  // `Intl.NumberFormat` DIRECTLY, taking the locale from the catalogue. Lingui's
  // `i18n.number` helper is deprecated and says so; what matters is not the
  // deprecation but that the grouping separator is a locale's business — `12,345`
  // and `12.345` are different documents to different readers, and a bare
  // `String(value)` gives neither.
  const format = new Intl.NumberFormat(i18n.locale);
  const count = (value: number): string => format.format(value);

  return (
    <div className="m-word-count">
      <dl>
        <dt>{_(WORD_COUNT_WORDS_LABEL)}</dt>
        <dd>{count(words)}</dd>
        <dt>{_(WORD_COUNT_CHARACTERS_LABEL)}</dt>
        <dd>{count(characters)}</dd>
        <dt>{_(WORD_COUNT_CHARACTERS_TIGHT_LABEL)}</dt>
        <dd>{count(charactersNoSpaces)}</dd>
        <dt>{_(WORD_COUNT_PAGES_LABEL)}</dt>
        <dd>{count(pagesCounted)}</dd>
      </dl>
      {pagesCounted < pageCount ? (
        <p className="m-word-count-partial" data-partial="true">
          {_(WORD_COUNT_PARTIAL, { counted: count(pagesCounted), total: count(pageCount) })}
        </p>
      ) : null}
    </div>
  );
}
