import { type ContractClient, channels, createClient } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { keepPicture, stampLibrary } from './stampLibrary.js';

/** A client whose library answers `added` for `library.addPicture`, and records every call. */
function libraryAnswering(added: unknown): { readonly client: ContractClient; readonly calls: string[] } {
  const calls: string[] = [];
  const client = createClient(channels, (id) => {
    calls.push(id);
    if (id === 'library.addPicture') return Promise.resolve(ok(added));
    if (id === 'library.list') {
      return Promise.resolve(
        ok({
          entries: [
            { id: '00000000-0000-4000-8000-0000000000d1', kind: 'stamp', look: { kind: 'picture', name: 'paid' } },
            { id: '00000000-0000-4000-8000-0000000000d2', kind: 'stamp', look: { kind: 'picture', name: 'gone' } },
          ],
        }),
      );
    }
    if (id === 'library.picture') {
      return Promise.resolve(ok(calls.filter((call) => call === 'library.picture').length === 1
        ? { kind: 'found', mediaType: 'image/png', bytes: Uint8Array.of(1) }
        : { kind: 'absent' }));
    }
    return Promise.resolve(ok({ removed: true }));
  });
  return { client, calls };
}

const URLS = { make: (): string => 'blob:made', revoke: (): void => undefined };

describe('keeping a picture in the library, as the page asks for it', () => {
  it('says each problem through the image problem dialog, AND WAITS for it before settling', async () => {
    for (const [answer, props] of [
      [{ kind: 'unreadable' }, { reason: 'unreadable' }],
      [{ kind: 'too-large', limitBytes: 2_097_152 }, { reason: 'too-large', limitBytes: 2_097_152 }],
      [{ kind: 'full', limit: 16 }, { reason: 'library-full', limit: 16 }],
    ] as const) {
      const order: string[] = [];
      const { client } = libraryAnswering(answer);
      await keepPicture(
        {
          client,
          urls: URLS,
          ask: async (id, shown) => {
            order.push(`opened ${id} ${JSON.stringify(shown)}`);
            // A TIMER, not a microtask: closed one microtask later, an unawaited dialog still closed before the
            // caller's continuation ran, and the mutation dropping the await survived (found by running it).
            await new Promise((resolve) => setTimeout(resolve, 0));
            order.push('closed');
            return undefined;
          },
        },
        'stamp',
      ).then(() => order.push('settled'));
      // SETTLED AFTER THE DIALOG CLOSED: the chooser opened next would otherwise dismiss it.
      expect(order).toStrictEqual([`opened dialog.insert-image-problem ${JSON.stringify(props)}`, 'closed', 'settled']);
    }
  });

  it('CONTROL: a picture kept or a cancelled picker says nothing', async () => {
    for (const answer of [
      { kind: 'cancelled' },
      { kind: 'added', entry: { id: '00000000-0000-4000-8000-0000000000d3', kind: 'stamp', look: { kind: 'picture', name: 'x' } } },
    ]) {
      const opened: unknown[] = [];
      await keepPicture(
        {
          client: libraryAnswering(answer).client,
          urls: URLS,
          ask: (id) => {
            opened.push(id);
            return Promise.resolve(undefined);
          },
        },
        'stamp',
      );
      expect(opened).toStrictEqual([]);
    }
  });

  it('the stamp chooser’s pictures leave out one whose bytes cannot be read back', async () => {
    const { client } = libraryAnswering({ kind: 'cancelled' });
    const { pictures } = await stampLibrary({ client, ask: () => Promise.resolve(undefined), urls: URLS }).stampPictures();
    expect(pictures).toStrictEqual([{ id: '00000000-0000-4000-8000-0000000000d1', name: 'paid', src: 'blob:made' }]);
  });
});
