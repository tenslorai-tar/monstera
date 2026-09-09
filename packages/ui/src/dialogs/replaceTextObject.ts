import { lazy } from 'react';
import { z } from 'zod';

import { REPLACE_TEXT_OBJECT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { REPLACE_TEXT_OBJECT_RESULT } from './replaceTextObjectResult.js';

/** The id `replaceTextObjectCommand` opens to choose an object and its new text. */
export const REPLACE_TEXT_OBJECT_DIALOG_ID = 'dialog.replace-text-object';

/**
 * Which run of text on this page is being replaced, and with what.
 *
 * ## The choice is over INDICES, and this dialog cannot show the words
 *
 * `document.textObjects` answers the editing engine's own numbering and nothing
 * else — no handles, because a `FPDF_PAGEOBJECT` dies with the page it came
 * from, and no text, because an object's string is **prior state** that arrives
 * when the command captures it. So the list a reader is offered is a list of
 * positions in the page's object order, and that is a real limitation stated
 * here rather than papered over: what gives a person something to *recognise*
 * is line-level editing and find-and-replace, which are the two rows after this
 * one. This is the primitive they are built from.
 *
 * The consequence for the wording is that the dialog says what an index is
 * before it offers any: a number with no explanation reads as an error code.
 *
 * ## The list is not derived from anything MuPDF said
 *
 * `docs/FEATURES.md`'s row and `commandDeclarations.ts`' `targets:
 * 'text-object'` both exist for this: the page's structured text and the page's
 * object list are two engines' numbering of one page, and joining them is
 * `pageNumbering.ts`' lesson one frame worse — two halves each correct in its
 * own frame for ever. The indices here come from the channel that asks PDFium,
 * and there is no other route to one.
 *
 * ## It opens even when the page has NO text objects, which is `flatFields`' rule
 *
 * A command that silently did nothing on a page of images is one a person
 * presses twice. The empty case is reported in words with the apply disabled.
 *
 * ## `truncated` rides in for the flat-field review's reason
 *
 * A reader choosing from a clipped list would pick from part of the page while
 * believing they had seen it.
 */
export const REPLACE_TEXT_OBJECT_DIALOG = declareDialog({
  id: REPLACE_TEXT_OBJECT_DIALOG_ID,
  title: REPLACE_TEXT_OBJECT_TITLE,
  props: z
    .object({
      indices: z.array(z.number().int().nonnegative()),
      truncated: z.boolean(),
    })
    .strict(),
  result: REPLACE_TEXT_OBJECT_RESULT,
  component: lazy(() => import('./ReplaceTextObjectBody.js')),
});
