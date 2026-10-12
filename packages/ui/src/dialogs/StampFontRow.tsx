import { STAMP_FAMILIES, type StampFamily } from '@monstera/contract';
import type { ReactElement } from 'react';

import { type DocumentFont, FontPicker, type FontList } from '../FontPicker.js';
import { STAMP_FONT } from '../messages/en.js';
import { DialogRow } from '../primitives/Dialog.js';

/**
 * The font row of the watermark, header and footer, and Bates dialogs: the one picker (D1), offering what a stamp
 * writer can set.
 *
 * ## Built into PDF only, and that is the writer's limit rather than this row's
 *
 * The three writers are pdf-lib's, which embeds a standard font by name and nothing else (`STAMP_FONT` in
 * `pageStamp.ts`). So the list is read as having no installed family to offer (`listed: true`, empty), which shows the
 * *Built into PDF* group alone, never a *could not read this computer's fonts* sentence about a list nobody asked for.
 * A family outside `STAMP_FAMILIES` cannot be picked, so `onPick` narrows rather than casts.
 */
export function StampFontRow({
  value,
  onPick,
}: {
  readonly value: StampFamily;
  readonly onPick: (family: StampFamily) => void;
}): ReactElement {
  return (
    <DialogRow label={STAMP_FONT}>
      <FontPicker
        builtIn={STAMP_FAMILIES}
        inDocument={NO_DOCUMENT_FONTS}
        label={STAMP_FONT}
        list={STAMP_LIST}
        onPick={(family) => {
          const chosen = STAMP_FAMILIES.find((each) => each === family);
          if (chosen !== undefined) onPick(chosen);
        }}
        unset={STAMP_FONT}
        value={value}
      />
    </DialogRow>
  );
}

const NO_DOCUMENT_FONTS: readonly DocumentFont[] = [];
const STAMP_LIST: FontList = { listed: true, families: [], more: 0 };

/** What every stamp dialog starts at: the font the three writers drew in before a person could choose. */
export const DEFAULT_STAMP_FAMILY: StampFamily = 'Helvetica';
