import { describe, expect, it } from 'vitest';

import { FORM_FIELD_NAME_PARENT, FORM_FIELD_NAME_TAKEN } from '../messages/en.js';
import { type KnownField, fieldNameProblemAmong } from './fieldNameCheck.js';

/**
 * A typed field name, asked against the fields the document has before anything is sent: the writer's own rule
 * (`fieldNameClash`), said in words.
 */
const KNOWN: readonly KnownField[] = [
  { name: 'plan', kind: 'radio', options: ['Basic'] },
  { name: 'plan', kind: 'radio', options: ['Pro'] },
  { name: 'owner.first', kind: 'text', options: [] },
];

describe('fieldNameProblemAmong', () => {
  it('a typed name a RADIO GROUP holds is taken: typing never joins a group (BBBBBBBB-10)', () => {
    // THE ALLOWANCE THAT WAS REMOVED would answer nothing here, since `plan` is a radio group of exactly this name.
    expect(fieldNameProblemAmong('plan', KNOWN)).toBe(FORM_FIELD_NAME_TAKEN);
    expect(fieldNameProblemAmong('  plan ', KNOWN)).toBe(FORM_FIELD_NAME_TAKEN);
  });

  it('a name that is a path prefix of another, or has another for its prefix, is a parent clash', () => {
    expect(fieldNameProblemAmong('owner', KNOWN)).toBe(FORM_FIELD_NAME_PARENT);
    expect(fieldNameProblemAmong('plan.extra', KNOWN)).toBe(FORM_FIELD_NAME_PARENT);
  });

  it('CONTROL: a name no field holds, nor is a path of, is free', () => {
    expect(fieldNameProblemAmong('owner.second', KNOWN)).toBeUndefined();
    expect(fieldNameProblemAmong('plans', KNOWN)).toBeUndefined();
  });
});
