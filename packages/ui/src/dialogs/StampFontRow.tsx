import { STAMP_FAMILY_DEFAULT } from '@monstera/contract';
import type { ReactElement } from 'react';

import type { ReadFontList } from '../FontPicker.js';
import { STAMP_FONT } from '../messages/en.js';
import { ResolvedFontRow } from './ResolvedFontRow.js';

/**
 * The font row of the watermark, header and footer, and Bates dialogs: {@link ResolvedFontRow} under the stamps' label.
 * The stamps are drawn by the MuPDF writer with the text box's own typesetter (ADR-0235, the owner's L3), so the row offers
 * what Insert from Markdown offers.
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
  return <ResolvedFontRow fonts={fonts} label={STAMP_FONT} value={value} onPick={onPick} />;
}

/** What every stamp dialog starts at: the font the three writers drew in before a person could choose. */
export const DEFAULT_STAMP_FAMILY: string = STAMP_FAMILY_DEFAULT;
