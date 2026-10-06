import type { MessageKey } from '@monstera/shared';

import {
  PAGE_TINT_BLUE,
  PAGE_TINT_CREAM,
  PAGE_TINT_GREEN,
  PAGE_TINT_GREY,
  PAGE_TINT_PINK,
  PAGE_TINT_YELLOW,
} from '../messages/en.js';

/**
 * The colours *Add page background* offers, before its custom colour (the owner's item 13j).
 *
 * **Paper tints, not a mark's colours.** A background sits under every word on the page, so each is light enough that
 * black text keeps its contrast, and each is far enough from white to be seen: the one tint this command used to
 * paint, `#faf7f0`, was so close to white that the owner could hardly see it. **Document colours, not chrome**, for
 * `stylePresets.ts`' reason: each is written into the page, so none is a design token.
 */
/** The tint the dialog starts on: cream, visible on screen and on paper, and still quiet behind text. */
export const DEFAULT_PAGE_TINT = '#f8ebcd';

export const PAGE_TINTS: readonly { readonly hex: string; readonly title: MessageKey }[] = [
  { hex: DEFAULT_PAGE_TINT, title: PAGE_TINT_CREAM },
  { hex: '#fff3b0', title: PAGE_TINT_YELLOW },
  { hex: '#dcefd9', title: PAGE_TINT_GREEN },
  { hex: '#d9e8f7', title: PAGE_TINT_BLUE },
  { hex: '#f8dce6', title: PAGE_TINT_PINK },
  { hex: '#e4e4e4', title: PAGE_TINT_GREY },
];
