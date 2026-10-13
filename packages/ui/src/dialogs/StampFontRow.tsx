import { STAMP_FAMILY_DEFAULT } from '@monstera/contract';
import type { ReactElement } from 'react';

import { type DocumentFont, FontPicker, RESOLVED_BUILT_IN, type ReadFontList } from '../FontPicker.js';
import { STAMP_FONT } from '../messages/en.js';
import { DialogRow } from '../primitives/Dialog.js';

/**
 * The font row of the watermark, header and footer, and Bates dialogs: the one picker (D1), offering every family the
 * text boxes can be set in.
 *
 * ## Every font, because the writer is the text boxes' (ADR-0235, the owner's L3)
 *
 * The stamps are drawn by the MuPDF writer with the text box's own typesetter, so the row offers what Insert from Markdown
 * offers: the three built into PDF and this computer's list, read once a session (`fontListOf`). A failed read is the
 * picker's to say in words; no document's own fonts are offered, since a stamp is drawn in the resolver's faces.
 */
export function StampFontRow({
  value,
  onPick,
  fonts,
}: {
  readonly value: string;
  readonly onPick: (family: string) => void;
  /** The fonts main listed when the dialog opened; absent where that read failed. */
  readonly fonts?: ReadFontList | undefined;
}): ReactElement {
  return (
    <DialogRow label={STAMP_FONT}>
      <FontPicker
        builtIn={RESOLVED_BUILT_IN}
        inDocument={NO_DOCUMENT_FONTS}
        label={STAMP_FONT}
        list={fonts ?? { listed: false, families: [], more: 0 }}
        onPick={onPick}
        unset={STAMP_FONT}
        value={value}
      />
    </DialogRow>
  );
}

const NO_DOCUMENT_FONTS: readonly DocumentFont[] = [];

/** What every stamp dialog starts at: the font the three writers drew in before a person could choose. */
export const DEFAULT_STAMP_FAMILY: string = STAMP_FAMILY_DEFAULT;
