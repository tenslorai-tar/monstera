import { MAX_OBJECT_SCALE, MAX_PAGE_COORDINATE, MIN_OBJECT_SCALE } from '@monstera/contract';
import { z } from 'zod';

/**
 * What the object editor answers with — its own module for
 * `replaceTextObjectResult.ts`'s forced reason: the entry imports the body
 * lazily and the body needs this type, so declaring it beside the entry would
 * make the two circular.
 *
 * ## A DISCRIMINATED UNION, because the dialog dispatches one of THREE commands
 *
 * `placePageObject`, `recolorPageObjects` and `deletePageObjects` are separate
 * commands with separate undo shapes — two invertible from a prior, one taking
 * a checkpoint because PDFium cannot rebuild a removed object. A single answer
 * carrying optional fields for all three would let a caller build *move it and
 * also delete it*, which is not a thing, and would push the choice of what to
 * dispatch into a chain of `if` statements at the call site.
 *
 * The union makes each answer exactly one intent (B5), and the command reads
 * `action` once.
 *
 * ## Every bound is the COMMAND's, imported rather than restated
 *
 * `MAX_PAGE_COORDINATE`, `MIN_OBJECT_SCALE` and `MAX_OBJECT_SCALE` are what the
 * three schemas enforce. Numbers written here would be this dialog's opinion
 * about limits the contract owns, and the day the two disagreed a person would
 * meet a refusal over their document instead of a disabled button.
 */
export const EDIT_PAGE_OBJECT_RESULT = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('place'),
      index: z.number().int().nonnegative(),
      moveBy: z
        .object({
          x: z.number().min(-MAX_PAGE_COORDINATE).max(MAX_PAGE_COORDINATE),
          y: z.number().min(-MAX_PAGE_COORDINATE).max(MAX_PAGE_COORDINATE),
        })
        .strict(),
      scaleBy: z
        .object({
          x: z.number().min(MIN_OBJECT_SCALE).max(MAX_OBJECT_SCALE),
          y: z.number().min(MIN_OBJECT_SCALE).max(MAX_OBJECT_SCALE),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal('recolor'),
      index: z.number().int().nonnegative(),
      colour: z
        .object({
          red: z.number().int().min(0).max(255),
          green: z.number().int().min(0).max(255),
          blue: z.number().int().min(0).max(255),
          alpha: z.number().int().min(0).max(255),
        })
        .strict(),
    })
    .strict(),
  z.object({ action: z.literal('delete'), index: z.number().int().nonnegative() }).strict(),
]);

/** Which object, and what to do to it. */
export type EditPageObjectAnswer = z.infer<typeof EDIT_PAGE_OBJECT_RESULT>;
