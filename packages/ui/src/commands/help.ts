import type { MessageKey } from '@monstera/shared';

import { HELP_DIALOG_ID, HELP_RESULT } from '../dialogs/help.js';
import { helpFor } from '../help/articles.js';
import { GROUP_APPLICATION, HELP_COMMAND_TITLE } from '../messages/en.js';
import { type CommandContext, type UiCommand, VISIBLE } from '../registries/commands.js';

/** Where F1 was pressed from with no document: the start screen's own articles. */
export const START_SCREEN_CONTEXT = 'start-screen';

/**
 * Opens the Help centre on one article, from a dialog that pointed a person at it (the OCR dialog's *How to get a
 * key*). No *Show me*: the caller does not hold the registry, and a *Show me* that rang nothing would be the
 * display-only defect — the article's steps still say where each control is.
 */
export function openHelpArticle(ask: (id: string, props: unknown) => Promise<unknown>, article: string): Promise<unknown> {
  return ask(HELP_DIALOG_ID, { article, context: null, showable: [] });
}

/**
 * Opens the Help centre on the article for where the person is
 * ([ADR-0112](../../../../docs/DECISIONS/0112-the-help-centre-is-bundled-articles-and-f1-opens-the-one-for-where-you-are.md)
 * Decision 3): with a tool in use, the article that teaches it; otherwise the list, with the articles for the rail
 * section on show — or, with no document, the start screen's — first.
 *
 * ## Where the person is comes from the shell, when it RUNS
 *
 * The tool in use and the section on show are the shell's state, read through functions at the moment F1 is pressed;
 * a value captured when the registry was built would be the tool of whoever built it.
 *
 * ## *Show me* is answered here, and rung by the shell
 *
 * The dialog answers with a command; this hands it to `showMe`, which brings the control's section to the front and
 * rings it. `shown` names the commands that have such a control in this context, so the dialog offers nothing it
 * cannot ring. With no document there is no ribbon, so the start screen offers none.
 */
export function helpCommand(deps: {
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  readonly tool: () => string | undefined;
  readonly section: () => string;
  readonly shown: (context: CommandContext) => readonly { readonly id: string; readonly title: MessageKey }[];
  readonly showMe: (command: string, context: CommandContext) => void;
}): UiCommand {
  return {
    id: 'app.help',
    feedback: VISIBLE,
    icon: 'CircleHelp',
    title: HELP_COMMAND_TITLE,
    shortcut: 'F1',
    placements: [
      // THIRD in the footer, v5-01's order: Settings · About · Help centre.
      { surface: 'start-screen', slot: 'footer', order: 3 },
      { surface: 'menu-bar', menu: 'help', group: 0, order: 5 },
      // SECONDARY in Tools › Application, beside the keyboard shortcuts: F1 and the menu bar are the ways in.
      { surface: 'ribbon', section: 'tools', group: GROUP_APPLICATION, order: 925, prominence: 'secondary', size: 'small' },
    ],
    run: async (context): Promise<void> => {
      const onStart = context.docId === undefined;
      const where = onStart ? START_SCREEN_CONTEXT : deps.section();
      const { article } = helpFor({ tool: onStart ? undefined : deps.tool(), context: where });
      const answer = await deps.ask(HELP_DIALOG_ID, {
        article: article?.id ?? null,
        context: where,
        showable: onStart ? [] : deps.shown(context).map((each) => ({ id: each.id, title: each.title })),
      });
      const shown = HELP_RESULT.safeParse(answer);
      if (shown.success) deps.showMe(shown.data.command, context);
    },
  };
}
