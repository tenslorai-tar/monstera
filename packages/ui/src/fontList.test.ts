import { channels, createClient } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { fontListOf, readFontListWhenIdle } from './fontList.js';

/** A client that counts `app.fontFamilies` and answers one family. */
function counting() {
  const asked: string[] = [];
  const client = createClient(channels, (id) => {
    asked.push(id);
    if (id === 'app.fontFamilies') {
      return Promise.resolve(ok({ listed: true, families: [{ name: 'Tinos', origin: 'bundled', embedding: 'subset', bold: true, italic: true }], more: 0 }));
    }
    throw new Error(`no answer for ${id}`);
  });
  return { client, asked };
}

describe('the font list read at the first idle moment (ADR-0268)', () => {
  it('asks NOTHING until idle, then once; the picker’s later request is that same one', async () => {
    const { client, asked } = counting();
    let idle: (() => void) | undefined;
    readFontListWhenIdle(client, (work) => {
      idle = work;
      return () => undefined;
    });
    // NOT YET: a start that asked before idle would compete with the window drawing.
    expect(asked).toStrictEqual([]);
    idle?.();
    expect(asked).toStrictEqual(['app.fontFamilies']);
    // THE PICKER, later: the same request, finished, and nothing asked again.
    const read = await fontListOf(client);
    expect(read.families.map((each) => each.name)).toStrictEqual(['Tinos']);
    expect(asked).toStrictEqual(['app.fontFamilies']);
  });

  it('CONTROL: cancelled before idle, it asks nothing, and the picker’s own request is the first', async () => {
    const { client, asked } = counting();
    let idle: (() => void) | undefined;
    let cancelled = false;
    const cancel = readFontListWhenIdle(client, (work) => {
      idle = work;
      return () => {
        cancelled = true;
      };
    });
    cancel();
    expect(cancelled).toBe(true);
    expect(idle).toBeDefined();
    expect(asked).toStrictEqual([]);
    await fontListOf(client);
    expect(asked).toStrictEqual(['app.fontFamilies']);
  });
});
