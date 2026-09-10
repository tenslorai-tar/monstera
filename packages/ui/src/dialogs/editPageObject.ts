import { lazy } from 'react';
import { z } from 'zod';

import { EDIT_PAGE_OBJECT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { EDIT_PAGE_OBJECT_RESULT } from './editPageObjectResult.js';

/** The id `editPageObjectCommand` opens to pick an object and act on it. */
export const EDIT_PAGE_OBJECT_DIALOG_ID = 'dialog.edit-page-object';

/**
 * Which thing on this page is being moved, resized, recoloured or removed.
 *
 * ## One dialog, three commands, and that is not a second wiring place
 *
 * The registry forbids a second place where a feature is wired — a hand-kept
 * layout beside the command registry. This is not that: there is ONE registered
 * command, `document.edit-page-object`, and this dialog is the review step
 * inside its `run`. What a person answers decides which of the three kernel
 * commands it dispatches, exactly as `detectFlatFields` decides between
 * accepting and doing nothing.
 *
 * Three ribbon buttons for move, recolour and delete would be the alternative,
 * and it is worse for a reason the row makes plain: all three need the same
 * question answered first — *which object?* — so three controls would ask it
 * three times and a person would pick the same thing again for each.
 *
 * ## An object is named by WHAT IT IS and WHERE IT IS
 *
 * `document.pageObjects` answers a kind and a box, and carries no text. That is
 * stated rather than hidden: a text object is offered here by its position, not
 * its words, and editing words is the line row's dialog. A box in the page's
 * own coordinates is what a person can match against what they see — *the image
 * near the top* — where an index alone is a number.
 *
 * ## The list is not derived from anything MuPDF said
 *
 * `commandDeclarations.ts`' `targets: 'text-object'` is the reason: the page's
 * structured text and the page's object list are two engines' numbering of one
 * page, and joining them is `pageNumbering.ts`' lesson one frame worse. Every
 * index here came from the channel that asks PDFium.
 *
 * ## It opens even when the page has NO objects, which is `flatFields`' rule
 *
 * A command that silently did nothing is one a person presses twice.
 */
export const EDIT_PAGE_OBJECT_DIALOG = declareDialog({
  id: EDIT_PAGE_OBJECT_DIALOG_ID,
  title: EDIT_PAGE_OBJECT_TITLE,
  props: z
    .object({
      objects: z.array(
        z
          .object({
            index: z.number().int().nonnegative(),
            kind: z.enum(['unknown', 'text', 'path', 'image', 'shading', 'form']),
            left: z.number(),
            bottom: z.number(),
            right: z.number(),
            top: z.number(),
            fill: z
              .object({
                red: z.number().int().min(0).max(255),
                green: z.number().int().min(0).max(255),
                blue: z.number().int().min(0).max(255),
                alpha: z.number().int().min(0).max(255),
              })
              .nullable(),
          })
          .strict(),
      ),
      truncated: z.boolean(),
    })
    .strict(),
  result: EDIT_PAGE_OBJECT_RESULT,
  component: lazy(() => import('./EditPageObjectBody.js')),
});
