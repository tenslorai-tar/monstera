import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { HELP_DIALOG_ID } from '../dialogs/help.js';
import { ROTATE_PAGE_TITLE } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import { START_SCREEN_CONTEXT, helpCommand } from './help.js';

/**
 * The Help centre's command (ADR-0112 Decision 3): WHERE it opens, read from the shell when F1 is pressed, and what it
 * does with *Show me*. The body's half is `HelpBody.test.tsx`'; the ring is `App.test.tsx`'.
 */

const inDocument: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

const onStart: CommandContext = { ...inDocument, docId: undefined, version: undefined, page: undefined, pageCount: undefined };

const SHOWN = [{ id: 'document.rotate-page', title: ROTATE_PAGE_TITLE }] as const;

function harness(state: { tool: string | undefined; section: string }, answer?: unknown) {
  const opened: { id: string; props: unknown }[] = [];
  const shown: [string, CommandContext][] = [];
  const command = helpCommand({
    ask: (id, props) => {
      opened.push({ id, props });
      return Promise.resolve(answer);
    },
    tool: () => state.tool,
    section: () => state.section,
    shown: () => SHOWN,
    showMe: (id, context) => shown.push([id, context]),
  });
  return { command, opened, shown };
}

describe('the Help centre command', () => {
  it('is F1', () => {
    expect(harness({ tool: undefined, section: 'home' }).command.shortcut).toBe('F1');
  });

  it('with a tool in use, opens on the article that teaches it, in the section on show', async () => {
    const { command, opened } = harness({ tool: 'document.rotate-page', section: 'organize' });
    await command.run(inDocument);
    expect(opened).toStrictEqual([
      { id: HELP_DIALOG_ID, props: { article: 'rotate-pages', context: 'organize', showable: [...SHOWN] } },
    ]);
  });

  it('reads WHERE when it runs, not when it was made', async () => {
    const state = { tool: undefined as string | undefined, section: 'home' };
    const { command, opened } = harness(state);
    // CHANGED AFTER THE COMMAND WAS MADE, the shell's situation: the registry is built once, F1 is pressed later.
    state.section = 'protect';
    await command.run(inDocument);
    expect(opened[0]?.props).toMatchObject({ article: null, context: 'protect' });
  });

  it('on the start screen, the start screen’s list and no *Show me* — there is no ribbon to ring', async () => {
    // A TOOL IS SET, and still ignored: with no document nothing is in use, and a stale tool must not pick the article.
    const { command, opened } = harness({ tool: 'document.rotate-page', section: 'organize' });
    await command.run(onStart);
    expect(opened[0]?.props).toStrictEqual({ article: null, context: START_SCREEN_CONTEXT, showable: [] });
  });

  it('hands *Show me*’s command to the shell with the context it ran in, and nothing for a dismissal', async () => {
    const chosen = harness({ tool: undefined, section: 'home' }, { kind: 'show', command: 'document.rotate-page' });
    await chosen.command.run(inDocument);
    expect(chosen.shown).toStrictEqual([['document.rotate-page', inDocument]]);

    const dismissed = harness({ tool: undefined, section: 'home' }, undefined);
    await dismissed.command.run(inDocument);
    expect(dismissed.shown).toStrictEqual([]);
  });
});
