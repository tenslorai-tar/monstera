import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { PDFA_REMOVALS_CONVERTER_WORDS, PDFA_REMOVALS_SAVED, PDFA_REMOVALS_TAGS } from '../messages/en.js';

/**
 * The PDF/A removals notice: the file is saved, and these are what was left out — the tags,
 * which the converter does not mention, in this build's words, and the converter's own lines
 * about the rest. Those lines are not translated: they are Ghostscript's, and a paraphrase
 * would be this build's guess at what a construct was.
 */
export default function PdfaRemovalsBody({
  removed,
  tagsDropped,
}: {
  readonly removed: readonly string[];
  readonly tagsDropped: boolean;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-pdfa-removals">
      <p>{_(PDFA_REMOVALS_SAVED)}</p>
      {tagsDropped ? <p>{_(PDFA_REMOVALS_TAGS)}</p> : null}
      {removed.length > 0 ? (
        <>
          <p>{_(PDFA_REMOVALS_CONVERTER_WORDS)}</p>
          <ul className="m-pdfa-removals__list">
            {removed.map((line) => (
              <li key={line} lang="en">
                {line}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
