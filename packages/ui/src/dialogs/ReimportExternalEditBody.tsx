import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { REIMPORT_EXTERNAL_EDIT_APPLY, REIMPORT_EXTERNAL_EDIT_SAVED } from '../messages/en.js';
import { pdfjsPageOf } from '../pageNumbering.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ReimportExternalEditAnswer } from './reimportExternalEditResult.js';

/**
 * Put a page edited in another application back.
 *
 * ## The sentence says the document is unchanged until the answer is yes
 *
 * `InsertImageProblemBody`'s rule: a person's first question is whether anything happened to
 * their document, and nothing has.
 *
 * ## The page is named by NUMBER, through `pdfjsPageOf`
 *
 * The one converter between the kernel's zero-based index and the number on screen, so the
 * sentence and the replace cannot disagree about which page — `ApplyRedactionsBody`'s reason.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ReimportExternalEditBody({
  page,
  resolve,
}: { readonly page: number } & DialogAnswering<ReimportExternalEditAnswer>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-reimport-external-edit">
      <p>{_(REIMPORT_EXTERNAL_EDIT_SAVED, { page: pdfjsPageOf(page) })}</p>
      <Button
        label={REIMPORT_EXTERNAL_EDIT_APPLY}
        onClick={() => {
          resolve({ reimport: true });
        }}
        variant="primary"
      />
    </div>
  );
}
