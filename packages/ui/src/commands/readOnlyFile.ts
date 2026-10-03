import type { ContractClient } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import { OPEN_PROBLEM_DIALOG_ID } from '../dialogs/openProblem.js';
import { READ_ONLY_FILE_DIALOG_ID, READ_ONLY_FILE_RESULT } from '../dialogs/readOnlyFile.js';
import { SAVE_PROBLEM_DIALOG_ID } from '../dialogs/saveProblem.js';
import { reportProblem } from './documentCommands.js';
import type { OpenedDocument } from './importMarkdown.js';

/**
 * Says, as a document a person opened appears, that its file cannot be saved over — read-only, or held by another
 * program — and offers a copy to work on (cloud-4 7b). Said before any edit, because the first Save is too late: by
 * then there are changes with nowhere to go.
 *
 * ## The copy OPENS, because Save a copy alone would not help here
 *
 * *Save a copy…* writes the document as it is and leaves it where it was, by design. Pressed at open, that would copy
 * the unchanged file while the person went on editing the one that cannot be saved. So the offer writes the copy and
 * opens it, and the edits made from there have a file to go to. The original stays open as it was; closing it is the
 * person's.
 *
 * ## Asked of the file, never decided from it
 *
 * Main answers what the file is now; nothing is kept. A save still tries the file itself, so a person who clears the
 * read-only box saves as usual.
 */
export async function sayWhenUnwritable(
  deps: {
    readonly client: ContractClient;
    readonly ask: (id: string, props: unknown) => Promise<unknown>;
    /** The copy, opened as a tab — the same callback every open takes. */
    readonly onOpened: (opened: OpenedDocument) => void;
  },
  docId: DocId,
): Promise<void> {
  const answer = await deps.client['document.fileAccess']({ docId });
  if (!answer.ok) {
    // CLOSED BEFORE THE ANSWER CAME, which says nothing about its file and needs no sentence.
    if (answer.error.code !== 'document-not-open') reportProblem(deps, answer.error);
    return;
  }
  const { access } = answer.value;
  // `writable` needs no sentence, and `absent` is the next save's to say, which names it.
  if (access !== 'read-only' && access !== 'held') return;

  // A DISMISSAL ANSWERS NOTHING the schema accepts, and keeps reading this file (ADR-0038).
  const chosen = READ_ONLY_FILE_RESULT.safeParse(await deps.ask(READ_ONLY_FILE_DIALOG_ID, { access }));
  if (!chosen.success) return;

  const copied = await deps.client['document.workOnCopy']({ docId });
  if (!copied.ok) {
    reportProblem(deps, copied.error);
    return;
  }
  const outcome = copied.value;
  switch (outcome.kind) {
    case 'opened':
      deps.onOpened({ docId: outcome.docId, version: outcome.version, byteLength: outcome.byteLength, name: outcome.name });
      return;
    // A person changing their mind.
    case 'cancelled':
      return;
    // THE COPY WAS NOT WRITTEN, said as Save a copy says it.
    case 'destination-contested':
      void deps.ask(SAVE_PROBLEM_DIALOG_ID, { outcome: 'contested' });
      return;
    case 'write-failed':
      void deps.ask(SAVE_PROBLEM_DIALOG_ID, { outcome: 'write-failed' });
      return;
    // WRITTEN AND NOT OPENED, said as any open says it: the copy is where the person put it.
    case 'absent':
    case 'at-capacity':
    case 'busy':
    case 'denied':
      void deps.ask(OPEN_PROBLEM_DIALOG_ID, { reason: outcome.kind });
      return;
  }
}
