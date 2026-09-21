import { MAX_ASK_SELECTION } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { AnnotationSelection } from '../annotations/selectTool.js';
import type { AskAssistant } from '../assistantRequest.js';
import {
  ASSISTANT_PROMPT_DRAFT_REPLY,
  ASSISTANT_PROMPT_EXPLAIN,
  ASSISTANT_PROMPT_SUMMARISE,
  ASSISTANT_PROMPT_TRANSLATE,
} from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import type { TextSelection } from '../TextLayer.js';
import { assistantSelectionCommands, draftReplyCommand } from './assistantCommands.js';

/**
 * The right-click route to the assistant: the UI half — that each item hands the panel exactly
 * the scope and question it names. The panel's cases prove it asks; `documentCommands.test.ts`
 * proves main reads the window and the provider receives it.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000c1');
const CONTEXT = { docId: DOC } as CommandContext;
const SELECTED: TextSelection = { page: 4, text: 'the indemnity clause', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } };

function recording(): { ask: AskAssistant; asked: unknown[][] } {
  const asked: unknown[][] = [];
  return { asked, ask: (...args) => asked.push(args) };
}

describe('Ask AI · Explain · Summarise · Translate on selected text', () => {
  it('each names the selected words on their page, and the question that is its own', async () => {
    const { ask, asked } = recording();
    const commands = assistantSelectionCommands({ selection: () => SELECTED, ask });

    for (const command of commands) await command.run(CONTEXT);

    const about = { scope: 'selection', docId: DOC, page: 4, text: 'the indemnity clause' };
    expect(asked).toStrictEqual([
      [about, undefined],
      [about, ASSISTANT_PROMPT_EXPLAIN],
      [about, ASSISTANT_PROMPT_SUMMARISE],
      [about, ASSISTANT_PROMPT_TRANSLATE],
    ]);
  });

  it('sits in the selected-text menu after its own seven, in the owner’s order', () => {
    const commands = assistantSelectionCommands({ selection: () => SELECTED, ask: recording().ask });
    expect(commands.map((command) => [command.id, command.placements[0]])).toStrictEqual([
      ['ai.ask-selection', { surface: 'context-menu', context: 'selection', order: 80 }],
      ['ai.explain-selection', { surface: 'context-menu', context: 'selection', order: 90 }],
      ['ai.summarise-selection', { surface: 'context-menu', context: 'selection', order: 100 }],
      ['ai.translate-selection', { surface: 'context-menu', context: 'selection', order: 110 }],
    ]);
  });

  it('CONTROL: with nothing selected every item is hidden and asks nothing', async () => {
    const { ask, asked } = recording();
    const commands = assistantSelectionCommands({ selection: () => undefined, ask });
    expect(commands.map((command) => command.when?.(CONTEXT))).toStrictEqual([false, false, false, false]);
    for (const command of commands) await command.run(CONTEXT);
    expect(asked).toStrictEqual([]);
  });

  it('cuts a long selection to the channel’s bound rather than having it refused there', async () => {
    const { ask, asked } = recording();
    const long = { ...SELECTED, text: 'w'.repeat(MAX_ASK_SELECTION + 50) };
    await assistantSelectionCommands({ selection: () => long, ask })[1]?.run(CONTEXT);
    expect((asked[0]?.[0] as { text: string }).text).toHaveLength(MAX_ASK_SELECTION);
  });
});

describe('Draft a reply with AI', () => {
  const note = (contents: string, items = 1): AnnotationSelection => ({
    page: 2,
    version: asDocVersion(7),
    items: Array.from({ length: items }, (_unused, at) => ({
      index: 5 + at,
      rect: { x0: 0, y0: 0, x1: 20, y1: 20 },
      style: { colour: null, fill: null, opacity: 1, width: 1 },
      kind: 'text',
      contents,
    })) as unknown as AnnotationSelection['items'],
  });

  it('asks about the note’s words, and carries the note it may be posted to', async () => {
    const { ask, asked } = recording();
    await draftReplyCommand({ selection: () => note('  Can we move the date?  '), ask }).run(CONTEXT);

    expect(asked).toStrictEqual([
      [
        // A COMMENT scope: the instruction must not call a note "text the person selected".
        { scope: 'comment', docId: DOC, page: 2, text: 'Can we move the date?' },
        ASSISTANT_PROMPT_DRAFT_REPLY,
        { page: 2, index: 5, version: asDocVersion(7) },
      ],
    ]);
  });

  it('CONTROL: a mark with nothing written in it, or two marks, offers no draft', () => {
    const { ask } = recording();
    expect(draftReplyCommand({ selection: () => note('   '), ask }).when?.(CONTEXT)).toBe(false);
    expect(draftReplyCommand({ selection: () => note('two', 2), ask }).when?.(CONTEXT)).toBe(false);
    expect(draftReplyCommand({ selection: () => note('one'), ask }).when?.(CONTEXT)).toBe(true);
  });
});
