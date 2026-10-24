import type { MessageKey } from '@monstera/shared';

import {
  PANEL_ACCESSIBILITY,
  PANEL_BOOKMARKS,
  PANEL_COMMENTS,
  PANEL_FORMS,
  PANEL_LAYERS,
  PANEL_PAGES,
  PANEL_SEARCH,
} from '../messages/en.js';
import type { IconName } from '../primitives/icons.js';

/**
 * §10.3's document panels: *"one document panel at a time — Pages, Bookmarks, Comments,
 * Forms, Layers, Search, Accessibility"* (Accessibility amended 2026-10-24, ADR-0265).
 *
 * A closed union with a runtime roster in strip order, `SectionId`'s shape and its
 * reason: another panel is a change to the layout anatomy, so it is a compile error in
 * every total record keyed by this type rather than a string a surface happens to
 * accept.
 */
export type PanelId = 'pages' | 'bookmarks' | 'comments' | 'forms' | 'layers' | 'search' | 'accessibility';

/** The panels in strip order. */
export const PANEL_IDS: readonly [PanelId, PanelId, PanelId, PanelId, PanelId, PanelId, PanelId] = [
  'pages',
  'bookmarks',
  'comments',
  'forms',
  'layers',
  'search',
  'accessibility',
];

/**
 * Each panel's name and glyph. The name is the tab's accessible name and tooltip, since
 * §10.3 gives the panel *"no separate title row"*.
 */
export const PANELS: Readonly<Record<PanelId, { readonly title: MessageKey; readonly icon: IconName }>> = {
  pages: { title: PANEL_PAGES, icon: 'FileStack' },
  bookmarks: { title: PANEL_BOOKMARKS, icon: 'Bookmark' },
  comments: { title: PANEL_COMMENTS, icon: 'MessageSquare' },
  forms: { title: PANEL_FORMS, icon: 'ClipboardList' },
  layers: { title: PANEL_LAYERS, icon: 'Layers' },
  search: { title: PANEL_SEARCH, icon: 'Search' },
  // THE ACCESSIBILITY CHECK COMMAND'S OWN GLYPH, so the tab and the command that opens it read as one thing.
  accessibility: { title: PANEL_ACCESSIBILITY, icon: 'ShieldCheck' },
};
