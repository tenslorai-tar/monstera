import { z } from 'zod';

import { DARK_PAGE_TITLE, GRID_TITLE, RULERS_TITLE, RULER_UNIT_TITLE } from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

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
 * ## All three default OFF or to a person's own unit, and none is a preference
 *   about the document
 *
 * A ruler and a grid are reading aids. They are stored per install rather than
 * per document, because a document does not have an opinion about whether you
 * want a ruler — which is the same reason the zoom is not a setting.
 */
export const RULERS_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'viewing.rulers',
  title: RULERS_TITLE,
  schema: z.boolean(),
  fallback: false,
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
  schema: z.boolean(),
  fallback: false,
  category: 'viewing',
};

export const GRID_SETTING: SettingDefinition<z.ZodBoolean> = {
  id: 'viewing.grid',
  title: GRID_TITLE,
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
  schema: z.enum(['in', 'cm', 'pt']),
  fallback: 'in',
  category: 'viewing',
};
