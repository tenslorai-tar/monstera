import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { PAGE_BARCODES_DIALOG_ID } from '../dialogs/pageBarcodes.js';
import { PLACE_BARCODE_DIALOG_ID } from '../dialogs/placeBarcode.js';
import { GROUP_OCR } from '../messages/en.js';
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

/** The read's dependencies over a recording ask, with a toast and a task nothing in the plain cases listens to. */
function depsOf(client: ContractClient, ask: (id: string, props: unknown) => Promise<unknown>): Parameters<typeof readBarcodesCommand>[0] {
  return {
    client,
    ask,
    toast: () => undefined,
    track: () => ({ signal: new AbortController().signal, step: () => undefined, end: () => undefined }),
    mark: () => undefined,
  };
}

/** Where a symbol is on its page, in the display space the dialog's mark draws. */
const WHERE = { x0: 100, y0: 200, x1: 180, y1: 280 };

describe('Read barcodes', () => {
  function clientAnswering(outcome: 'read' | 'refused'): { client: ContractClient; asked: unknown[] } {
    const asked: unknown[] = [];
    const client = createClient(channels, (id, params) => {
      if (id !== 'document.pageBarcodes') throw new Error(`unexpected channel ${id}`);
      asked.push(params);
      return Promise.resolve(
        outcome === 'read'
          ? ok({ version: asDocVersion(1), barcodes: [{ format: 'QRCode', text: 'https://example.org', box: WHERE }], truncated: true })
          : err({ code: 'document-poisoned' }),
      );
    });
    return { client, asked };
  }

  it('asks for the page ON SCREEN by its index, and shows it by the number a person reads', async () => {
    const { client, asked } = clientAnswering('read');
    const { ask, opened } = recordingAsk();
    await readBarcodesCommand(depsOf(client, ask)).run(contextOn(2));
    expect(asked).toStrictEqual([{ docId: DOC, page: 2 }]);
    expect(opened).toStrictEqual([
      {
        id: PAGE_BARCODES_DIALOG_ID,
        props: {
          kind: 'read',
          page: 3,
          all: false,
          pageCount: 5,
          barcodes: [{ format: 'QRCode', text: 'https://example.org', page: 3, index: 0 }],
          truncated: true,
        },
      },
    ]);
  });

  it('a refusal still opens the dialog, naming the page', async () => {
    const { client } = clientAnswering('refused');
    const { ask, opened } = recordingAsk();
    await readBarcodesCommand(depsOf(client, ask)).run(contextOn(0));
    expect(opened).toStrictEqual([{ id: PAGE_BARCODES_DIALOG_ID, props: { kind: 'refused', page: 1 } }]);
  });

  it('CONTROL: asks nothing with no page on screen', async () => {
    const { client, asked } = clientAnswering('read');
    const { ask, opened } = recordingAsk();
    await readBarcodesCommand(depsOf(client, ask)).run(contextOn(undefined));
    expect(asked).toStrictEqual([]);
    expect(opened).toStrictEqual([]);
  });

  describe('what the dialog reports (the owner’s list of 2026-10-07)', () => {
    /** A client over three pages, recording every call: page 2 (index 1) says a link, the others plain words. */
    function threePages(saving: { kind: 'cancelled' } | { kind: 'not-a-contact' } = { kind: 'cancelled' }): {
      client: ContractClient;
      calls: { id: string; params: unknown }[];
    } {
      const calls: { id: string; params: unknown }[] = [];
      const client = createClient(channels, (id, params) => {
        calls.push({ id, params });
        if (id === 'window.copyText') return Promise.resolve(ok({ copied: true }));
        if (id === 'document.openBarcodeLink') return Promise.resolve(ok({ kind: 'opened' as const }));
        if (id === 'document.saveBarcodeContact') return Promise.resolve(ok(saving));
        if (id !== 'document.pageBarcodes') throw new Error(`unexpected channel ${id}`);
        const page = (params as { page: number }).page;
        const barcodes =
          page === 1
            ? [
                { format: 'QRCode', text: 'plain words', box: WHERE },
                { format: 'QRCode', text: 'https://example.org/menu', box: { x0: 10, y0: 20, x1: 30, y1: 40 } },
              ]
            : [{ format: 'Code128', text: `ticket ${String(page + 1)}`, box: WHERE }];
        return Promise.resolve(ok({ version: asDocVersion(3), barcodes, truncated: false }));
      });
      return { client, calls };
    }
    /** Opens the dialog on page 2 and hands back what the opener was given to report to. */
    async function opened(saving?: { kind: 'cancelled' } | { kind: 'not-a-contact' }): Promise<{
      report: (what: unknown) => void;
      replies: unknown[];
      calls: { id: string; params: unknown }[];
      said: string[];
      marks: unknown[];
      close: () => void;
    }> {
      const { client, calls } = threePages(saving);
      const replies: unknown[] = [];
      let reporting: ((what: unknown, reply: (props: unknown) => void) => void) | undefined;
      let closeDialog: () => void = () => undefined;
      const said: string[] = [];
      const marks: unknown[] = [];
      await readBarcodesCommand({
        client,
        ask: (_id, _props, onUpdate) => {
          reporting = onUpdate;
          return new Promise((resolve) => {
            closeDialog = () => {
              resolve(undefined);
            };
          });
        },
        toast: (_kind, message) => said.push(message),
        track: () => ({ signal: new AbortController().signal, step: () => undefined, end: () => undefined }),
        mark: (spot) => marks.push(spot),
      }).run(contextOn(1));
      calls.length = 0;
      return {
        report: (what) => reporting?.(what, (props) => replies.push(props)),
        replies,
        calls,
        said,
        marks,
        close: () => {
          closeDialog();
        },
      };
    }
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    it('COPY puts that row’s text through main, and COPY ALL every row’s, blank line between', async () => {
      const { report, calls } = await opened();
      report({ kind: 'copy', text: 'plain words' });
      report({ kind: 'copy-all' });
      await settle();
      expect(calls.map((call) => call.params)).toStrictEqual([
        { text: 'plain words' },
        { text: 'plain words\n\nhttps://example.org/menu' },
      ]);
    });

    it('OPEN LINK names the barcode by its page and place at the version it was read — never by its text', async () => {
      const { report, calls } = await opened();
      report({ kind: 'open', page: 2, index: 1 });
      await settle();
      expect(calls).toStrictEqual([
        { id: 'document.openBarcodeLink', params: { docId: DOC, version: asDocVersion(3), page: 1, index: 1 } },
      ]);
      // A PAGE THAT WAS NEVER READ has no version, so nothing is sent.
      calls.length = 0;
      report({ kind: 'open', page: 3, index: 0 });
      await settle();
      expect(calls).toStrictEqual([]);
    });

    it('SHOW marks that barcode’s place on ITS page — zero-based, the box the read gave — and closing the list takes the mark away', async () => {
      const { report, marks, close } = await opened();
      report({ kind: 'show', page: 2, index: 1 });
      expect(marks).toStrictEqual([{ page: 1, box: { x0: 10, y0: 20, x1: 30, y1: 40 } }]);
      // A ROW THAT IS NOT IN THE LIST marks nothing, rather than the first one.
      report({ kind: 'show', page: 2, index: 9 });
      expect(marks).toHaveLength(1);
      close();
      await settle();
      expect(marks.at(-1)).toBeUndefined();
      expect(marks).toHaveLength(2);
    });

    it('SAVE CONTACT names the barcode by its place at the version it was read, and a card that is not whole is said', async () => {
      const first = await opened();
      first.report({ kind: 'save-contact', page: 2, index: 0 });
      await settle();
      expect(first.calls).toStrictEqual([
        { id: 'document.saveBarcodeContact', params: { docId: DOC, version: asDocVersion(3), page: 1, index: 0 } },
      ]);
      expect(first.said).toStrictEqual([]);
      // A PAGE NEVER READ has no version, so nothing is sent.
      first.calls.length = 0;
      first.report({ kind: 'save-contact', page: 4, index: 0 });
      await settle();
      expect(first.calls).toStrictEqual([]);

      const refused = await opened({ kind: 'not-a-contact' });
      refused.report({ kind: 'save-contact', page: 2, index: 0 });
      await settle();
      expect(refused.said).toHaveLength(1);
    });

    it('READ ALL PAGES reads each page in turn and answers the dialog with every barcode, by its page', async () => {
      const { report, replies, calls } = await opened();
      report({ kind: 'read-all' });
      await settle();
      await settle();
      expect(calls.map((call) => (call.params as { page: number }).page)).toStrictEqual([0, 1, 2, 3, 4]);
      expect(replies).toHaveLength(1);
      const reply = replies[0] as { all: boolean; barcodes: { page: number; index: number; text: string }[] };
      expect(reply.all).toBe(true);
      expect(reply.barcodes.map((barcode) => `${String(barcode.page)}:${String(barcode.index)}:${barcode.text}`)).toStrictEqual([
        '1:0:ticket 1',
        '2:0:plain words',
        '2:1:https://example.org/menu',
        '3:0:ticket 3',
        '4:0:ticket 4',
        '5:0:ticket 5',
      ]);
    });
  });

  it('sits in Tools › OCR, with the other recognition — and not in Organize, which is about pages (2026-10-07)', () => {
    const { client } = clientAnswering('read');
    const { ask } = recordingAsk();
    expect(readBarcodesCommand(depsOf(client, ask)).placements).toStrictEqual([
      { surface: 'ribbon', section: 'tools', group: GROUP_OCR, order: 50, size: 'small' },
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
