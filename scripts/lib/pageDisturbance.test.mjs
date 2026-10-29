// @ts-check
import { describe, expect, it } from 'vitest';

import { readOnce } from './pageDisturbance.mjs';

describe('readOnce, the one store of a page’s reads', () => {
  it('reads a document once for one engine and one question, and answers the same read after', () => {
    const engine = {};
    const bytes = new Uint8Array([1, 2, 3]);
    let made = 0;
    const read = () => readOnce(engine, bytes, 'render:0', () => ({ made: ++made }));
    const first = read();
    expect(read()).toBe(first);
    expect(made).toBe(1);
  });

  it('CONTROL: never answers one document’s read for another, though their bytes are the same, nor another question’s', () => {
    const engine = {};
    let made = 0;
    const make = () => ++made;
    const one = readOnce(engine, new Uint8Array([1, 2, 3]), 'render:0', make);
    // THE SAME BYTES IN ANOTHER ARRAY are read again: the store holds a read by the array, never by what it holds.
    const other = readOnce(engine, new Uint8Array([1, 2, 3]), 'render:0', make);
    const bytes = new Uint8Array([4]);
    const page = readOnce(engine, bytes, 'render:0', make);
    const nextPage = readOnce(engine, bytes, 'render:1', make);
    const otherEngine = readOnce({}, bytes, 'render:0', make);
    expect([one, other, page, nextPage, otherEngine]).toStrictEqual([1, 2, 3, 4, 5]);
  });
});
