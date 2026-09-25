import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { PAGE_BARCODES_DIALOG_ID } from '../dialogs/pageBarcodes.js';
import { PLACE_BARCODE_DIALOG_ID } from '../dialogs/placeBarcode.js';
import { GROUP_MARKS } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import { placeBarcode, readBarcodesCommand } from './barcodes.js';

/**
 * The barcode commands against a validating client. The kernel half — that the words become a
 * symbol on the page that reads back — is `documentCommands.test.ts`' barcode block in
 * `apps/desktop`; these assert what reaches the channel and what a person is shown.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000bc');
const BOX = { x0: 60, y0: 390, x1: 110, y1: 360 };
const STAMP = () => ({ author: 'A. Tester', created: '2026-09-24T09:38:00.000Z' });

function contextOn(page: number | undefined): CommandContext {
  return { docId: DOC, version: asDocVersion(1), hasSelection: false, dirty: false, page, pageCount: 5 } as CommandContext;
}

function recordingAsk(answers: readonly unknown[] = []): {
  ask: (id: string, props: unknown) => Promise<unknown>;
  opened: { id: string; props: unknown }[];
} {
  const queue = [...answers];
  const opened: { id: string; props: unknown }[] = [];
  return {
    ask: (id, props) => {
      opened.push({ id, props });
      return Promise.resolve(queue.shift());
    },
    opened,
  };
}

describe('Read barcodes', () => {
  function clientAnswering(outcome: 'read' | 'refused'): { client: ContractClient; asked: unknown[] } {
    const asked: unknown[] = [];
    const client = createClient(channels, (id, params) => {
      if (id !== 'document.pageBarcodes') throw new Error(`unexpected channel ${id}`);
      asked.push(params);
      return Promise.resolve(
        outcome === 'read'
          ? ok({ version: asDocVersion(1), barcodes: [{ format: 'QRCode', text: 'https://example.org' }], truncated: true })
          : err({ code: 'document-poisoned' }),
      );
    });
    return { client, asked };
  }

  it('asks for the page ON SCREEN by its index, and shows it by the number a person reads', async () => {
    const { client, asked } = clientAnswering('read');
    const { ask, opened } = recordingAsk();
    await readBarcodesCommand({ client, ask }).run(contextOn(2));
    expect(asked).toStrictEqual([{ docId: DOC, page: 2 }]);
    expect(opened).toStrictEqual([
      {
        id: PAGE_BARCODES_DIALOG_ID,
        props: { kind: 'read', page: 3, barcodes: [{ format: 'QRCode', text: 'https://example.org' }], truncated: true },
      },
    ]);
  });

  it('a refusal still opens the dialog, naming the page', async () => {
    const { client } = clientAnswering('refused');
    const { ask, opened } = recordingAsk();
    await readBarcodesCommand({ client, ask }).run(contextOn(0));
    expect(opened).toStrictEqual([{ id: PAGE_BARCODES_DIALOG_ID, props: { kind: 'refused', page: 1 } }]);
  });

  it('CONTROL: asks nothing with no page on screen', async () => {
    const { client, asked } = clientAnswering('read');
    const { ask, opened } = recordingAsk();
    await readBarcodesCommand({ client, ask }).run(contextOn(undefined));
    expect(asked).toStrictEqual([]);
    expect(opened).toStrictEqual([]);
  });

  it('sits in Organize › Marks as a secondary, after the tool that adds one (ADR-0098)', () => {
    const { client } = clientAnswering('read');
    const { ask } = recordingAsk();
    expect(readBarcodesCommand({ client, ask }).placements).toStrictEqual([
      { surface: 'ribbon', section: 'organize', group: GROUP_MARKS, order: 62, prominence: 'secondary' },
    ]);
  });
});

describe('placing a barcode', () => {
  /** A client whose placement answers are scripted in order, recording what crossed. */
  function clientPlacing(answers: readonly ('refused' | 'placed')[]): { client: ContractClient; sent: unknown[] } {
    const queue = [...answers];
    const sent: unknown[] = [];
    const client = createClient(channels, (id, params) => {
      if (id !== 'document.placeBarcode') throw new Error(`unexpected channel ${id}`);
      sent.push(params);
      return Promise.resolve(
        queue.shift() === 'refused'
          ? ok({ kind: 'refused' as const })
          : ok({ kind: 'placed' as const, version: asDocVersion(2), byteLength: 5000, historyDropped: 0 }),
      );
    });
    return { client, sent };
  }

  it('sends the typed words, the type and the dragged box, and reports the new version', async () => {
    const { client, sent } = clientPlacing(['placed']);
    const { ask, opened } = recordingAsk([{ text: 'MONSTERA 42', format: 'DataMatrix' }]);
    const applied: unknown[] = [];
    await placeBarcode({ client, ask, onApplied: (value) => applied.push(value), stamp: STAMP }, DOC, 3, BOX);

    expect(opened).toStrictEqual([{ id: PLACE_BARCODE_DIALOG_ID, props: {} }]);
    // AND WHO PLACED IT AND WHEN, which main writes into the `placeImage` it builds (ADR-0103).
    expect(sent).toStrictEqual([
      { docId: DOC, pages: [3], rect: BOX, text: 'MONSTERA 42', format: 'DataMatrix', stamp: STAMP() },
    ]);
    expect(applied).toStrictEqual([{ version: 2, byteLength: 5000 }]);
  });

  it('a REFUSED try reopens the dialog holding what was typed, and the second try is sent', async () => {
    const { client, sent } = clientPlacing(['refused', 'placed']);
    const first = { text: 'letters', format: 'EAN13' };
    const second = { text: 'letters', format: 'QRCode' };
    const { ask, opened } = recordingAsk([first, second]);
    const applied: unknown[] = [];
    await placeBarcode({ client, ask, onApplied: (value) => applied.push(value), stamp: STAMP }, DOC, 0, BOX);

    expect(opened).toStrictEqual([
      { id: PLACE_BARCODE_DIALOG_ID, props: {} },
      { id: PLACE_BARCODE_DIALOG_ID, props: { refused: first } },
    ]);
    expect(sent.map((each) => (each as { format: string }).format)).toStrictEqual(['EAN13', 'QRCode']);
    expect(applied).toHaveLength(1);
  });

  it('CONTROL: dismissing the dialog sends nothing and applies nothing', async () => {
    const { client, sent } = clientPlacing(['placed']);
    const { ask } = recordingAsk([undefined]);
    const applied: unknown[] = [];
    await placeBarcode({ client, ask, onApplied: (value) => applied.push(value), stamp: STAMP }, DOC, 0, BOX);
    expect(sent).toStrictEqual([]);
    expect(applied).toStrictEqual([]);
  });
});
