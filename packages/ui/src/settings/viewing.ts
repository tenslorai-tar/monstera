import { RECENT_LENGTHS, RECENT_LENGTH_SETTING_ID, type RecentLength } from '@monstera/contract';
import { z } from 'zod';

import {
  RECENT_LENGTH_10,
  RECENT_LENGTH_20,
  RECENT_LENGTH_30,
  RECENT_LENGTH_5,
  RECENT_LENGTH_DESCRIPTION,
  RECENT_LENGTH_TITLE,
  RESTORE_SESSION_DESCRIPTION,
  RESTORE_SESSION_TITLE,
  DARK_PAGE_DESCRIPTION,
  DARK_PAGE_TITLE,
  GRID_DESCRIPTION,
  GRID_TITLE,
  LOUPE_DESCRIPTION,
  LOUPE_TITLE,
  PAGE_BADGES_DESCRIPTION,
  PAGE_BADGES_TITLE,
  SMOOTH_SCROLL_DESCRIPTION,
  SMOOTH_SCROLL_TITLE,
  SPLIT_VIEW_TITLE,
  RULERS_DESCRIPTION,
  RULERS_TITLE,
  RULER_UNIT_DESCRIPTION,
  RULER_UNIT_TITLE,
  SECOND_RENDERER_DESCRIPTION,
  SECOND_RENDERER_TITLE,
  STARTING_ZOOM_DESCRIPTION,
  STARTING_ZOOM_OPTION_TITLES,
  STARTING_ZOOM_TITLE,
  UNIT_TITLES,
  ZOOM_STEP_DESCRIPTION,
  ZOOM_STEP_OPTION_TITLES,
  ZOOM_STEP_TITLE,
} from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';
import { STARTING_ZOOMS, type StartingZoom, ZOOM_STEP_CHOICES, type ZoomStep } from '../zoom.js';

/**
 * What a reader sees over the page, as opposed to how the shell is painted.
 *
 * ## Why `viewing` is a category and not three settings under `appearance`
 *
 * `BUILD-PROMPT.md:608-611` groups the settings this way, and the grouping is a
 * real distinction rather than a filing convention: *appearance* is the shell's
 * chrome — theme, accent, contrast — while these change what is drawn over the
 * document. A reader looking for the grid does not look under the theme.
 *
 * Adding the category is registration into the existing seam, not a change to
 * it: `SettingCategory` is the registry's own list of drawers, and the founding
 * record already named this one.
 *
 * ## None is a preference about the document
 *
 * Each defaults off, or to a person's own unit, except the rulers, which the owner's design draws
 * on every document screen. A ruler and a grid are reading aids. They are stored per install rather than
 * per document, because a document does not have an opinion about whether you
 * want a ruler — which is the same reason a document's zoom is its window's state, and only the zoom a document
 * OPENS at is a setting (*Starting zoom*, below).
 */
export const RULERS_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'viewing.rulers',
  title: RULERS_TITLE,
  description: RULERS_DESCRIPTION,
  schema: z.boolean(),
  // ON BY DEFAULT since the owner's v5 design (2026-09-24), which draws the rulers along the top and
  // left of the page area on every document screen. A stored choice still wins.
  fallback: true,
  category: 'viewing',
};

/**
 * Whether the page itself is drawn inverted.
 *
 * ## NOT A THEME, and keeping the two apart is the whole reason this is here
 *
 * A theme repaints the shell. This repaints the **document**, which is content
 * — a reader in the dark theme still gets a white page, because the page is the
 * thing they are reading rather than the furniture around it. Folding it into
 * `appearance.theme` would make *I want dark chrome* and *I want the document
 * inverted* one choice, and they are routinely different: the common case is
 * dark chrome with a normal page.
 *
 * It is in `viewing` for the same reason the rulers are: it changes what is
 * drawn over — here, what the page is drawn as.
 */
export const DARK_PAGE_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'viewing.dark-page',
  title: DARK_PAGE_TITLE,
  description: DARK_PAGE_DESCRIPTION,
  schema: z.boolean(),
  fallback: false,
  category: 'viewing',
};

/**
 * Whether the loupe follows the pointer.
 *
 * A reading aid like the rulers, and off by default for the same reason: a
 * magnifier that appeared unasked would follow every pointer movement across a
 * document somebody was simply reading.
 */
export const LOUPE_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'viewing.loupe',
  title: LOUPE_TITLE,
  description: LOUPE_DESCRIPTION,
  schema: z.boolean(),
  fallback: false,
  category: 'viewing',
};

/**
 * Whether the documents open when Monstera last closed are opened again at start — Part F's *"restore last session"*
 * (`BUILD-PROMPT.md`:611). **After a clean close only** (`restoreLastSession`): after a run that died, the start screen
 * offers them one by one instead. **Off by default**, the start screen being where a launch has always landed.
 */
export const RESTORE_SESSION_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'viewing.restore-session',
  title: RESTORE_SESSION_TITLE,
  description: RESTORE_SESSION_DESCRIPTION,
  schema: z.boolean(),
  fallback: false,
  category: 'viewing',
};

/**
 * How many documents the recent list keeps — Part F's *"recent-files length"* (`BUILD-PROMPT.md`:611). `main`'s store
 * reads the same id (`recentLengthIn`) at each opening and each reading; a shorter choice drops what is past it the next
 * time the list is read, pictures included. Ten by default, the list's length before it was a choice.
 */
export const RECENT_LENGTH_SETTING: SettingDefinition<z.ZodEnum<{ [K in RecentLength]: K }>> = {
  id: RECENT_LENGTH_SETTING_ID,
  title: RECENT_LENGTH_TITLE,
  description: RECENT_LENGTH_DESCRIPTION,
  schema: z.enum(Object.keys(RECENT_LENGTHS) as [RecentLength, ...RecentLength[]]),
  fallback: 'ten',
  category: 'viewing',
  optionTitles: { five: RECENT_LENGTH_5, ten: RECENT_LENGTH_10, twenty: RECENT_LENGTH_20, thirty: RECENT_LENGTH_30 },
};

/**
 * Whether going to a page GLIDES there — Part F's *"smooth scroll"* (`BUILD-PROMPT.md`:610).
 *
 * **Navigation only**: going to a page, the next or the previous, a citation's jump. A reader's own scrolling is the
 * browser's, and the hand tool sets the position directly, which a smooth behaviour would make lag behind the pointer.
 * **Reduced motion always wins**, read from the one attribute `applyMotion` writes, so this setting cannot move what
 * the platform or the reader asked to keep still. **Off by default**: a jump is the behaviour readers had, and a glide
 * across three hundred pages is a delay in arriving.
 */
export const SMOOTH_SCROLL_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'viewing.smooth-scroll',
  title: SMOOTH_SCROLL_TITLE,
  description: SMOOTH_SCROLL_DESCRIPTION,
  schema: z.boolean(),
  fallback: false,
  category: 'viewing',
};

/**
 * Whether each page carries its number at its foot — Part F's *"page number badges"* (`BUILD-PROMPT.md`:611).
 *
 * **Off by default**: the status bar already says which page is current, and v5-02 draws the pages clean. The
 * number is the page's place in the document, as the status bar counts it — never a label the file declares — so the
 * two can never name one page differently.
 */
export const PAGE_BADGES_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'viewing.page-badges',
  title: PAGE_BADGES_TITLE,
  description: PAGE_BADGES_DESCRIPTION,
  schema: z.boolean(),
  fallback: false,
  category: 'viewing',
};

/**
 * Whether the document is shown in two viewports side by side.
 *
 * ## One document, one parser, two scrollers
 *
 * The second viewport is not a second document: both panes render through the
 * same `DocumentView`, so a split view costs one more set of visible page
 * bitmaps and not a second parse, a second worker or a second byte transport.
 * Side-by-side compare of two DIFFERENT documents is a different feature, and
 * it waits for multi-document tabs.
 *
 * A setting rather than component state, for the loupe's reason: it is a way of
 * reading the reader chooses, and a reader who works in split view wants it
 * back next time.
 */
export const SPLIT_VIEW_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'viewing.split',
  title: SPLIT_VIEW_TITLE,
  schema: z.boolean(),
  fallback: false,
  category: 'viewing',
  // REMEMBERED: split view is a layout the ribbon and Ctrl+Shift+E turn on, not a preference.
  remembered: true,
};

export const GRID_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'viewing.grid',
  title: GRID_TITLE,
  description: GRID_DESCRIPTION,
  schema: z.boolean(),
  fallback: false,
  category: 'viewing',
};

/**
 * The unit the ruler and the grid are both read in.
 *
 * **ONE setting for both**, because a grid line the reader cannot find on the
 * ruler is a grid that means nothing — two independent unit settings would let
 * exactly that state exist (B3: one writer for *what unit is in force*).
 *
 * The fallback is `in` rather than the locale's convention, and that is a known
 * limitation rather than a decision: reading a measurement convention off the
 * locale is a real feature with its own failure modes, and guessing wrong is
 * more annoying than a default a reader changes once. Stated here so nobody
 * reads `in` as considered and rejected.
 *
 * **Stage 3's *measurement unit & scale* is a different setting.** That one
 * carries a drawing scale — 1:100 — for measurement annotations, and bundling
 * the unit into it now would make this reading aid depend on a Stage 3 concept.
 * When it lands, the unit it shares with this one is the thing to check.
 */
/**
 * Puts dark-page mode into force, or takes it out.
 *
 * ## An ATTRIBUTE and a CSS filter, not a second rasterisation
 *
 * The alternative is inverting pixels after each render, which costs a pass
 * over every bitmap on every draw and has to be redone at every zoom step. A
 * filter is composited, costs nothing to change, and survives a zoom without
 * re-rasterising anything — so turning the mode on is instant at any document
 * size, which is the property that makes it usable rather than a preference
 * someone sets once and leaves.
 *
 * It is applied on the ROOT rather than passed down, the way the theme is: one
 * writer of one attribute, and the stylesheet decides which elements it reaches.
 * A prop threaded to every canvas would be the same decision made in several
 * places.
 *
 * **`invert` alone is not what this does.** A plain negative turns blue links
 * orange and photographs into something nobody can read; the hue rotation after
 * it puts hues back where they were, so a dark page keeps its colours
 * recognisable and only its lightness flips. That pairing lives in `app.css`
 * beside the rule, because it is one effect rather than two decisions.
 */
export function applyDarkPage(root: HTMLElement, on: boolean): void {
  if (on) root.dataset['darkPage'] = 'true';
  else root.removeAttribute('data-dark-page');
}

export const RULER_UNIT_SETTING: SettingDefinition<
  z.ZodEnum<{ in: 'in'; cm: 'cm'; pt: 'pt' }>
> = {
  id: 'viewing.ruler-unit',
  title: RULER_UNIT_TITLE,
  description: RULER_UNIT_DESCRIPTION,
  schema: z.enum(['in', 'cm', 'pt']),
  fallback: 'in',
  category: 'viewing',
  // THE MEASUREMENT'S UNIT TITLES, the three this ruler draws: one word per unit
  // in this build, so a ruler and a measurement never call centimetres two things.
  optionTitles: { in: UNIT_TITLES.in, cm: UNIT_TITLES.cm, pt: UNIT_TITLES.pt },
};

/**
 * Whether the page is drawn by the second engine.
 *
 * ## It is a SECOND OPINION and not a better one, which the label has to carry
 *
 * §6.1, amended 2026-09-10 on two measurements: the reference-free metric that
 * ranks two rasterisers reads hinting rather than accuracy, and a pixel-for-pixel
 * comparison of this pair put them **12.716 levels apart over inked pixels with
 * 1.84% of the canvas differing**. They differ materially; difference is not
 * quality. So the setting exists for a reader whose document one rasteriser
 * draws badly, and calling it *high definition* — which is what the row was
 * named — would be a claim no measurement supports.
 *
 * ## In `viewing` beside the dark page, and for its reason
 *
 * Both change how the **document** is drawn rather than how the shell is
 * painted, which is the distinction that keeps `appearance` from becoming the
 * drawer everything lands in. A reader looking for this does not look under the
 * theme.
 *
 * ## OFF by default, and that is not timidity
 *
 * PDF.js draws every page today; turning this on routes every page through a
 * contained host, an image encode and an IPC crossing. A default that made the
 * common path the expensive one would be a performance decision taken by a
 * setting nobody chose — and an installation without `pdfium.dll` cannot honour
 * it at all, which is the state a Store build may ship in.
 */
export const SECOND_RENDERER_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'viewing.second-renderer',
  title: SECOND_RENDERER_TITLE,
  description: SECOND_RENDERER_DESCRIPTION,
  schema: z.boolean(),
  fallback: false,
  // HOW A PAGE IS DRAWN is the owner's *Rendering* page; the id keeps its `viewing.` prefix, which
  // names where the setting was declared and not which page shows it.
  category: 'rendering',
};

/**
 * The zoom a document OPENS at — Part F's *"default zoom mode & level"* (`BUILD-PROMPT.md`:609).
 *
 * **100% by default, which is what every document opened at before this setting existed.** Read once, when a document's
 * store is made (`App.tsx`'s opener); after that the zoom is the window's, and changing this moves no open document.
 */
export const STARTING_ZOOM_SETTING: SettingDefinition<z.ZodEnum<{ [K in StartingZoom]: K }>> = {
  id: 'viewing.starting-zoom',
  title: STARTING_ZOOM_TITLE,
  description: STARTING_ZOOM_DESCRIPTION,
  schema: z.enum(STARTING_ZOOMS),
  fallback: '100pct',
  category: 'viewing',
  optionTitles: STARTING_ZOOM_OPTION_TITLES,
};

/**
 * How far `+`, `−` and Ctrl+wheel move the zoom — Part F's *"zoom step"*. The ladder is the default, as the owner
 * answered on 2026-09-27: the steps every viewer this one replaces offers, closer together near 100%. The others move
 * by a fixed number of percentage points, within the ladder's ends (`stepZoom`).
 */
export const ZOOM_STEP_SETTING: SettingDefinition<z.ZodEnum<{ [K in ZoomStep]: K }>> = {
  id: 'viewing.zoom-step',
  title: ZOOM_STEP_TITLE,
  description: ZOOM_STEP_DESCRIPTION,
  schema: z.enum(ZOOM_STEP_CHOICES),
  fallback: 'ladder',
  category: 'viewing',
  optionTitles: ZOOM_STEP_OPTION_TITLES,
};
