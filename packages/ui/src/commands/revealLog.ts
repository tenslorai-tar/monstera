import type { ContractClient } from '@monstera/contract';

import { REVEAL_LOG_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';

/**
 * Shows the diagnostics log in the OS file manager.
 *
 * ## The renderer never learns where the log is
 *
 * `log.reveal` takes nothing and answers a boolean. That is not economy: a
 * filesystem path in a renderer-facing type is a compile error (invariant 2),
 * and the alternative spelling — main answers with a path, the renderer opens
 * it — would need the renderer to hold both a path and a way to act on one.
 *
 * ## A `false` answer opens nothing and says nothing
 *
 * `revealed: false` means there is no log directory, which is the ordinary
 * state of a launch that has had nothing to report. It is not a failure and
 * must not become a dialog: telling a user that nothing has gone wrong, in a
 * box they have to dismiss, is the response that trains people to dismiss
 * boxes.
 *
 * A `!ok` is `internal` — the channel declares no failures — and is recorded
 * main-side. Same response, for a different reason: there is nothing the user
 * can do with it, and the incident is already where it can be read.
 */
export function revealLogCommand(deps: { readonly client: ContractClient }): UiCommand {
  return {
    id: 'log.reveal',
    title: REVEAL_LOG_TITLE,
    // The start screen, because that is where somebody who cannot open their
    // document goes looking. A document-scoped placement would put the
    // diagnostics behind the thing that is failing.
    placements: [{ surface: 'start-screen', order: 2 }],
    run: async (): Promise<void> => {
      await deps.client['log.reveal']({});
    },
  };
}
