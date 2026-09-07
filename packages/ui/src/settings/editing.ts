import {
  MAX_ANNOTATION_BORDER,
  MAX_ANNOTATION_FONT,
  MIN_ANNOTATION_FONT,
  measurePerPointSchema,
  measureUnitSchema,
} from '@monstera/contract';
import { z } from 'zod';

import {
  EDITING_COLOUR_TITLE,
  EDITING_FONT_SIZE_TITLE,
  EDITING_IMAGE_PAGES_TITLE,
  EDITING_LINE_WIDTH_TITLE,
  EDITING_OPACITY_TITLE,
  MEASURE_SCALE_TITLE,
  MEASURE_UNIT_TITLE,
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

/**
 * How many units one PDF point represents on this drawing.
 *
 * `BUILD-PROMPT.md`:615's *measurement unit & scale*, and it is a **setting**
 * for the same reason its neighbours are: a person working through a set of
 * plans drawn at one scale sets it once. It is the shakiest of the five on that
 * point — the scale is a fact about the DOCUMENT rather than about the person —
 * and it is here rather than in the document's own state because nothing in the
 * file records it and a per-document store would have to invent somewhere to
 * keep it. Stated so the next reader meets the trade rather than the choice.
 *
 * **One by default, which means the reading is in the unit itself.** A point is
 * 1/72 inch, so an uncalibrated distance reads in points and is honest: nothing
 * has told this build what the drawing is.
 */
export const MEASURE_SCALE_SETTING: SettingDefinition<typeof measurePerPointSchema> = {
  id: 'editing.measure-scale',
  title: MEASURE_SCALE_TITLE,
  // THE PAYLOAD'S OWN SCHEMA, for the reason the bounds above are imported: a
  // control that accepts a number the command refuses fails on apply, and this
  // field is one a person types into.
  schema: measurePerPointSchema,
  fallback: 1,
  category: 'editing',
};

/** What unit a measurement is stated in. The contract's closed set. */
export const MEASURE_UNIT_SETTING: SettingDefinition<typeof measureUnitSchema> = {
  id: 'editing.measure-unit',
  title: MEASURE_UNIT_TITLE,
  schema: measureUnitSchema,
  fallback: 'pt',
  category: 'editing',
};

/**
 * Which pages a placed image goes on — the stamps row's **multi-page apply**.
 *
 * ## Why a setting rather than a dialog after every drag
 *
 * `docs/FEATURES.md`'s stamps row asks for *multi-page apply*, and the command
 * has taken a page list since it was written: stamping ten pages is one
 * decision, so it is one log entry and one undo. What was missing was a way for
 * a person to say so.
 *
 * A dialog after each drag would ask the question every time and the answer is
 * *this page* almost every time — which is the shape that trains people to
 * dismiss it. A setting is asked once and then it is a **mode**, which is what
 * *stamp this on every page* actually is: somebody applying a DRAFT mark to a
 * document is doing it to the document, not to page four.
 *
 * ## `'this'` is the default, and the cost of getting it wrong is asymmetric
 *
 * Placing on one page when you meant all of them is one more drag. Placing on
 * all of them when you meant one is a mark on every page of a long document,
 * removed one at a time — there is no *undo the stamps* short of the command's
 * own undo, which is the whole placement and therefore the right tool, and a
 * person who has since done something else has lost that.
 *
 * So the safe value is the default, and it is the one that matches what the
 * gesture looks like: a box drawn on the page in front of you.
 */
export const IMAGE_PAGES_SETTING: SettingDefinition<z.ZodEnum<{ this: 'this'; all: 'all' }>> = {
  id: 'editing.image-pages',
  title: EDITING_IMAGE_PAGES_TITLE,
  schema: z.enum(['this', 'all']),
  fallback: 'this',
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
