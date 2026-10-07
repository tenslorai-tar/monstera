import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { type FieldSelection, fieldKey, liveKeys, modeOf, select } from './fieldSelection.js';

const V1 = asDocVersion(1);
const V2 = asDocVersion(2);
const ORDER = [fieldKey(0, 0), fieldKey(0, 1), fieldKey(0, 2), fieldKey(1, 0), fieldKey(1, 1)];

describe('field selection', () => {
  it('a plain click selects THAT ONE field and drops the rest, which is what two rows ending up selected broke', () => {
    const first = select(undefined, V1, ORDER[0] ?? '', 'replace', ORDER);
    const second = select(first, V1, ORDER[3] ?? '', 'replace', ORDER);
    expect(liveKeys(second, V1)).toStrictEqual([fieldKey(1, 0)]);
  });

  it('Ctrl toggles one, so a second click on a selected field takes it OUT: the selection can be undone', () => {
    let held: FieldSelection | undefined = select(undefined, V1, ORDER[0] ?? '', 'replace', ORDER);
    held = select(held, V1, ORDER[2] ?? '', 'toggle', ORDER);
    expect(liveKeys(held, V1)).toStrictEqual([fieldKey(0, 0), fieldKey(0, 2)]);
    held = select(held, V1, ORDER[2] ?? '', 'toggle', ORDER);
    expect(liveKeys(held, V1)).toStrictEqual([fieldKey(0, 0)]);
  });

  it('Shift takes the run between the last click and this one, in the list’s order and in either direction', () => {
    const anchored = select(undefined, V1, ORDER[1] ?? '', 'replace', ORDER);
    expect(liveKeys(select(anchored, V1, ORDER[4] ?? '', 'range', ORDER), V1)).toStrictEqual(ORDER.slice(1, 5));
    const backwards = select(select(undefined, V1, ORDER[3] ?? '', 'replace', ORDER), V1, ORDER[0] ?? '', 'range', ORDER);
    expect(liveKeys(backwards, V1)).toStrictEqual(ORDER.slice(0, 4));
  });

  it('a Shift click with nothing to measure from selects the one field, rather than nothing', () => {
    expect(liveKeys(select(undefined, V1, ORDER[2] ?? '', 'range', ORDER), V1)).toStrictEqual([fieldKey(0, 2)]);
  });

  it('CONTROL: a selection made at one version names nothing at the next, so a position cannot name another field', () => {
    const held = select(undefined, V1, ORDER[0] ?? '', 'replace', ORDER);
    expect(liveKeys(held, V1)).toStrictEqual([fieldKey(0, 0)]);
    expect(liveKeys(held, V2)).toStrictEqual([]);
    // AND A CLICK AT THE NEW VERSION STARTS FRESH rather than adding to the stale one.
    expect(liveKeys(select(held, V2, ORDER[1] ?? '', 'toggle', ORDER), V2)).toStrictEqual([fieldKey(0, 1)]);
  });

  it('reads the modifier keys: Shift before Ctrl, neither is a plain click', () => {
    expect(modeOf({ ctrlKey: false, metaKey: false, shiftKey: false })).toBe('replace');
    expect(modeOf({ ctrlKey: true, metaKey: false, shiftKey: false })).toBe('toggle');
    expect(modeOf({ ctrlKey: false, metaKey: true, shiftKey: false })).toBe('toggle');
    expect(modeOf({ ctrlKey: true, metaKey: false, shiftKey: true })).toBe('range');
  });
});
