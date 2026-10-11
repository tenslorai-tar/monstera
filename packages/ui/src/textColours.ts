import {
  TEXT_FORMAT_COLOUR_BLACK,
  TEXT_FORMAT_COLOUR_BLUE,
  TEXT_FORMAT_COLOUR_GREEN,
  TEXT_FORMAT_COLOUR_GREY,
  TEXT_FORMAT_COLOUR_ORANGE,
  TEXT_FORMAT_COLOUR_PURPLE,
  TEXT_FORMAT_COLOUR_RED,
  TEXT_HIGHLIGHT_BLUE,
  TEXT_HIGHLIGHT_GREEN,
  TEXT_HIGHLIGHT_ORANGE,
  TEXT_HIGHLIGHT_PINK,
  TEXT_HIGHLIGHT_YELLOW,
} from './messages/en.js';

/**
 * The colours the in-place editor offers for text: a few a document uses, each named. They are DATA that becomes a
 * colour written into a page, not a colour the application is drawn in, so they live here and not in a component
 * (`monstera/no-raw-hex` governs components). Any other colour is the custom one.
 */
export const TEXT_COLOURS = [
  { hex: '#000000', title: TEXT_FORMAT_COLOUR_BLACK },
  { hex: '#595959', title: TEXT_FORMAT_COLOUR_GREY },
  { hex: '#c00000', title: TEXT_FORMAT_COLOUR_RED },
  { hex: '#d9731a', title: TEXT_FORMAT_COLOUR_ORANGE },
  { hex: '#1f7a3d', title: TEXT_FORMAT_COLOUR_GREEN },
  { hex: '#1f4fbf', title: TEXT_FORMAT_COLOUR_BLUE },
  { hex: '#6b2fa8', title: TEXT_FORMAT_COLOUR_PURPLE },
] as const;

/** What the custom colour shows while no colour is chosen: a colour input cannot show none. */
export const TEXT_COLOUR_FALLBACK = '#000000';

/**
 * The colours a highlight is offered in (ADR-0228): the pale marker colours a document's highlights are, each named, so
 * black words stay readable over them. Data written into a page, as {@link TEXT_COLOURS} is.
 */
export const HIGHLIGHT_COLOURS = [
  { hex: '#fff176', title: TEXT_HIGHLIGHT_YELLOW },
  { hex: '#a5d6a7', title: TEXT_HIGHLIGHT_GREEN },
  { hex: '#81d4fa', title: TEXT_HIGHLIGHT_BLUE },
  { hex: '#f8bbd0', title: TEXT_HIGHLIGHT_PINK },
  { hex: '#ffcc80', title: TEXT_HIGHLIGHT_ORANGE },
] as const;

/** What the custom highlight shows while none is chosen. */
export const HIGHLIGHT_COLOUR_FALLBACK = '#fff176';
