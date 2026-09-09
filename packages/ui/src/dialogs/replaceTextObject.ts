import { lazy } from 'react';
import { z } from 'zod';

import { REPLACE_TEXT_OBJECT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { REPLACE_TEXT_OBJECT_RESULT } from './replaceTextObjectResult.js';

/** The id `replaceTextObjectCommand` opens to choose a line and edit its text. */
export const REPLACE_TEXT_OBJECT_DIALOG_ID = 'dialog.replace-text-object';

/**
 * Which line of text on this page is being edited, and what it should say.
 *
 * ## The choice is over LINES, and the person reads the words
 *
 * This dialog offered a list of INDICES until 2026-09-09, because
 * `document.textObjects` answered the engine's own numbering and nothing else.
 * A chooser of numbers is what the region-replacement row shipped and said so;
 * `document.textLines` closes it, and this is the surface that closes.
 *
 * There is exactly one control in the Edit section for editing a page's text.
 * Two — one naming numbers and one naming words, where the second obsoletes the
 * first — would be the second wiring place the command registry exists to
 * forbid, so this dialog was converted rather than joined by a sibling.
 *
 * ## The line is a person's unit and the OBJECT is the engine's
 *
 * A visual line is several text objects: PDFium answers one rect per run
 * whether two runs on a baseline sit 170pt or 3pt apart, measured, so it has no
 * opinion about lines and the editor forms one by vertical overlap
 * ([ADR-0049](../../../docs/DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)).
 * **That ADR permits the grouping only while its output reaches a dialog a
 * person answers, and this is that dialog** — the grouping's whole consumer.
 * The runs travel with each line because the command names objects, and
 * `lineEdit.ts` turns the person's edit back into the objects it touched.
 *
 * ## The list is not derived from anything MuPDF said
 *
 * `docs/FEATURES.md`'s row and `commandDeclarations.ts`' `targets:
 * 'text-object'` both exist for this: the page's structured text and the page's
 * object list are two engines' numbering of one page, and joining them is
 * `pageNumbering.ts`' lesson one frame worse — two halves each correct in its
 * own frame for ever. Every index here came from the channel that asks PDFium
 * and is copied, never computed.
 *
 * ## It opens even when the page has NO text, which is `flatFields`' rule
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
      lines: z.array(
        z
          .object({
            runs: z.array(
              z
                .object({
                  index: z.number().int().nonnegative(),
                  text: z.string(),
                })
                .strict(),
            ),
          })
          .strict(),
      ),
      truncated: z.boolean(),
    })
    .strict(),
  result: REPLACE_TEXT_OBJECT_RESULT,
  component: lazy(() => import('./ReplaceTextObjectBody.js')),
});
