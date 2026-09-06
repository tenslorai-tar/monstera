import {
  MAX_ANNOTATION_BORDER,
  MAX_ANNOTATION_FONT,
  MIN_ANNOTATION_FONT,
} from '@monstera/contract';
import { z } from 'zod';

import {
  EDITING_COLOUR_TITLE,
  EDITING_FONT_SIZE_TITLE,
  EDITING_LINE_WIDTH_TITLE,
  EDITING_OPACITY_TITLE,
} from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * The style a new annotation is drawn in — `BUILD-PROMPT.md`:614's *editing
 * defaults*, and the first settings in the `editing` category.
 *
 * ## They are SETTINGS and not per-document state
 *
 * A person's preferred mark colour follows them between documents, which is the
 * test `viewing.ts` states: a document has no opinion about what colour you like
 * drawing in. That is also why they survive a restart, unlike the active tool —
 * the tool is a mode you are in, and this is how you like your marks.
 *
 * ## Three shipped rows have been waiting for these BY NAME
 *
 * The headers-and-footers row owes *a font choice*, the watermark row owes
 * *colour*, and the page-background row says *a colour control, until Stage 3's
 * style controls own the picker*. Those three take the same values, which is why
 * the bounds here are the contract's rather than numbers chosen locally: a
 * control that offers a size the payload refuses is a control that fails on
 * apply.
 */

/**
 * What a new annotation is coloured.
 *
 * ## `'auto'` IS A REAL STATE, not a sentinel standing in for a missing value
 *
 * A single colour for every tool is what the founding record asks for — *editing
 * defaults: annotation color* — and applied literally it would make the
 * highlighter paint in whatever the shapes use, which is how a person ends up
 * with a red wash over the text they meant to mark. Applied per tool it would be
 * eleven settings nobody wants to keep in step.
 *
 * So the value is a choice or the absence of one. `'auto'` means *use each
 * tool's own colour* — the highlighter's yellow, the note's yellow, the caret's
 * red — which is what somebody who has never opened this control expects. Any
 * colour set here is used by every tool, which is what somebody who HAS opened
 * it expects.
 *
 * **A hex string, and this is the one place a hex belongs.** §10.2 bans a raw
 * hex in a component and names *a user-chosen annotation color* as the
 * genuinely dynamic case. This is not a component and the value is the person's.
 */
export const ANNOTATION_COLOUR_SETTING: SettingDefinition<
  z.ZodUnion<[z.ZodLiteral<'auto'>, z.ZodString]>
> = {
  id: 'editing.annotation-colour',
  title: EDITING_COLOUR_TITLE,
  schema: z.union([z.literal('auto'), z.string().regex(/^#[0-9a-f]{6}$/u)]),
  fallback: 'auto',
  category: 'editing',
};

/**
 * How opaque a new annotation is.
 *
 * The contract's own bound, imported, so the slider cannot offer a value the
 * payload refuses — and the floor is 0.1 for the reason stated there: a fully
 * transparent mark is indistinguishable from a tool that did not fire.
 */
export const ANNOTATION_OPACITY_SETTING: SettingDefinition<z.ZodNumber> = {
  id: 'editing.annotation-opacity',
  title: EDITING_OPACITY_TITLE,
  schema: z.number().min(0.1).max(1),
  fallback: 1,
  category: 'editing',
};

/** How wide a new shape's stroke is, in points. */
export const ANNOTATION_LINE_WIDTH_SETTING: SettingDefinition<z.ZodNumber> = {
  id: 'editing.annotation-line-width',
  title: EDITING_LINE_WIDTH_TITLE,
  schema: z.number().min(0).max(MAX_ANNOTATION_BORDER),
  // TWO POINTS, which is what every shape tool has hard-coded since Stage 3
  // began. The default is what shipped rather than a fresh opinion: a setting
  // arriving with a different default silently restyles every mark a person
  // makes from that day, and nothing on screen says why.
  fallback: 2,
  category: 'editing',
};

/** What size a new text box, callout or typewriter is set in. */
export const ANNOTATION_FONT_SIZE_SETTING: SettingDefinition<z.ZodNumber> = {
  id: 'editing.annotation-font-size',
  title: EDITING_FONT_SIZE_TITLE,
  schema: z.number().min(MIN_ANNOTATION_FONT).max(MAX_ANNOTATION_FONT),
  fallback: 12,
  category: 'editing',
};
