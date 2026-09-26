import type { ChannelResult } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import { OPEN_FROM_URL_DIALOG_ID, OPEN_FROM_URL_RESULT } from '../dialogs/openFromUrl.js';
import { URL_OPEN_PROBLEM_DIALOG_ID, type UrlOpenProblem } from '../dialogs/urlOpenProblem.js';
import { GROUP_CREATE, OPEN_FROM_URL_COMMAND_TITLE, RIBBON_OPEN_FROM_URL } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import { type DocumentCommandDeps, reportProblem } from './documentCommands.js';
import type { OpenedDocument } from './importMarkdown.js';

/**
 * D9's *Open from URL*: a PDF fetched through main's SSRF guard, saved where the person
 * chooses, and opened as a tab
 * ([ADR-0061](../../../../docs/DECISIONS/0061-a-url-a-person-chose-is-fetched-through-one-guard-that-pins-every-resolution.md)).
 *
 * ## IT SENDS THE ADDRESS AND NOTHING ELSE
 *
 * The dialog collects the text; main judges it, runs the save dialog, fetches, writes and
 * opens. What returns is outcomes, so no byte of what the website sent reaches here.
 */

/**
 * What the person is told for an answer that produced no document, or `null` for the
 * answers that need no sentence.
 */
export function urlOpenProblem(answer: ChannelResult<'document.openFromUrl'>): UrlOpenProblem | null {
  switch (answer.kind) {
    case 'url-refused':
      return { reason: answer.reason };
    case 'destination-contested':
      return { reason: 'destination-contested', openElsewhere: answer.openElsewhere };
    case 'write-failed':
      return { reason: 'write-failed' };
    case 'absent':
      return { reason: 'absent' };
    case 'at-capacity':
      return { reason: 'at-capacity' };
    // `cancelled` is a person changing their mind; `opened` and `already-open` are the
    // document they asked for. Named rather than defaulted, `markdownImportProblem`'s rule.
    case 'cancelled':
    case 'opened':
    case 'already-open':
      return null;
  }
}

/**
 * A PDF from a web address, opened as a tab.
 *
 * Needs no document, so it declares no `when`: opening is a way to START with one.
 */
export function openFromUrlCommand(deps: {
  readonly client: DocumentCommandDeps['client'];
  readonly ask: DocumentCommandDeps['ask'];
  readonly onOpened: (opened: OpenedDocument) => void;
  readonly onAlreadyOpen: (docId: DocId) => void;
}): UiCommand {
  return {
    id: 'document.open-from-url',
    icon: 'Globe',
    title: OPEN_FROM_URL_COMMAND_TITLE,
    ribbonTitle: RIBBON_OPEN_FROM_URL,
    placements: [
      { surface: 'ribbon', section: 'tools', group: GROUP_CREATE, order: 50 },
      { surface: 'menu-bar', menu: 'file', group: 0, order: 20 },
    ],
    run: async (): Promise<void> => {
      // A DISMISSAL ANSWERS NOTHING the schema accepts, so it sends nothing (ADR-0038).
      const typed = OPEN_FROM_URL_RESULT.safeParse(await deps.ask(OPEN_FROM_URL_DIALOG_ID, {}));
      if (!typed.success) return;

      const answer = await deps.client['document.openFromUrl']({ url: typed.data.text });
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      const result = answer.value;
      if (result.kind === 'opened') {
        deps.onOpened({
          docId: result.docId,
          version: result.version,
          byteLength: result.byteLength,
          name: result.name,
        });
        return;
      }
      if (result.kind === 'already-open') {
        deps.onAlreadyOpen(result.docId);
        return;
      }
      const problem = urlOpenProblem(result);
      if (problem !== null) void deps.ask(URL_OPEN_PROBLEM_DIALOG_ID, problem);
    },
  };
}
