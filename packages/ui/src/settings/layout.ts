import { z } from 'zod';

import {
  CONTEXT_PANEL_OPEN_TITLE,
  CONTEXT_PANEL_WIDTH_TITLE,
  DOCUMENT_PANEL_OPEN_TITLE,
  DOCUMENT_PANEL_TITLE,
  DOCUMENT_PANEL_WIDTH_TITLE,
  CONTEXT_PANEL_TAB_TITLE,
  CONTEXT_PANEL_TAB_TITLES,
  PANEL_TITLES,
  FLOAT_BAR_POSITION_TITLE,
  QUICK_TOOLBAR_OPEN_TITLE,
  LAYOUT_MODE_OPTION_TITLES,
  LAYOUT_MODE_DESCRIPTION,
  LAYOUT_MODE_TITLE,
  RIBBON_SECTION_OPTION_TITLES,
  RIBBON_SECTION_TITLE,
} from '../messages/en.js';
import { SECTION_IDS, type SectionId } from '../registries/placement.js';
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
  // REMEMBERED, not asked: the control for which tab is open is the tab.
  remembered: true,
  optionTitles: PANEL_TITLES,
};

/** Whether the document panel is open. Open by default: the page strip is how a person finds a page. */
export const DOCUMENT_PANEL_OPEN_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'appearance.document-panel-open',
  title: DOCUMENT_PANEL_OPEN_TITLE,
  schema: z.boolean(),
  fallback: true,
  category: 'appearance',
  remembered: true,
};

/**
 * The narrowest the document panel may be, in CSS pixels.
 *
 * Derived from the strip it must hold, read from the stylesheets: the strip's `--space-4` padding on both sides (8),
 * six v5 tabs of `--panel-tab-wide` (6 × 34 = 204) with five `--space-2` gaps (10), the `--space-2` gap before the
 * collapse chevron (2), the chevron itself — a 14 px glyph with `--space-4` padding and a 1 px border on each side (24)
 * — and the panel's 1 px border on each side (2): 250, raised to 256, the next step of §10.2's 8 px grid. Narrower,
 * and the strip's last tab or the chevron is clipped; the rendered test asserts the strip fits at this width. It was
 * 192 until 2026-09-26, derived from 24 px tabs; v5 draws them 34 wide, and the rendered case went red at 192.
 */
export const DOCUMENT_PANEL_MIN_WIDTH = 256;

/**
 * The widest a STORED document-panel width may be, in CSS pixels — the bound on what the setting holds.
 *
 * A CHOICE, not a measurement, and no longer what limits the panel on screen (the owner, 2026-09-26: people size
 * the panels *"as they wish"*). What is drawn is bounded by {@link SIDE_PANEL_MAX_SHARE} of the row, so a width
 * written on a wide monitor and read on a small one still cannot take the document surface; this only stops a
 * setting holding a number no monitor draws. It was 480 px until 2026-09-26.
 */
export const DOCUMENT_PANEL_MAX_WIDTH = 1600;

/**
 * The widest either side panel may be DRAWN, as a percentage of the document row (the owner, 2026-09-26).
 *
 * Chosen so the page area keeps a usable floor with BOTH panels at their widest: at 1920 × 1080 the row is about
 * 1,840 px wide, 35% of it is 644 px a side, and the page area keeps about 530 px — a letter page at 60% or more.
 * At the smallest window the application allows, each panel's minimum wins over the share.
 */
export const SIDE_PANEL_MAX_SHARE = 35;

/**
 * The page area's floor and a reopen handle's width (ADR-0146), defined in `@monstera/shared` beside the minimum window
 * the floor is derived from, which the rendered cases read as well. Re-exported so the layout's readers find every one
 * of its widths here.
 */
export { EDGE_HANDLE_WIDTH, PAGE_AREA_MIN_WIDTH } from '@monstera/shared';

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
  // v5: the left panel is 260 wide (224 until 2026-09-26).
  fallback: 260,
  category: 'appearance',
  // REMEMBERED: the control for a panel's width is its splitter.
  remembered: true,
};

/**
 * §10.3's layout switcher: *"three chrome modes, persisted per user — Ribbon (default) · Studio (the ribbon is
 * auto-hidden; selecting a section opens its full tool set as a temporary overlay …) · Focus (chrome hidden except the
 * title bar, floating toolbar and status bar; Esc returns)"*. **Modes hide chrome, never capability**, so this setting
 * decides only what is drawn; every command stays registered in every mode.
 *
 * Focus supersedes the side panels' collapse state without writing it: each panel's own open setting is untouched, so
 * leaving Focus restores *"its own prior state"* by construction rather than by remembering it.
 */
export const LAYOUT_MODE_SETTING: SettingDefinition<z.ZodEnum<{ ribbon: 'ribbon'; studio: 'studio'; focus: 'focus' }>> = {
  id: 'appearance.layout-mode',
  title: LAYOUT_MODE_TITLE,
  description: LAYOUT_MODE_DESCRIPTION,
  schema: z.enum(['ribbon', 'studio', 'focus']),
  fallback: 'ribbon',
  category: 'appearance',
  optionTitles: LAYOUT_MODE_OPTION_TITLES,
};

/** One of §10.3's three chrome modes. */
export type LayoutMode = z.infer<(typeof LAYOUT_MODE_SETTING)['schema']>;

/**
 * The rail's active section, persisted (§10.3: *"The rail's state model is identical in every mode: the active section
 * persists"*). `Ribbon.tsx` held it as component state and said persistence waited for the layout switcher, because the
 * two share one state model; this is that trigger.
 *
 * **The members are `SECTION_IDS` itself** (ADR-0105). A zod enum needs a literal tuple, and since the list became one
 * (`as const`) it is passed straight in — no cast and no second spelling; the written-out copy this replaced was held
 * equal by a test, which is a second list with a guard rather than one list. A stored section that holds nothing is
 * still the ribbon's to resolve — it opens on the first filled one.
 */
export const RIBBON_SECTION_SETTING: SettingDefinition<z.ZodEnum<{ [K in SectionId]: K }>> = {
  id: 'appearance.ribbon-section',
  title: RIBBON_SECTION_TITLE,
  schema: z.enum(SECTION_IDS),
  fallback: 'home',
  category: 'appearance',
  remembered: true,
  optionTitles: RIBBON_SECTION_OPTION_TITLES,
};

/**
 * Whether §10.3's floating quick toolbar shows (*"repositionable and hideable"*). Its own setting, so
 * `view.toggle-quick-toolbar` restores it from the palette, a chord and the status bar once the pill
 * is gone.
 */
export const QUICK_TOOLBAR_OPEN_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'appearance.quick-toolbar-open',
  title: QUICK_TOOLBAR_OPEN_TITLE,
  schema: z.boolean(),
  fallback: true,
  category: 'appearance',
  remembered: true,
};

/**
 * Where the Float bar is — §10.3's *"repositionable"*, built to the owner's 27 September list, item 4: *"Drag it
 * anywhere over the page area … it always stays inside the page area (window resize included); its position is
 * remembered; a 'Reset Float bar position' command restores the default."*
 *
 * `start` or `end` is the bar docked against that edge of the page area, vertically centred; `{ x, y }` is a place a
 * person moved it to, as a share of the bar's travel in the page area (`floatBarPlace.ts`), so no stored value can put
 * it outside. **`start` by default**, beside the pages a person reads from the left, where v5-02 draws it.
 *
 * It replaced `appearance.quick-toolbar-edge`, which held only the two docked places and which nothing could set;
 * a stored value under that id is dropped on load, as any id the registry no longer knows is.
 */
const FLOAT_BAR_PLACE = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
const FLOAT_BAR_POSITION = z.union([z.literal('start'), z.literal('end'), FLOAT_BAR_PLACE]);

export type FloatBarPosition = z.infer<typeof FLOAT_BAR_POSITION>;

export const FLOAT_BAR_POSITION_SETTING: SettingDefinition<typeof FLOAT_BAR_POSITION> = {
  id: 'appearance.float-bar-position',
  title: FLOAT_BAR_POSITION_TITLE,
  schema: FLOAT_BAR_POSITION,
  fallback: 'start',
  category: 'appearance',
  // REMEMBERED: the control for where the bar is, is the bar — its grip — and the reset command.
  remembered: true,
};

/**
 * Whether §10.3's right contextual panel is open (*"Both side panels are collapsible … State is
 * persisted per panel"*). Its own setting, never the document panel's: collapsing one side changes
 * nothing about the other.
 */
/**
 * Which tab the right contextual panel shows
 * ([ADR-0083](../../../../docs/DECISIONS/0083-the-contextual-panel-holds-tabs-and-the-assistant-is-one.md)).
 *
 * The document panel's rule one side over: the setting is the one owner of which tab shows,
 * so a command that opens the assistant and a person clicking the tab move the same value.
 * **Properties by default** — the panel held only that until this tab arrived, and a person
 * who has not asked for the assistant should not find their panel replaced by it. **Spelling** is the third
 * tab (ADR-0156), opened by the Spell check command. There is no fourth: the accessibility tools open in the left
 * document panel while in use (ADR-0189), so a stored `accessibility` from the build that had the tab is refused by
 * this schema and the setting falls back.
 */
export const CONTEXT_PANEL_TAB_SETTING: SettingDefinition<
  z.ZodEnum<{ properties: 'properties'; assistant: 'assistant'; spelling: 'spelling' }>
> = {
  id: 'appearance.context-panel-tab',
  title: CONTEXT_PANEL_TAB_TITLE,
  schema: z.enum(['properties', 'assistant', 'spelling']),
  fallback: 'properties',
  category: 'appearance',
  remembered: true,
  optionTitles: CONTEXT_PANEL_TAB_TITLES,
};

export const CONTEXT_PANEL_OPEN_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'appearance.context-panel-open',
  title: CONTEXT_PANEL_OPEN_TITLE,
  schema: z.boolean(),
  fallback: true,
  category: 'appearance',
  remembered: true,
};

/**
 * The narrowest the right contextual panel may be, in CSS pixels.
 *
 * SET 2026-09-14 from the style controls' min-content width, 211.39 px in the production build at
 * 1280 × 800, plus the panel's 1 px border, raised to 216 on §10.2's 8 px grid.
 *
 * **Those controls are gone and the figure no longer binds** (ADR-0102). The Properties tab that
 * replaced them measured 146.55 px min-content with nothing selected (production build, 1280 × 800,
 * 2026-09-24, printed by `renderedScreen.pw.ts`' minimum-width case), because its rows wrap and its
 * comment field takes a percentage width. With marks selected it is UNMEASURED — no harness can
 * select one yet — and so is the Assistant tab. So 216 is kept rather than lowered: nothing measured
 * says what a lower floor would clip.
 *
 * **RAISED TO 264 ON 2026-10-03, because the HEADER binds and nothing measured it.** v5 gave the two tabs a glyph
 * each, and the header then needed more than the panel at 216 gave it: measured in Chromium 151 at 1024 × 720, the
 * header's content was 256 px wide in a 238 px box, so the collapse chevron was clipped at the application's own
 * minimum window — and at 216 it was gone entirely. Read from the stylesheets and the English catalogue: the header's
 * `--space-8` start padding (8), the two tabs (220, as laid out), the `--space-4` gap (4), the chevron (24) and the
 * `--space-4` end padding (4), 260, plus the panel's 1 px border on each side (2): 262, raised to 264 on §10.2's 8 px
 * grid. The tabs' width is the catalogue's, so a longer language is held by the header's own rule instead: the
 * chevron never shrinks, and a tab's label gives way first (`app.css`, `.m-context-panel__tab-label`). The rendered
 * minimum-width case asserts both at this width.
 */
export const CONTEXT_PANEL_MIN_WIDTH = 264;

/** The widest the right contextual panel may be: the document panel's bound, for its reason. */
export const CONTEXT_PANEL_MAX_WIDTH = DOCUMENT_PANEL_MAX_WIDTH;

/**
 * The right contextual panel's width, in CSS pixels. The fallback is the owner's v5 width, 340.
 */
export const CONTEXT_PANEL_WIDTH_SETTING: SettingDefinition<z.ZodNumber> = {
  id: 'appearance.context-panel-width',
  title: CONTEXT_PANEL_WIDTH_TITLE,
  schema: z.number().int().min(CONTEXT_PANEL_MIN_WIDTH).max(CONTEXT_PANEL_MAX_WIDTH),
  // A WIDTH STORED UNDER THE OLD 216 FLOOR is the narrowest this panel can now be, never the fallback: the person chose
  // narrow, and refusing the value would have put them back at 340.
  migrate: (stored) => (typeof stored === 'number' && stored < CONTEXT_PANEL_MIN_WIDTH ? CONTEXT_PANEL_MIN_WIDTH : stored),
  // v5: the right panel is 340 wide (256 until 2026-09-26).
  fallback: 340,
  category: 'appearance',
  remembered: true,
};
