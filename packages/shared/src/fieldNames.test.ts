import { describe, expect, it } from 'vitest';

import { fieldNameClash, nextFieldName } from './fieldNames.js';

describe('nextFieldName', () => {
  it('is the kind word and 1 on a form with none of that kind', () => {
    expect(nextFieldName(['Name'], 'Text')).toBe('Text1');
    expect(nextFieldName([], 'Check Box')).toBe('Check Box1');
  });

  it('skips a number already taken, and one that would be a parent of a taken name', () => {
    expect(nextFieldName(['Text1', 'Text2'], 'Text')).toBe('Text3');
    expect(nextFieldName(['Text1.inner'], 'Text')).toBe('Text2');
  });

  it('CONTROL: a gap is filled, so the answer is the smallest free number and not one past the count', () => {
    expect(nextFieldName(['Text2'], 'Text')).toBe('Text1');
  });
});

describe('fieldNameClash', () => {
  const existing = ['Name', 'owner.first', 'plan'];

  it('names the field that has exactly the same name', () => {
    expect(fieldNameClash(existing, 'Name')).toBe('Name');
  });

  it('names a field whose name is the START of the wanted one, because a dot makes a parent', () => {
    expect(fieldNameClash(existing, 'Name.nick')).toBe('Name');
  });

  it('names a field the wanted name is the start of, which is the same collision the other way', () => {
    expect(fieldNameClash(existing, 'owner')).toBe('owner.first');
  });

  it('CONTROL: a sibling under the same parent, and a name that only SHARES LETTERS with one, collide with nothing', () => {
    // `owner.second` beside `owner.first` is two children of one parent; `Names` is not under `Name`. A rule that
    // compared by `startsWith` without the dot would call both a clash.
    expect(fieldNameClash(existing, 'owner.second')).toBeUndefined();
    expect(fieldNameClash(existing, 'Names')).toBeUndefined();
    expect(fieldNameClash([], 'anything')).toBeUndefined();
  });
});
