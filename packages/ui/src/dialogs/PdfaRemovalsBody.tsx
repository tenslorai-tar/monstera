import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { PDFA_REMOVALS_CONVERTER_WORDS, PDFA_REMOVALS_SAVED } from '../messages/en.js';

/**
 * The PDF/A removals notice: the file is saved, and these are the converter's own lines
 * about what it left out. The lines are not translated — they are Ghostscript's, and a
 * paraphrase would be this build's guess at what a construct was.
 */
export default function PdfaRemovalsBody({ removed }: { readonly removed: readonly string[] }): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-pdfa-removals">
      <p>{_(PDFA_REMOVALS_SAVED)}</p>
      <p>{_(PDFA_REMOVALS_CONVERTER_WORDS)}</p>
      <ul className="m-pdfa-removals__list">
        {removed.map((line) => (
          <li key={line} lang="en">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
