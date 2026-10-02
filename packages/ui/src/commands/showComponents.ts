import type { ContractClient } from '@monstera/contract';

import { COMPONENTS_DIALOG_ID, COMPONENTS_RESULT } from '../dialogs/components.js';
import { COMPONENTS_COMMAND_TITLE, GROUP_APPLICATION } from '../messages/en.js';
import { type UiCommand, VISIBLE } from '../registries/commands.js';

/**
 * Opens Components: the native components this build runs, and whether their files match the manifest
 * ([ADR-0122](../../../../docs/DECISIONS/0122-native-components-one-resolver-a-pinned-manifest-status-and-verify.md)).
 *
 * ## The command fetches, and the dialog displays
 *
 * `app.components` is asked here, as About asks `app.info`, because the open call is where props are validated
 * (ADR-0029 Decision 7). The first look is `verify: false` — whether each file is present, which costs a `stat` —
 * because hashing some hundreds of megabytes is the second question, and a person asks it by choosing *Verify files*.
 *
 * ## Verify reopens the dialog with main's new answer
 *
 * The dialog answers `'verify'` and makes no call (ADR-0038); this command asks main to hash and opens the dialog
 * again with the result. It loops until the answer is a dismissal, so *Verify files* can be chosen again.
 *
 * ## A failure opens nothing
 *
 * The channel declares no failures, so a `!ok` is `internal` and recorded main-side — a manifest that does not parse
 * is one, deliberately, because showing a damaged package's components as merely absent is the reassuring answer to
 * the question Verify asks.
 */
export function showComponentsCommand(deps: {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
}): UiCommand {
  return {
    id: 'app.components',
    feedback: VISIBLE,
    icon: 'ClipboardCheck',
    title: COMPONENTS_COMMAND_TITLE,
    placements: [
      { surface: 'ribbon', section: 'tools', group: GROUP_APPLICATION, order: 915, prominence: 'secondary' },
      { surface: 'menu-bar', menu: 'help', group: 2, order: 25 },
    ],
    run: async (): Promise<void> => {
      let verify = false;
      for (;;) {
        const answer = await deps.client['app.components']({ verify });
        if (!answer.ok) return;
        const chosen = COMPONENTS_RESULT.safeParse(
          await deps.ask(COMPONENTS_DIALOG_ID, { components: answer.value.components, verified: verify }),
        );
        // A DISMISSAL ANSWERS NOTHING the schema accepts, and ends the loop (ADR-0038).
        if (!chosen.success) return;
        verify = true;
      }
    },
  };
}
