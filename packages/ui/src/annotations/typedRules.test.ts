import { MAX_FIELD_NAME, MAX_LINK_URI } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import {
  FORM_FIELD_NAME_EMPTY,
  FORM_FIELD_NAME_SEGMENT,
  FORM_FIELD_NAME_TOO_LONG,
  LINK_ADDRESS_EMPTY,
  LINK_ADDRESS_SCHEME,
  LINK_ADDRESS_TOO_LONG,
  LINK_PAGE_EMPTY,
  LINK_PAGE_NOT_A_NUMBER,
  LINK_PAGE_TOO_LONG,
} from '../messages/en.js';
import { fieldNameProblem, linkAddressProblem, linkPageProblem, typedPageNumber } from './typedRules.js';

/**
 * The three rules for what a person types for a link or a field. Each case pairs a value the rule refuses with one it
 * passes that differs in the one property the refusal is about, so a rule that refused everything, or nothing, fails.
 */

describe('linkAddressProblem', () => {
  it('passes the schemes this build allows, trimmed', () => {
    expect(['https://example.com', ' http://example.com ', 'mailto:a@example.com'].map(linkAddressProblem)).toStrictEqual(
      [undefined, undefined, undefined],
    );
  });

  it('refuses a scheme this build does not allow and a string that is not an address, with one sentence', () => {
    expect(['javascript:alert(1)', 'file:///c:/x.pdf', 'example.com'].map(linkAddressProblem)).toStrictEqual([
      LINK_ADDRESS_SCHEME,
      LINK_ADDRESS_SCHEME,
      LINK_ADDRESS_SCHEME,
    ]);
  });

  it('says empty for nothing typed, and too long one character past the bound', () => {
    const atBound = `https://example.com/${'a'.repeat(MAX_LINK_URI - 'https://example.com/'.length)}`;
    expect([linkAddressProblem('   '), linkAddressProblem(atBound), linkAddressProblem(`${atBound}a`)]).toStrictEqual([
      LINK_ADDRESS_EMPTY,
      undefined,
      LINK_ADDRESS_TOO_LONG,
    ]);
  });
});

describe('linkPageProblem and typedPageNumber', () => {
  it('reads a page counted from 1, and nothing Number() would also have taken', () => {
    expect(['1', ' 12 ', '0', '1e3', '0x10', 'Infinity', '-2', '2.0'].map(typedPageNumber)).toStrictEqual([
      1,
      12,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('refuses exactly what typedPageNumber does not read, so what passes is what is built', () => {
    for (const typed of ['1', ' 12 ', '0', '1e3', '0x10', 'four']) {
      expect(linkPageProblem(typed) === undefined).toBe(typedPageNumber(typed) !== undefined);
    }
    expect([linkPageProblem(''), linkPageProblem('four'), linkPageProblem('9'.repeat(MAX_LINK_URI + 1))]).toStrictEqual([
      LINK_PAGE_EMPTY,
      LINK_PAGE_NOT_A_NUMBER,
      LINK_PAGE_TOO_LONG,
    ]);
  });
});

describe('fieldNameProblem', () => {
  it('passes a name and a dotted name, and refuses every empty segment', () => {
    expect(['full_name', 'owner.first', ' owner.first '].map(fieldNameProblem)).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(['a..b', '.a', 'a.', 'a. .b'].map(fieldNameProblem)).toStrictEqual([
      FORM_FIELD_NAME_SEGMENT,
      FORM_FIELD_NAME_SEGMENT,
      FORM_FIELD_NAME_SEGMENT,
      FORM_FIELD_NAME_SEGMENT,
    ]);
  });

  it('says empty for nothing typed, and too long one character past the bound', () => {
    expect([
      fieldNameProblem(' '),
      fieldNameProblem('a'.repeat(MAX_FIELD_NAME)),
      fieldNameProblem('a'.repeat(MAX_FIELD_NAME + 1)),
    ]).toStrictEqual([FORM_FIELD_NAME_EMPTY, undefined, FORM_FIELD_NAME_TOO_LONG]);
  });
});
