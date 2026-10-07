import { describe, expect, it } from 'vitest';

import { fieldNameClash } from './fieldNames.js';

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
