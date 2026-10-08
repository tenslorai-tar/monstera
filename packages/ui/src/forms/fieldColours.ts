import type { MessageKey } from '@monstera/shared';

import { STYLE_PRESETS } from '../annotations/stylePresets.js';
import { FIELD_PROPS_COLOUR_BLACK, FIELD_PROPS_COLOUR_WHITE } from '../messages/en.js';

/**
 * The colours a form field's border and fill are offered in: black and white first, which are what a form is drawn in,
 * then the marks' own. Colours are data and live here, outside a component, as `stylePresets.ts`' do.
 */
export const FIELD_COLOURS: readonly { readonly hex: string; readonly title: MessageKey }[] = [
  { hex: '#000000', title: FIELD_PROPS_COLOUR_BLACK },
  { hex: '#ffffff', title: FIELD_PROPS_COLOUR_WHITE },
  ...STYLE_PRESETS,
];

/** What the custom colour input shows while a field has no colour: an input cannot show none, and black is what it answers. */
export const FIELD_COLOUR_FALLBACK = '#000000';
