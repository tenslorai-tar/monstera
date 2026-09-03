import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';

import { OPEN_DOCUMENT_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';

/**
 * The first registered command with a working `run`.
 *
 * ## Why it is a factory and not a constant
 *
 * `run` takes a `CommandContext`, and a context carries what the *focused
 * document* is — not how to reach main. The client is composition, so the
 * command is built where the client exists and captures it. A module-level
 * constant would need a client from a global, which is the second wiring place
 * the registry exists to forbid.
 *
 * ## What crosses is nothing
 *
 * `document.open` takes no parameters. Main owns the picker, mints the
 * `FileHandle` and answers with a `DocId` — the renderer cannot express which
 * file it wants, which is why it cannot express the wrong one (§2, invariant
 * L5). This command is that sentence with a button on it.
 */
/**
 * An open that ended with no document and something to say about it.
 *
 * The channel's own variant names rather than a message: what to show is the
 * surface's decision and the strings are i18n keys, so a command producing a
 * sentence here would put user-facing text in the layer that dispatches.
 */
export type OpenProblem = 'absent' | 'at-capacity';

export function openDocumentCommand(deps: {
  readonly client: ContractClient;
  /**
   * Called with the document that was opened, and with nothing for every other
   * outcome.
   *
   * `cancelled`, `absent` and `at-capacity` are outcomes rather than failures —
   * a user dismissing a picker is not an error — and none is a case this
   * callback can act on.
   *
   * **`already-open` moved to {@link onAlreadyOpen} when tabs landed.** This
   * paragraph used to end *"there is nothing to hand over and the right
   * response is to focus what is already there"*, which was true and had
   * nowhere to send anybody: with one document on screen there was no *there*.
   * The sentence describing the right response outlived the reason it could
   * not be taken.
   */
  readonly onOpened: (opened: {
    readonly docId: DocId;
    readonly version: DocVersion;
    readonly byteLength: number;
    readonly name: string;
  }) => void;
  /**
   * Called when the open did not produce a document and the user should be
   * told.
   *
   * **`absent` and `at-capacity` only.** `cancelled` is a person changing their
   * mind and needs no message; `already-open` is the document they asked for,
   * on screen. Reporting those two would put an error in front of somebody who
   * got what they wanted.
   *
   * This existed as nothing at all until 2026-09-03: every non-`opened` outcome
   * returned silently, so picking a file that had been moved produced **no
   * feedback of any kind** — a control that appears to do nothing, which is the
   * defect the wired-tools rule is about wearing a successful dispatch.
   */
  readonly onProblem: (problem: OpenProblem) => void;
  /**
   * Called when the picked file is a document this build already holds.
   *
   * A `DocId` and nothing else, because that is all the outcome carries — and
   * all that is needed: the renderer has a tab for that document with its own
   * version, page and zoom, and bringing it forward is the whole response.
   */
  readonly onAlreadyOpen: (docId: DocId) => void;
}): UiCommand {
  return {
    id: 'document.open',
    title: OPEN_DOCUMENT_TITLE,
    // The chord is a property of the command, not an entry in a keymap — the
    // shortcut map is a projection of this registry, so declaring it here is the
    // whole of registering it. `Ctrl+O` because that is what every application
    // this one replaces uses for the same thing.
    shortcut: 'Ctrl+O',
    // ONE PLACEMENT, and the second reader of this command is the TAB STRIP.
    //
    // `quick-toolbar` was tried and reverted in the same session: this command
    // declares no `when` — it is how a reader finds *Open* and must never be
    // absent — so placing it there put it on screen with no document open,
    // which is the one state `QuickToolbar`'s own header says it renders
    // nothing in. The start screen would then have carried two Open buttons.
    //
    // So the strip takes this command's `run` rather than a placement: one
    // implementation with two triggers, which is not a second wiring place —
    // there is still exactly one thing that opens a document.
    placements: [{ surface: 'start-screen', order: 0 }],
    run: async (): Promise<void> => {
      const answer = await deps.client['document.open']({});
      // A failure here is `internal` — the channel declares no codes, because
      // every way this ends that a user can cause is a variant of the result.
      if (!answer.ok) return;
      if (answer.value.kind === 'absent' || answer.value.kind === 'at-capacity') {
        deps.onProblem(answer.value.kind);
        return;
      }
      // THE READER PICKED A FILE THEY ALREADY HAVE OPEN, and with tabs there
      // is now somewhere to send them. `already-open` carries only a `docId`
      // by design (ADR-0009 §2) — no version, no byte length, nothing to
      // render from — and that is exactly enough to activate the tab whose
      // state the renderer is already holding.
      //
      // It is not a problem and must not be reported as one: the reader asked
      // for a document and the document is on screen.
      if (answer.value.kind === 'already-open') {
        deps.onAlreadyOpen(answer.value.docId);
        return;
      }
      if (answer.value.kind !== 'opened') return;
      deps.onOpened({
        docId: answer.value.docId,
        version: answer.value.version,
        byteLength: answer.value.byteLength,
        // CARRIED, not derived. There is no path here to derive it from, which
        // is invariant L2 doing its job rather than a gap: main states the name
        // because main is the only side that can.
        name: answer.value.name,
      });
    },
  };
}
