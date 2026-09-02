import { z } from 'zod';

import { GRID_TITLE, RULERS_TITLE, RULER_UNIT_TITLE } from '../messages/en.js';
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
export const RULER_UNIT_SETTING: SettingDefinition<
  z.ZodEnum<{ in: 'in'; cm: 'cm'; pt: 'pt' }>
> = {
  id: 'viewing.ruler-unit',
  title: RULER_UNIT_TITLE,
  schema: z.enum(['in', 'cm', 'pt']),
  fallback: 'in',
  category: 'viewing',
};
