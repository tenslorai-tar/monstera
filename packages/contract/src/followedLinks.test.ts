import { describe, expect, it } from 'vitest';

import { SHOWN_SCHEME_MAX, isFollowable, schemeOf, shownSchemeOf } from './followedLinks.js';

describe('which addresses a person may follow (ADR-0167)', () => {
  it('FOLLOWS a web page and a mail address, in any case', () => {
    for (const address of ['https://example.org/a', 'http://example.org', 'mailto:someone@example.org', 'HTTPS://EXAMPLE.ORG']) {
      expect(isFollowable(address), address).toBe(true);
    }
  });

  it('REFUSES every other scheme a document can name — CONTROL: the scheme is read, so each is named', () => {
    for (const [address, scheme] of [
      ['file:///C:/Windows/System32/calc.exe', 'file:'],
      ['javascript:alert(1)', 'javascript:'],
      ['ms-settings:privacy', 'ms-settings:'],
      ['data:text/html,<b>x</b>', 'data:'],
    ] as const) {
      expect(isFollowable(address), address).toBe(false);
      expect(schemeOf(address)).toBe(scheme);
    }
  });

  it('REFUSES what a URL parser would read through: a leading space, a tab in the scheme, no scheme at all', () => {
    // WHATWG's parser reads the first two as `javascript:` and the third as nothing. A check more lenient than the
    // string handed to the system is the defect this is written against.
    for (const address of [' javascript:alert(1)', 'java\tscript:alert(1)', '//example.org/a', 'example.org']) {
      expect(isFollowable(address), JSON.stringify(address)).toBe(false);
      expect(schemeOf(address)).toBeNull();
    }
    // CONTROL: the same address without the space is read, so the refusal above is the space's.
    expect(schemeOf('javascript:alert(1)')).toBe('javascript:');
  });

  it('SAYS a scheme of any length within the bound its messages carry, and decides on the whole of it', () => {
    // RFC 3986 bounds no scheme, so a document can name one longer than any refusal's schema allows. A side that put
    // `schemeOf` in a message would fail its own parse on this address rather than say it is refused.
    const long = `${'x'.repeat(SHOWN_SCHEME_MAX + 36)}:payload`;
    expect(schemeOf(long)).toHaveLength(SHOWN_SCHEME_MAX + 37);
    expect(shownSchemeOf(long)).toHaveLength(SHOWN_SCHEME_MAX);
    expect(isFollowable(long)).toBe(false);
    // CONTROL: a scheme within the bound is said whole, colon and all.
    expect(shownSchemeOf('javascript:alert(1)')).toBe('javascript:');
    expect(shownSchemeOf('example.org')).toBeNull();
  });
});
