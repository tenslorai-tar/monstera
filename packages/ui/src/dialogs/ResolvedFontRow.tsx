import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import { type DocumentFont, FontPicker, RESOLVED_BUILT_IN, type ReadFontList } from '../FontPicker.js';
import { DialogRow } from '../primitives/Dialog.js';

/**
 * The font row of every dialog whose words the font resolver sets (ADR-0235, the owner's L3 and L4): the stamps, Insert from
 * Markdown, and a new PDF from Markdown or CSV. The one picker (D1), offering the three built in through the resolver's
 * stand-ins and this computer's list, read once a session (`fontListOf`).
 *
 * ## ONE ROW, so the offer cannot drift between them
 *
 * Each dialog spelt this picker in full, and they agreed only because each was copied from the last. A writer that sets
 * every one of these through the same resolver offers one list, so the list is decided here. A failed read is the picker's to
 * say in words; no document's own fonts are offered, since none of these draws in a document's fonts.
 */
export function ResolvedFontRow({
  label,
  value,
  onPick,
  fonts,
}: {
  readonly label: MessageKey;
  readonly value: string;
  readonly onPick: (family: string) => void;
  /** The fonts main listed when the dialog opened; absent where that read failed. */
  readonly fonts?: ReadFontList | undefined;
}): ReactElement {
  return (
    <DialogRow label={label}>
      <FontPicker
        builtIn={RESOLVED_BUILT_IN}
        inDocument={NO_DOCUMENT_FONTS}
        label={label}
        list={fonts ?? UNREAD}
        onPick={onPick}
        unset={label}
        value={value}
      />
    </DialogRow>
  );
}

const NO_DOCUMENT_FONTS: readonly DocumentFont[] = [];

/** What the row offers where the list could not be read: the three built in, and the picker's words saying so. */
const UNREAD: ReadFontList = { listed: false, families: [], more: 0 };
