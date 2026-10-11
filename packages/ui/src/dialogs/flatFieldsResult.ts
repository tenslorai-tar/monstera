import { z } from 'zod';

/**
 * What the flat-field review answers with — its own module for
 * `extractPagesResult.ts`'s forced reason: the entry imports the body lazily
 * and the body needs this type, so declaring it beside the entry would make the
 * two circular.
 *
 * **The keys of the proposals that were ticked**, not the proposals themselves.
 * The rectangles are the kernel's answer and the renderer is holding them
 * already; sending them back through a dialog result would give the command two
 * sources for one geometry, and the one that came from a form control is the one
 * that can be wrong. A key and never a name, because a radio group's options
 * share one name.
 *
 * `.min(1)` mirrors the command: `createFormField` refuses an empty list,
 * because a create that mints nothing is a version bump and an undo step for a
 * document nothing happened to. A dialog that could answer with none would put
 * that refusal in front of the user as an internal error — so the accept is
 * disabled instead, and a reader who wants none dismisses.
 *
 * **`all-pages` is a REPORT** (ADR-0158, `pageBarcodes.ts`' *read-all*): the
 * window stays open and the command answers it with every page's proposals
 * (ADR-0226 Decision 14, the owner's K7).
 */
export const FLAT_FIELDS_RESULT = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accept'), accepted: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal('all-pages') }).strict(),
]);

/** What a reader answered: the keys they ticked, or the ask for every page. */
export type FlatFieldsAnswer = z.infer<typeof FLAT_FIELDS_RESULT>;
