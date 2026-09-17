import { describe, expect, it } from 'vitest';

import { comparableLine, diffLines } from './lineDiff.js';

describe('diffLines — what one page has that the other does not', () => {
  it('CONTROL: identical pages have no changes', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'b', 'c'])).toStrictEqual([]);
  });

  it('a changed line is its removal, then its replacement, where it sits', () => {
    expect(diffLines(['Total', 'Due 1 May', 'Thanks'], ['Total', 'Due 8 May', 'Thanks'])).toStrictEqual([
      { kind: 'removed', text: 'Due 1 May' },
      { kind: 'added', text: 'Due 8 May' },
    ]);
  });

  it('an inserted line in the middle is one addition, not every line after it', () => {
    expect(diffLines(['one', 'two', 'three', 'four'], ['one', 'two', 'NEW', 'three', 'four'])).toStrictEqual([
      { kind: 'added', text: 'NEW' },
    ]);
  });

  it('a deleted first line and an added last line are both found', () => {
    expect(diffLines(['gone', 'kept', 'kept too'], ['kept', 'kept too', 'arrived'])).toStrictEqual([
      { kind: 'removed', text: 'gone' },
      { kind: 'added', text: 'arrived' },
    ]);
  });

  it('a line moved from the top to the bottom is one removal and one addition', () => {
    expect(diffLines(['moved', 'a', 'b'], ['a', 'b', 'moved'])).toStrictEqual([
      { kind: 'removed', text: 'moved' },
      { kind: 'added', text: 'moved' },
    ]);
  });

  it('spacing nobody sees is not a change, and the text shown is the side’s own', () => {
    expect(diffLines(['  Invoice   42 '], ['Invoice 42'])).toStrictEqual([]);
    expect(diffLines(['Invoice  42'], ['Invoice 43'])).toStrictEqual([
      { kind: 'removed', text: 'Invoice  42' },
      { kind: 'added', text: 'Invoice 43' },
    ]);
    expect(comparableLine('\ta   b\n')).toBe('a b');
  });

  it('one side empty is every line of the other', () => {
    expect(diffLines([], ['x', 'y'])).toStrictEqual([
      { kind: 'added', text: 'x' },
      { kind: 'added', text: 'y' },
    ]);
    expect(diffLines(['x'], [])).toStrictEqual([{ kind: 'removed', text: 'x' }]);
  });

  it('two full pages of entirely different lines are compared, and every line is reported once', () => {
    const left = Array.from({ length: 2048 }, (_unused, index) => `left ${String(index)}`);
    const right = Array.from({ length: 2048 }, (_unused, index) => `right ${String(index)}`);
    const changes = diffLines(left, right);
    expect(changes.filter((change) => change.kind === 'removed')).toHaveLength(2048);
    expect(changes.filter((change) => change.kind === 'added')).toHaveLength(2048);
  });
});
