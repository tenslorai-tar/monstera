import { describe, expect, it } from 'vitest';

import { BoundedList } from './boundedList.js';

/** A walk over `items` the way every bounded walk is written: ask for room for each, stop when there is none. */
function walk(items: readonly string[], bound: number): { readonly items: readonly string[]; readonly truncated: boolean } {
  const list = new BoundedList<string>(bound);
  for (const item of items) {
    if (!list.room()) break;
    list.add(item);
  }
  return list.answer();
}

describe('BoundedList — stop at the bound and say so', () => {
  it('stops at the bound and says there was more', () => {
    expect(walk(['a', 'b', 'c'], 2)).toStrictEqual({ items: ['a', 'b'], truncated: true });
  });

  it('CONTROL: a walk that ends exactly at the bound is whole, and one under it too', () => {
    expect(walk(['a', 'b'], 2)).toStrictEqual({ items: ['a', 'b'], truncated: false });
    expect(walk(['a'], 2)).toStrictEqual({ items: ['a'], truncated: false });
  });

  it('refuses an item added without room, so a walk that skipped asking cannot pass the bound', () => {
    const list = new BoundedList<string>(1);
    list.add('a');
    expect(() => {
      list.add('b');
    }).toThrow(RangeError);
  });
});
