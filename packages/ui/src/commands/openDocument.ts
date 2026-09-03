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
export function openDocumentCommand(deps: {
  readonly client: ContractClient;
  /**
   * Called with the document that was opened, and with nothing for every other
   * outcome.
   *
   * `cancelled`, `absent` and `at-capacity` are outcomes rather than failures —
   * a user dismissing a picker is not an error — and `already-open` carries no
   * state by design (ADR-0009 §2), so there is nothing to hand over and the
   * right response is to focus what is already there. None of those is a case
   * this command can act on, which is why the callback is not told about them.
   */
  readonly onOpened: (opened: {
    readonly docId: DocId;
    readonly version: DocVersion;
    readonly byteLength: number;
    readonly name: string;
  }) => void;
}): UiCommand {
  return {
    id: 'document.open',
    title: OPEN_DOCUMENT_TITLE,
    // The chord is a property of the command, not an entry in a keymap — the
    // shortcut map is a projection of this registry, so declaring it here is the
    // whole of registering it. `Ctrl+O` because that is what every application
    // this one replaces uses for the same thing.
    shortcut: 'Ctrl+O',
    placements: [{ surface: 'start-screen', order: 0 }],
    run: async (): Promise<void> => {
      const answer = await deps.client['document.open']({});
      // A failure here is `internal` — the channel declares no codes, because
      // every way this ends that a user can cause is a variant of the result.
      if (!answer.ok) return;
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
