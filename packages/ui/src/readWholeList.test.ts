import { type DocVersion, type Result, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { readWholeList } from './readWholeList.js';

interface Part {
  readonly version: DocVersion;
  readonly next: number | null;
  readonly items: readonly string[];
}

/** A client answering `list` in parts of `size`, at the version `versionAt(call)` names for each call. */
function partsOf(
  list: readonly string[],
  size: number,
  versionAt: (call: number) => number = () => 1,
): { readonly ask: (from: number) => Promise<Result<Part, 'refused'>>; readonly asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    ask: (from) => {
      asked.push(from);
      const end = from + size;
      return Promise.resolve({
        ok: true,
        value: {
          version: asDocVersion(versionAt(asked.length - 1)),
          next: end < list.length ? end : null,
          items: list.slice(from, end),
        },
      });
    },
  };
}

const LIST = ['a', 'b', 'c', 'd', 'e'];

describe('readWholeList', () => {
  it('asks for every part in turn and answers the list whole, in order', async () => {
    const client = partsOf(LIST, 2);
    const read = await readWholeList(client.ask, (part) => part.items);
    expect(read.ok && read.value.items).toStrictEqual(LIST);
    // THE CALLS, not only the result: a reader that asked once and was handed everything would answer the same list
    // from a client that cut nothing, and this asserts the loop walked `next`.
    expect(client.asked).toStrictEqual([0, 2, 4]);
  });

  it('CONTROL: a reader that asked once would hold the first part only — the cap this replaced', async () => {
    const client = partsOf(LIST, 2);
    const once = await client.ask(0);
    expect(once.ok && once.value.items).toStrictEqual(['a', 'b']);
    expect(once.ok && once.value.next).toBe(2);
  });

  it('starts again from the top when the version moves between parts, and answers one version only', async () => {
    // The document moves after the first part: the second part is at version 2, and the halves describe two walks.
    const client = partsOf(LIST, 2, (call) => (call === 0 ? 1 : 2));
    const read = await readWholeList(client.ask, (part) => part.items);
    expect(read.ok && read.value.version).toBe(asDocVersion(2));
    expect(read.ok && read.value.items).toStrictEqual(LIST);
    // THE DECISION: the read restarted at 0 after seeing the move, rather than gluing a version-1 half to a version-2
    // half — which would also answer five items.
    expect(client.asked).toStrictEqual([0, 2, 0, 2, 4]);
  });

  it('a refused part is the read’s refusal', async () => {
    let call = 0;
    const read = await readWholeList<string, Part, 'refused'>(
      (from) => {
        call += 1;
        return Promise.resolve(
          call === 1
            ? { ok: true, value: { version: asDocVersion(1), next: 2, items: LIST.slice(from, 2) } }
            : { ok: false, error: 'refused' },
        );
      },
      (part) => part.items,
    );
    expect(read).toStrictEqual({ ok: false, error: 'refused' });
  });

  it('throws on a next that does not move forward, rather than asking for the same part for ever', async () => {
    const stuck = (): Promise<Result<Part, 'refused'>> =>
      Promise.resolve({ ok: true, value: { version: asDocVersion(1), next: 0, items: [] } });
    await expect(readWholeList(stuck, (part) => part.items)).rejects.toThrow(/named 0 as the next/u);
  });
});
