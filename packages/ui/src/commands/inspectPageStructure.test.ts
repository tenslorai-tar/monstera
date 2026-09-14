import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { PAGE_STRUCTURE_DIALOG_ID } from '../dialogs/pageStructure.js';
import { GROUP_ACCESSIBILITY } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import { inspectPageStructureCommand } from './inspectPageStructure.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000ee');

/** A context with a document focused and a page on screen — or none. */
function contextOn(page: number | undefined): CommandContext {
  return {
    docId: DOC,
    version: asDocVersion(1),
    hasSelection: false,
    dirty: false,
    page,
    pageCount: 5,
  } as CommandContext;
}

/** Two elements with different names and depths, and every count distinct. */
const NODES = [
  { role: 'H1', raw: 'Heading1', depth: 0, lines: 1 },
  { role: 'P', raw: 'Body', depth: 1, lines: 3 },
];

/**
 * A client answering `document.pageStructure`, recording what it was asked.
 *
 * The request is recorded AFTER the contract client's own validation, so a case
 * asserting on it asserts what actually crossed.
 */
function clientAnswering(outcome: 'read' | 'refused'): {
  client: ContractClient;
  asked: unknown[];
} {
  const asked: unknown[] = [];
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.pageStructure') throw new Error(`unexpected channel ${id}`);
    asked.push(params);
    return Promise.resolve(
      outcome === 'read'
        ? ok({ version: asDocVersion(1), nodes: NODES, truncated: true, untaggedLines: 2, images: 4 })
        : err({ code: 'document-busy' }),
    );
  });
  return { client, asked };
}

function recordingAsk(): {
  ask: (id: string, props: unknown) => Promise<unknown>;
  opened: unknown[];
} {
  const opened: unknown[] = [];
  return {
    ask: (id, props) => {
      opened.push({ id, props });
      return Promise.resolve(undefined);
    },
    opened,
  };
}

describe('the reading-order command', () => {
  it('asks for the page ON SCREEN by its index, and shows it by the number a person reads', async () => {
    const { client, asked } = clientAnswering('read');
    const { ask, opened } = recordingAsk();

    await inspectPageStructureCommand({ client, ask }).run(contextOn(2));

    // BOTH NUMBERS IN ONE CASE, which is the wired pair's blind spot closed where
    // it opens: the request carries the kernel's zero-based index and the dialog
    // carries the printed page. A command that sent the printed number would read
    // the page AFTER the one on screen, and each half alone would stay green.
    expect(asked).toStrictEqual([{ docId: DOC, page: 2 }]);
    expect(opened).toStrictEqual([
      {
        id: PAGE_STRUCTURE_DIALOG_ID,
        props: { kind: 'read', page: 3, nodes: NODES, truncated: true, untaggedLines: 2, images: 4 },
      },
    ]);
  });

  it('a refusal still opens the dialog, saying which page could not be read', async () => {
    const { client } = clientAnswering('refused');
    const { ask, opened } = recordingAsk();

    await inspectPageStructureCommand({ client, ask }).run(contextOn(0));

    expect(opened).toStrictEqual([
      { id: PAGE_STRUCTURE_DIALOG_ID, props: { kind: 'refused', page: 1 } },
    ]);
  });

  it('asks nothing and opens nothing with no page on screen', async () => {
    const { client, asked } = clientAnswering('read');
    const { ask, opened } = recordingAsk();

    await inspectPageStructureCommand({ client, ask }).run(contextOn(undefined));

    expect(asked).toStrictEqual([]);
    expect(opened).toStrictEqual([]);
  });

  it('sits in Review, in the Accessibility group', () => {
    const { client } = clientAnswering('read');
    const { ask } = recordingAsk();
    expect(inspectPageStructureCommand({ client, ask }).placements).toStrictEqual([
      { surface: 'ribbon', section: 'review', group: GROUP_ACCESSIBILITY, order: 10 },
    ]);
  });
});
