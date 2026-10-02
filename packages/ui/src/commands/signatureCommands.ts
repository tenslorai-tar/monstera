import type { AnnotationRect } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';

import { SIGNATURE_TOOL_ID } from '../annotations/signatureTool.js';
import { HISTORY_TRIMMED_DIALOG_ID } from '../dialogs/historyTrimmed.js';
import { SIGNATURE_ANSWERS, SIGNATURE_DIALOG_ID, type SignatureLook } from '../dialogs/signature.js';
import { SIGNATURE_PROBLEM_DIALOG_ID } from '../dialogs/signatureProblem.js';
import { GROUP_QUICK_TOOLS, GROUP_STAMPS, SIGNATURE_TITLE, TOAST_SIGNATURE_LIBRARY_FULL, TOAST_SIGNATURE_NOT_KEEPABLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import { confirmDone } from './confirmWritten.js';
import { type DocumentCommandDeps, type WritesAFile, hasDocument, reportProblem } from './documentCommands.js';
import { BLOB_URLS, type LibraryPageDeps, keptEntries } from './stampLibrary.js';

/**
 * The plain Signature, the renderer's half ([ADR-0133](../../../../docs/DECISIONS/0133-a-signatures-mark-is-drawn-once-for-both-writers.md)).
 *
 * The flow is the owner's: the Signature dialog chooses a look, then a click on the page places it, then the select
 * tool holds it so it can be moved and resized. This module is the dialog's loop, the placement and its outcomes, and
 * the command the ribbon draws; App holds the look between the dialog and the click.
 */

/**
 * Asks the Signature dialog until it answers a look, or is dismissed.
 *
 * **The signature library is read each time the dialog opens**, through `keptEntries`, the one reader both libraries'
 * choosers take (B3a) — so it is the library *Sign with certificate* offers, shown the same way. Removing a kept one
 * is an answer: the opener removes it and asks again, because a dialog's props are fixed while it is open.
 */
export async function chooseSignature(
  deps: Pick<DocumentCommandDeps, 'ask' | 'client'>,
  urls: LibraryPageDeps['urls'] = BLOB_URLS,
): Promise<SignatureLook | undefined> {
  const library: LibraryPageDeps = { client: deps.client, ask: deps.ask, urls };
  for (;;) {
    const { kept, release } = await keptEntries(library, 'signature');
    let answered: unknown;
    try {
      answered = await deps.ask(SIGNATURE_DIALOG_ID, { kept });
    } finally {
      release();
    }
    const parsed = SIGNATURE_ANSWERS.safeParse(answered);
    // DISMISSED, or an answer of another shape — a registration defect rather than a person's doing — places nothing.
    if (!parsed.success) return undefined;
    if ('mark' in parsed.data) return parsed.data;
    await deps.client['library.remove']({ id: parsed.data.id });
  }
}

/**
 * Places a chosen look where the person clicked, and says what came of keeping it.
 *
 * @returns the version the placement produced, so the caller can select the new mark at it; `undefined` when nothing
 *   was placed
 */
export async function placePlainSignature(
  deps: Pick<DocumentCommandDeps, 'ask' | 'client' | 'onApplied' | 'stamp'> & WritesAFile,
  docId: DocId,
  page: number,
  rect: AnnotationRect,
  look: SignatureLook,
): Promise<DocVersion | undefined> {
  const answer = await deps.client['document.placeSignature']({
    docId,
    page,
    rect,
    mark: look.mark,
    keep: look.keep,
    stamp: deps.stamp(),
  });
  if (!answer.ok) {
    reportProblem(deps, answer.error);
    return undefined;
  }
  const outcome = answer.value;
  if (outcome.kind === 'cancelled') return undefined;
  if (outcome.kind !== 'placed') {
    // VOIDED for `reportProblem`'s reason: an informational dialog settles only on dismissal.
    void deps.ask(
      SIGNATURE_PROBLEM_DIALOG_ID,
      outcome.kind === 'too-large' ? { reason: 'too-large', limitBytes: outcome.limitBytes } : { reason: outcome.kind },
    );
    return undefined;
  }
  deps.onApplied({ version: outcome.version, byteLength: outcome.byteLength });
  if (outcome.historyDropped > 0) void deps.ask(HISTORY_TRIMMED_DIALOG_ID, { dropped: outcome.historyDropped });
  // THE PAGE SHOWS THE MARK, so a placement confirms through neither path — except what the page cannot show: a keep
  // the person asked for that did not happen.
  if (outcome.kept === 'library-full') confirmDone(deps, TOAST_SIGNATURE_LIBRARY_FULL);
  if (outcome.kept === 'not-keepable') confirmDone(deps, TOAST_SIGNATURE_NOT_KEEPABLE);
  return outcome.version;
}

/** What the Signature command needs: the tool's state, and where a chosen look goes. */
export interface SignatureCommandDeps {
  /** The tool active now, read through a function for `toolCommand`'s reason. */
  readonly activeTool: () => string | undefined;
  /** Runs the dialog and arms the click with the look it answers; App owns the look between the two. */
  readonly onStart: () => void;
  /** Leaves the tool, when the command is pressed while it is armed. */
  readonly onStop: () => void;
}

/**
 * The Signature command: Home › Quick tools and Comment › Stamps (the owner, 2 October).
 *
 * **Pressing it opens the dialog first**, then arms the click — the owner's order. It is the tool's command, so every
 * surface draws it pressed while the click is armed, and pressing it again then leaves the tool, as every tool's
 * command does. The id is the tool's, `toolCommand`'s rule: the two registries are joined by this value.
 */
export function signatureCommand(deps: SignatureCommandDeps): UiCommand {
  return {
    id: SIGNATURE_TOOL_ID,
    title: SIGNATURE_TITLE,
    icon: 'Signature',
    placements: [
      // HOME'S QUICK TOOLS AT 108, the slot *Sign with certificate* held until this existed; it is under Protect only now.
      { surface: 'ribbon', section: 'home', group: GROUP_QUICK_TOOLS, order: 108 },
      // BESIDE THE STAMPS, between Stamp (50) and Image (52): a signature is placed as they are, and moved as they are.
      { surface: 'ribbon', section: 'comment', group: GROUP_STAMPS, order: 51 },
    ],
    when: hasDocument,
    checked: () => deps.activeTool() === SIGNATURE_TOOL_ID,
    run: (): void => {
      if (deps.activeTool() === SIGNATURE_TOOL_ID) deps.onStop();
      else deps.onStart();
    },
  };
}
