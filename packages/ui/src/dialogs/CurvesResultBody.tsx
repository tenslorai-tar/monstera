import { useLingui } from '@lingui/react';
import type { KeptKind } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import type { z } from 'zod';

import { byteSize } from '../byteSize.js';
import {
  CURVES_LOST_ATTACHMENTS,
  CURVES_LOST_BOOKMARKS,
  CURVES_LOST_FIELDS,
  CURVES_LOST_LAYERS,
  CURVES_LOST_LINKS,
  CURVES_LOST_LINK_TARGETS,
  CURVES_LOST_MARKS,
  CURVES_LOST_PAGES,
  CURVES_LOST_TAGS,
  CURVES_LOST_TITLE,
  CURVES_RESULT_FONTS_LEFT,
  CURVES_RESULT_KEPT_ALL,
  CURVES_RESULT_LOST,
  CURVES_RESULT_OPEN,
  CURVES_RESULT_SIZE,
  CURVES_RESULT_UNCOMPARED,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { CURVES_RESULT_PROPS, CURVES_RESULT_RESULT } from './textToCurves.js';

/** Each kind's sentence, keyed by kind so a kind added to the contract arrives owing its words. */
const KINDS: Readonly<Record<KeptKind, MessageKey>> = {
  pages: CURVES_LOST_PAGES,
  marks: CURVES_LOST_MARKS,
  links: CURVES_LOST_LINKS,
  'link-targets': CURVES_LOST_LINK_TARGETS,
  bookmarks: CURVES_LOST_BOOKMARKS,
  attachments: CURVES_LOST_ATTACHMENTS,
  layers: CURVES_LOST_LAYERS,
  fields: CURVES_LOST_FIELDS,
  tags: CURVES_LOST_TAGS,
  title: CURVES_LOST_TITLE,
};

type Props = z.infer<typeof CURVES_RESULT_PROPS>;

/**
 * The curves copy's report (ADR-0282 Decisions 4 and 7): both sizes through the one size formatter; what fell, by kind
 * and count; or, where the copy could not be counted, that Monstera cannot say. *Open the copy* answers; Close puts it
 * away. A default export because `declareDialog` takes a `lazy()` component.
 */
export default function CurvesResultBody({
  bytes,
  before,
  lost,
  compared,
  fontsLeft,
  resolve,
}: Props & DialogAnswering<z.infer<typeof CURVES_RESULT_RESULT>>): ReactElement {
  const { _, i18n } = useLingui();
  return (
    <div className="m-curves-result">
      <p>{_(CURVES_RESULT_SIZE, { after: byteSize(i18n, bytes), before: byteSize(i18n, before) })}</p>
      {!compared ? (
        <p>{_(CURVES_RESULT_UNCOMPARED)}</p>
      ) : lost.length === 0 ? (
        <p>{_(CURVES_RESULT_KEPT_ALL)}</p>
      ) : (
        <>
          <p>{_(CURVES_RESULT_LOST)}</p>
          <ul className="m-dialog-list">
            {lost.map((loss) => (
              <li key={loss.kind}>{_(KINDS[loss.kind], { before: loss.before, after: loss.after })}</li>
            ))}
          </ul>
        </>
      )}
      {fontsLeft > 0 ? <p>{_(CURVES_RESULT_FONTS_LEFT, { count: fontsLeft })}</p> : null}
      <DialogFooter dismissal="close">
        <Button
          label={CURVES_RESULT_OPEN}
          variant="primary"
          onClick={() => {
            resolve({ open: true });
          }}
        />
      </DialogFooter>
    </div>
  );
}
