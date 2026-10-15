import type { AnnotationColour } from '@monstera/contract';
import type { ReactElement } from 'react';

import { colourFromHex, hexFromColour } from '../annotations/annotationStyle.js';
import { ColourSwatches } from '../ColourChoice.js';
import { STAMP_COLOUR, STAMP_COLOUR_CUSTOM, STAMP_COLOUR_STANDARD } from '../messages/en.js';
import { DialogRow } from '../primitives/Dialog.js';
import { TEXT_COLOURS } from '../textColours.js';

/**
 * The colour row of the watermark and header and footer dialogs (ADR-0246 Decision 7): the application's one colour
 * control, offering the colours text is offered in, since a stamp is text.
 *
 * **The first choice is the STANDARD colour, and it answers none**, so a stamp made without touching this row is the
 * command it always was: the engine draws a watermark grey and a header black where the command names no colour. A
 * custom colour a platform picker answers in a form `colourFromHex` cannot read is not taken.
 */
export function StampColourRow({
  value,
  onPick,
  standardHex,
}: {
  /** The colour chosen, or `undefined` for the standard one. */
  readonly value: AnnotationColour | undefined;
  readonly onPick: (colour: AnnotationColour | undefined) => void;
  /** What the custom colour shows while the standard one is chosen: the colour the engine draws then. */
  readonly standardHex: string;
}): ReactElement {
  return (
    <DialogRow label={STAMP_COLOUR}>
      <ColourSwatches
        presets={TEXT_COLOURS}
        current={value === undefined ? undefined : hexFromColour(value)}
        auto={value === undefined}
        autoLabel={STAMP_COLOUR_STANDARD}
        customLabel={STAMP_COLOUR_CUSTOM}
        fallback={standardHex}
        layout="start"
        onPick={(hex) => {
          if (hex === undefined) {
            onPick(undefined);
            return;
          }
          const colour = colourFromHex(hex);
          if (colour !== undefined) onPick(colour);
        }}
      />
    </DialogRow>
  );
}
