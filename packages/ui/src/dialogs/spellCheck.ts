import { spellingLanguageSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { SPELL_CHECK_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { SPELL_CHECK_RESULT } from './spellCheckResult.js';

/** The id `checkSpellingCommand` opens, and the registry's key. */
export const SPELL_CHECK_DIALOG_ID = 'dialog.spell-check';

/**
 * What the document's spelling came to, and the place a word joins the personal
 * dictionary.
 *
 * ## The command checks and the dialog displays, which is `wordCount.ts`' split
 *
 * `DialogRegistry.openWith` validates props at the open call, so the walk
 * finishes before this opens rather than the body fetching its own — a body
 * that fetched would be validated before it had anything to validate (ADR-0029
 * Decision 7).
 *
 * ## It opens on a clean document too, which is `flatFields`' rule
 *
 * A command that silently did nothing when it found nothing is one a person
 * presses twice, and *found nothing* is the reassuring answer — the one that
 * reads identically whether the check ran, ran against an empty dictionary, or
 * never ran at all. So the empty result is stated in words.
 *
 * ## `unavailable` is a state and not an empty list
 *
 * A dictionary that could not be loaded produces zero misspellings, which is
 * byte-for-byte what a correctly spelt document produces. Conflating them would
 * tell a reader their document is clean on a build that shipped without its
 * dependency — the failure that looks exactly like the feature working.
 *
 * ## `pagesChecked` is not decoration, for `wordCount`'s reason
 *
 * A walk that stopped — a document closed, a lane that refused, a version that
 * moved — gives a list shorter than the document, which looks exactly like a
 * shorter document with fewer problems.
 */
export const SPELL_CHECK_DIALOG = declareDialog({
  id: SPELL_CHECK_DIALOG_ID,
  title: SPELL_CHECK_TITLE,
  props: z
    .object({
      /** Whether a checker was built at all. */
      available: z.boolean(),
      /**
       * Which dictionary was used.
       *
       * THE ID, not its title. `languages.ts` owns what a language is called
       * and the body asks it — a title crossing here would be a second answer
       * to that question, and it would arrive already resolved into whatever
       * language the command happened to assume (B3a, and B9's own rule).
       */
      language: spellingLanguageSchema,
      misspellings: z
        .array(
          z.object({
            word: z.string().min(1),
            occurrences: z.number().int().positive(),
            /** Zero-based, as everything kernel-side is. The body adds one. */
            firstPage: z.number().int().nonnegative(),
            suggestions: z.array(z.string().min(1)).readonly(),
          }),
        )
        .readonly(),
      pagesChecked: z.number().int().nonnegative(),
      pageCount: z.number().int().positive(),
    })
    .strict(),
  result: SPELL_CHECK_RESULT,
  // Lazy, per ADR-0029 Decision 7: nothing is loaded until this is opened.
  component: lazy(() => import('./SpellCheckBody.js')),
});
