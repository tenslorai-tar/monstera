import { useLingui } from '@lingui/react';
import type { PageMarkKind } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  PAGE_MARKS_INLINE,
  PAGE_MARKS_NONE_BATES,
  PAGE_MARKS_NONE_HEADER_FOOTER,
  PAGE_MARKS_NONE_WATERMARK,
  PAGE_MARKS_OLDER,
} from '../messages/en.js';

/** Each kind's sentence for a document carrying none of it: a `Record`, so a kind added to the contract needs one. */
const NONE: Readonly<Record<PageMarkKind, MessageKey>> = {
  watermark: PAGE_MARKS_NONE_WATERMARK,
  headerFooter: PAGE_MARKS_NONE_HEADER_FOOTER,
  bates: PAGE_MARKS_NONE_BATES,
};

/**
 * What Edit or Remove could not reach, one sentence each.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function PageMarksNoticeBody({
  kind,
  none,
  older,
  inline,
}: {
  readonly kind: PageMarkKind;
  readonly none: boolean;
  readonly older: number;
  readonly inline: number;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-page-marks-notice">
      {none ? <p>{_(NONE[kind])}</p> : null}
      {inline > 0 ? <p>{_(PAGE_MARKS_INLINE, { count: inline })}</p> : null}
      {older > 0 ? <p>{_(PAGE_MARKS_OLDER, { count: older })}</p> : null}
    </div>
  );
}
