import { z } from 'zod';

/**
 * What the spell check review answers with — its own module for
 * `flatFieldsResult.ts`' forced reason: the entry imports the body lazily and
 * the body needs this type, so declaring it beside the entry would make the two
 * circular.
 *
 * **The words the reader added**, and nothing else. The misspellings themselves
 * went in as props and the command still holds them; sending them back would
 * give the command two sources for one list, and the one that came back through
 * a form control is the one that can be wrong.
 *
 * ## An empty list is a real answer here, unlike `flatFieldsResult`'s
 *
 * There the accept mints fields and an empty accept would be a version bump for
 * a document nothing happened to, so the control is disabled instead. Here the
 * reader's ordinary outcome is *I looked at the list and added nothing*, and
 * writing an unchanged personal dictionary costs nothing and changes no
 * document. So `.min(1)` would refuse the commonest case.
 */
export const SPELL_CHECK_RESULT = z
  .object({ added: z.array(z.string().trim().min(1)) })
  .strict();

/** The words a reader added to their personal dictionary. */
export type SpellCheckAnswer = z.infer<typeof SPELL_CHECK_RESULT>;
