import { lazy } from 'react';
import { z } from 'zod';

import { APPEND_REFUSED_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id a save or a copy opens when main answers that the file could not take an appended save. */
export const APPEND_REFUSED_DIALOG_ID = 'dialog.append-refused';

/**
 * The two ways forward: a copy written whole, or this file written whole. Leaving the file as it was is the dismissal,
 * so the platform's × and Escape are never the answer that breaks a signature.
 */
export const APPEND_REFUSED_RESULT = z.enum(['copy', 'anyway']);

export type AppendRefusedAnswer = z.infer<typeof APPEND_REFUSED_RESULT>;

/**
 * Asked when a signed document's save, which appends to keep its signatures, wrote a file that did not read back as the
 * document, so nothing was written
 * ([ADR-0291](../../../../docs/DECISIONS/0291-a-certified-document-is-locked-to-what-its-certifier-allowed-and-worked-on-as-a-copy.md)
 * question 4). `anyway` is offered where a save was asked and the document is not certified: on a certified document,
 * writing the file whole would break its certification, and the copy is the way out. `copying` is a copy that was
 * refused, where only a whole copy is offered.
 */
export const APPEND_REFUSED_DIALOG = declareDialog({
  id: APPEND_REFUSED_DIALOG_ID,
  title: APPEND_REFUSED_TITLE,
  props: z.object({ certified: z.boolean(), copying: z.boolean() }).strict(),
  result: APPEND_REFUSED_RESULT,
  component: lazy(() => import('./AppendRefusedBody.js')),
});
