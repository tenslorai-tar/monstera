import { z } from 'zod';

import {
  DOCUMENT_PANEL_OPEN_TITLE,
  DOCUMENT_PANEL_TITLE,
  DOCUMENT_PANEL_WIDTH_TITLE,
  PANEL_TITLES,
} from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * How the shell is arranged around the document: which panel shows, and whether it is
 * open.
 *
 * ## `appearance`, because it is the shell's arrangement
 *
 * `viewing` is what is drawn over the page. Which panel sits beside it is the chrome's,
 * like the theme.
 *
 * ## Persisted, because §10.3 says so
 *
 * *"State is persisted per panel."* A setting is the writer of record for a value that
 * survives a restart. Component state would be a preference that forgets itself, and a
 * second store would be a second opinion.
 */
export const DOCUMENT_PANEL_SETTING: SettingDefinition<
  z.ZodEnum<{
    pages: 'pages';
    bookmarks: 'bookmarks';
    comments: 'comments';
    forms: 'forms';
    layers: 'layers';
    search: 'search';
  }>
> = {
  id: 'appearance.document-panel',
  title: DOCUMENT_PANEL_TITLE,
  schema: z.enum(['pages', 'bookmarks', 'comments', 'forms', 'layers', 'search']),
  fallback: 'pages',
  category: 'appearance',
  optionTitles: PANEL_TITLES,
};

/** Whether the document panel is open. Open by default: the page strip is how a person finds a page. */
export const DOCUMENT_PANEL_OPEN_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'appearance.document-panel-open',
  title: DOCUMENT_PANEL_OPEN_TITLE,
  schema: z.boolean(),
  fallback: true,
  category: 'appearance',
};

/**
 * The narrowest the document panel may be, in CSS pixels.
 *
 * Derived from the strip it must hold, read from the stylesheets on 2026-09-14: the strip's
 * `--space-4` padding on both sides (8), six `--control-panel-tab` tabs (144) with five
 * `--space-2` gaps (10), the `--space-2` gap before the collapse chevron (2), the chevron itself —
 * a 14 px glyph with `--space-4` padding and a 1 px border on each side (24) — and the panel's
 * 1 px border: 189, raised to 192, the next step of §10.2's 8 px grid. Narrower, and the strip's
 * last tab or the chevron is clipped. The rendered test asserts the strip fits at this width.
 */
export const DOCUMENT_PANEL_MIN_WIDTH = 192;

/**
 * The widest the document panel may be, in CSS pixels.
 *
 * A CHOICE, not a measurement: nothing in the law bounds it. 480 leaves a 1280 px window with
 * most of its width for the pages, and it bounds what a stored value can do — a width written
 * on a wide monitor and read on a small one cannot take the whole document surface.
 */
export const DOCUMENT_PANEL_MAX_WIDTH = 480;

/**
 * The document panel's width, in CSS pixels (§10.3: *"panels resizable with persisted widths"*).
 *
 * Pixels because that is what a person sets: the panel stays the width they dragged it to when the
 * window changes. The splitter speaks percentages of its root, and `primitives/splitterSize.ts` is
 * the one conversion between the two. The fallback is the fixed width the panel had before it was
 * resizable, so the day this lands nothing on screen moves.
 */
export const DOCUMENT_PANEL_WIDTH_SETTING: SettingDefinition<z.ZodNumber> = {
  id: 'appearance.document-panel-width',
  title: DOCUMENT_PANEL_WIDTH_TITLE,
  schema: z.number().int().min(DOCUMENT_PANEL_MIN_WIDTH).max(DOCUMENT_PANEL_MAX_WIDTH),
  fallback: 224,
  category: 'appearance',
};
