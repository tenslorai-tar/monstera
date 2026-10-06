import type { ContractClient } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import type { OpenProblem } from '../dialogs/openProblemReasons.js';
import { OPEN_PROBLEM_DIALOG_ID } from '../dialogs/openProblem.js';
import type { SourceDocument } from '../dialogs/sourceDocuments.js';
import type { CommandContext } from '../registries/commands.js';
import type { DocumentCommandDeps } from './documentCommands.js';

/**
 * The second document a page command copies from, gathered and asked about once for the four that need one — Replace
 * pages, Insert from PDF, Merge and Import page as layer (B3a).
 *
 * ## The page counts are READ, so a dialog can bound a choice of pages
 *
 * An open-document entry carries an id, a version, a byte length and a name. `document.viewModel` answers any open
 * document's page count, so each offered document is read once as its dialog opens. One whose read answers a failure —
 * closed in between, refused, poisoned — is left out of the list rather than offered with a count nobody knows.
 *
 * ## *Choose file…* opens through the ONE open route
 *
 * ADR-0040 Decision 2: there is no transient, hidden open. The file arrives as a tab, exactly as any other document,
 * and the dialog asks again with it chosen and the person's entries restored. The tab of the document being changed
 * stays the one on show, which is `openSource`'s to keep.
 */

/** What `openSource` came back with: a document to copy from, an open that failed and why, or nothing chosen. */
export type SourceOpen =
  | { readonly kind: 'opened'; readonly docId: DocId; readonly name: string }
  | { readonly kind: 'problem'; readonly reason: OpenProblem }
  | { readonly kind: 'none' };

/** What the four commands need beyond a page command's: a way to open a file as a source. */
export interface SourceCommandDeps extends DocumentCommandDeps {
  /**
   * Runs the one open route for a source: main's picker, a tab like any other — and `keep` stays the document on show,
   * since the person is changing it, not the file they picked. A file already open answers as that document.
   */
  readonly openSource: (keep: DocId) => Promise<SourceOpen>;
}

/**
 * One document's page count, or `undefined` when the read answered a declared failure. A rejection is the channel
 * failing and is not caught here: it fails the command as any other channel fault does.
 */
async function pageCountOf(client: ContractClient, docId: DocId): Promise<number | undefined> {
  const read = await client['document.viewModel']({ docId, pages: [0] });
  return read.ok && read.value.pageCount > 0 ? read.value.pageCount : undefined;
}

/** The documents a page can come from: every open document but the target, each with its page count read. */
async function sourcesOf(client: ContractClient, context: CommandContext, target: DocId): Promise<SourceDocument[]> {
  const others = context.openDocuments.filter((document) => document.docId !== target);
  const counts = await Promise.all(others.map((document) => pageCountOf(client, document.docId)));
  return others.flatMap((document, index) => {
    const pageCount = counts[index];
    return pageCount === undefined ? [] : [{ docId: document.docId, name: document.name, pageCount }];
  });
}

/** A dialog's answer, as {@link askAboutSource} reads it: a choose-file request with what to restore, or its own. */
export type SourceAnswer<Answer, Draft> = { readonly kind: 'choose-file'; readonly draft: Draft } | Answer;

/**
 * Asks a second-document dialog until it answers something other than *Choose file…*, and hands that answer back with
 * the documents it was chosen from — or `undefined` when the person dismissed it.
 *
 * @param ask opens the dialog with the documents offered, the one chosen as it opens, and the entries to restore
 * @param read the dialog's own result schema, applied to what it answered; `undefined` for a dismissal
 */
export async function askAboutSource<Answer extends { readonly kind: string }, Draft>(
  deps: SourceCommandDeps,
  context: CommandContext,
  target: DocId,
  ask: (choices: readonly SourceDocument[], source: string | undefined, draft: Draft | undefined) => Promise<unknown>,
  read: (answered: unknown) => SourceAnswer<Answer, Draft> | undefined,
): Promise<{ readonly answer: Answer; readonly choices: readonly SourceDocument[] } | undefined> {
  let choices = await sourcesOf(deps.client, context, target);
  let source: string | undefined;
  let draft: Draft | undefined;
  for (;;) {
    const answer = read(await ask(choices, source, draft));
    if (answer === undefined) return undefined;
    if (!isChooseFile(answer)) return { answer, choices };

    draft = answer.draft;
    const opened = await deps.openSource(target);
    if (opened.kind === 'problem') {
      await deps.ask(OPEN_PROBLEM_DIALOG_ID, { reason: opened.reason });
      continue;
    }
    // THE DOCUMENT BEING CHANGED IS NOT ITS OWN SOURCE: picking its own file brings it forward as already open.
    if (opened.kind === 'none' || opened.docId === target) continue;
    const pageCount = await pageCountOf(deps.client, opened.docId);
    if (pageCount === undefined) continue;
    const picked = { docId: opened.docId, name: opened.name, pageCount };
    choices = [...choices.filter((choice) => choice.docId !== picked.docId), picked];
    source = picked.docId;
  }
}

function isChooseFile<Answer extends { readonly kind: string }, Draft>(
  answer: SourceAnswer<Answer, Draft>,
): answer is { readonly kind: 'choose-file'; readonly draft: Draft } {
  return answer.kind === 'choose-file';
}
