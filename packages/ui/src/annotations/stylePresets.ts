import type { MessageKey } from '@monstera/shared';

import {
  PROPERTIES_COLOUR_BLUE,
  PROPERTIES_COLOUR_GREEN,
  PROPERTIES_COLOUR_GREY,
  PROPERTIES_COLOUR_ORANGE,
  PROPERTIES_COLOUR_PINK,
  PROPERTIES_COLOUR_PURPLE,
  PROPERTIES_COLOUR_RED,
  PROPERTIES_COLOUR_YELLOW,
} from '../messages/en.js';

/**
 * The colours the Properties tab offers as swatches, in v5-02's order, before its custom colour.
 *
 * **Document colours, not chrome.** Each is written into a mark's `/C`, so none is a design token: a
 * token changes with the theme, and a highlight must not turn another colour when a person switches
 * to dark. That is §10.2's *genuinely dynamic* case, and it is why these live in a module rather than
 * a component, where the raw-hex rule would rightly refuse them.
 *
 * The hues are the ones markup tools share — a highlighter yellow and green, a note pink, a red for
 * corrections — each strong enough to read on white at the opacities a highlight is drawn at.
 */
export const STYLE_PRESETS: readonly { readonly hex: string; readonly title: MessageKey }[] = [
  { hex: '#ffd400', title: PROPERTIES_COLOUR_YELLOW },
  { hex: '#2fbf71', title: PROPERTIES_COLOUR_GREEN },
  { hex: '#2ea8e6', title: PROPERTIES_COLOUR_BLUE },
  { hex: '#f06fb0', title: PROPERTIES_COLOUR_PINK },
  { hex: '#ff8a1f', title: PROPERTIES_COLOUR_ORANGE },
  { hex: '#9b6bf2', title: PROPERTIES_COLOUR_PURPLE },
  { hex: '#e5484d', title: PROPERTIES_COLOUR_RED },
  { hex: '#8a94a0', title: PROPERTIES_COLOUR_GREY },
];

/**
 * The line widths the tab offers, in points, as v5-02's four segments. A mark drawn at another width
 * shows its own figure beside the label with no segment pressed, rather than being rounded to one.
 */
export const LINE_WIDTH_PRESETS: readonly number[] = [1, 2, 3, 5];
