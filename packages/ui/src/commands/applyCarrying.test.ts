import { type DispatchableCommand, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { AnnotationSelection } from '../annotations/selectTool.js';
import { applyCarrying } from './applyCarrying.js';
import type { Applied } from './documentCommands.js';

/**
 * The seam between the Properties tab and the engine (ADR-0102): the command goes out, the walk is
 * read back at the version it produced, and the version and the carried selection land together.
 *
 * The client is the real one over a fake transport, so every answer passes the contract's schemas.
 * What the cases assert is the ORDER of calls and what each carried, because a carry that ran before
 * the read — or a read that never happened — would leave the same end state for a moment and a
 * different one a round trip later.
 */

const DOC = asDocId('00000000-0000-4000-8000-000000000001');
const BEFORE = asDocVersion(7);
const AFTER = asDocVersion(8);
const BOX = { x0: 10, y0: 10, x1: 20, y1: 20 };

const PICKED: AnnotationSelection = {
  page: 1,
  version: BEFORE,
  items: [
    {
      index: 0,
      rect: BOX,
      kind: 'square',
      contents: '',
      author: 'Priya Raman',
      created: '2026-09-24T09:38:00.000Z',
      blend: 'normal',
      style: { colour: [1, 0, 0], opacity: 1, borderWidth: 2 },
    },
  ],
};

const RESTYLE: DispatchableCommand = {
  kind: 'styleAnnotation',
  page: 1,
  indices: [0],
  colour: [0, 0, 1],
  version: BEFORE,
};

function walkAt(version: typeof AFTER): unknown {
  return {
    version,
    annotations: [
      {
        page: 1,
        index: 0,
        rect: BOX,
        style: { colour: [0, 0, 1], opacity: 1, borderWidth: 2 },
        kind: 'square',
        contents: '',
        authored: true,
        inReplyTo: null,
        author: 'Priya Raman',
        created: '2026-09-24T09:38:00.000Z',
        blend: 'normal',
      },
    ],
    truncated: false,
  };
}

interface Run {
  readonly calls: string[];
  readonly applied: Applied[];
  selection: AnnotationSelection | undefined;
}

async function run(command: DispatchableCommand, walk: unknown): Promise<Run> {
  const record: Run = { calls: [], applied: [], selection: PICKED };
  const client = createClient(channels, (id) => {
    record.calls.push(id);
    if (id === 'document.execute') return Promise.resolve(ok({ version: AFTER, byteLength: 2048, historyDropped: 0 }));
    if (id === 'document.annotations') {
      return Promise.resolve(walk === undefined ? err({ code: 'document-busy' }) : ok(walk));
    }
    throw new Error(`this fixture has no answer for ${id}`);
  });
  await applyCarrying(
    {
      client,
      ask: () => Promise.resolve(undefined),
      stamp: () => ({ author: 'A. Tester', created: '2026-09-24T09:38:00.000Z' }),
      onApplied: (answer) => {
        record.calls.push('onApplied');
        record.applied.push(answer);
      },
      carry: (update) => {
        record.calls.push('carry');
        record.selection = update(record.selection);
      },
    },
    DOC,
    command,
  );
  return record;
}

describe('applyCarrying', () => {
  it('reads the walk AFTER the command and BEFORE the version moves, then carries the selection', async () => {
    const record = await run(RESTYLE, walkAt(AFTER));
    expect(record.calls).toStrictEqual(['document.execute', 'document.annotations', 'onApplied', 'carry']);
    expect(record.applied.map((answer) => answer.version)).toStrictEqual([AFTER]);
    expect(record.selection?.version).toBe(AFTER);
    // FROM THE WALK, not the old item: the colour the restyle wrote.
    expect(record.selection?.items[0]?.style.colour).toStrictEqual([0, 0, 1]);
  });

  it('a read that fails still moves the version, and drops the selection', async () => {
    const record = await run(RESTYLE, undefined);
    expect(record.calls).toStrictEqual(['document.execute', 'document.annotations', 'onApplied', 'carry']);
    expect(record.applied).toHaveLength(1);
    expect(record.selection).toBeUndefined();
  });

  it('CONTROL: a command that does not keep the walk reads nothing and carries nothing', async () => {
    const record = await run({ kind: 'removeAnnotation', page: 1, indices: [0], version: BEFORE }, walkAt(AFTER));
    expect(record.calls).toStrictEqual(['document.execute', 'onApplied']);
    expect(record.selection).toBe(PICKED);
  });
});
