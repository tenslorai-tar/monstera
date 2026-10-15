/**
 * What the custom colour of a stamp dialog shows while the standard colour is chosen: the colour the engine draws in
 * where a command names none. Document colours written into a page, not chrome, so they live outside a component
 * (`monstera/no-raw-hex` governs components), as `textColours.ts`' do.
 */
/** A watermark: `pageWatermark.ts`' mid grey, 0.5 of each. */
export const WATERMARK_STANDARD_HEX = '#808080';

/** A header or footer: black. */
export const HEADER_FOOTER_STANDARD_HEX = '#000000';
