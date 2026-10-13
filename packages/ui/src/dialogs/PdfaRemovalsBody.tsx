import { useLingui } from '@lingui/react';
import type { PdfaLeftOutKind } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  PDFA_LEFT_OUT_3D,
  PDFA_LEFT_OUT_HIDDEN,
  PDFA_LEFT_OUT_MORE,
  PDFA_LEFT_OUT_MOVIE,
  PDFA_LEFT_OUT_OTHER,
  PDFA_LEFT_OUT_POPUP,
  PDFA_LEFT_OUT_SOUND,
  PDFA_REMOVALS_LEFT_OUT,
  PDFA_REMOVALS_SAVED,
  PDFA_REMOVALS_TAGS,
} from '../messages/en.js';

/** Each kind's sentence, keyed by kind so a kind added to the contract arrives owing its words. */
const KINDS: Readonly<Record<PdfaLeftOutKind, MessageKey>> = {
  'comment-popup': PDFA_LEFT_OUT_POPUP,
  'hidden-mark': PDFA_LEFT_OUT_HIDDEN,
  sound: PDFA_LEFT_OUT_SOUND,
  movie: PDFA_LEFT_OUT_MOVIE,
  '3d': PDFA_LEFT_OUT_3D,
};

/**
 * The PDF/A notice: the level it was saved as, then what PDF/A could not keep, one line per kind and page, the tags,
 * which the converter does not mention, and a count of anything further it removed. A page is said 1-based, as the
 * page field shows it.
 */
export default function PdfaRemovalsBody({
  level,
  leftOut,
  leftOutMore,
  otherLeftOut,
  tagsDropped,
}: {
  readonly level: 1 | 2 | 3;
  readonly leftOut: readonly { readonly page: number; readonly kind: PdfaLeftOutKind; readonly count: number }[];
  readonly leftOutMore: number;
  readonly otherLeftOut: number;
  readonly tagsDropped: boolean;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-pdfa-removals">
      <p>{_(PDFA_REMOVALS_SAVED, { level })}</p>
      {leftOut.length > 0 || leftOutMore > 0 || otherLeftOut > 0 ? (
        <>
          <p>{_(PDFA_REMOVALS_LEFT_OUT)}</p>
          <ul className="m-dialog-list m-pdfa-removals__list">
            {leftOut.map((entry) => (
              <li key={`${String(entry.page)}:${entry.kind}`}>{_(KINDS[entry.kind], { count: entry.count, page: entry.page + 1 })}</li>
            ))}
            {leftOutMore > 0 ? <li>{_(PDFA_LEFT_OUT_MORE, { count: leftOutMore })}</li> : null}
            {otherLeftOut > 0 ? <li>{_(PDFA_LEFT_OUT_OTHER, { count: otherLeftOut })}</li> : null}
          </ul>
        </>
      ) : null}
      {tagsDropped ? <p>{_(PDFA_REMOVALS_TAGS)}</p> : null}
    </div>
  );
}
