import { z } from 'zod';

import { DOCUMENT_PANEL_OPEN_TITLE, DOCUMENT_PANEL_TITLE, PANEL_TITLES } from '../messages/en.js';
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
