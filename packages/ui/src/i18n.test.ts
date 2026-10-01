import { compileMessage } from '@lingui/message-utils/compileMessage';
import { messageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { MessageMissing, activateCatalogue, i18n, resolve } from './i18n.js';

/**
 * The resolver, and the two properties that are decisions rather than plumbing.
 *
 * Every case activates its own catalogue: the `i18n` instance is a module
 * singleton, so a case that assumed the previous one's state would pass in file
 * order and fail alone — which is the shape a harness bug hides in.
 */
const TITLE = messageKey('command.open-document.title');
const OTHER = messageKey('dialog.rename.title');

describe('the message resolver', () => {
  it('resolves a key to the active catalogue’s text', () => {
    activateCatalogue('en', { [TITLE]: 'Open a document' });

    expect(resolve(TITLE)).toBe('Open a document');
  });

  it('THROWS on a missing key rather than rendering the key', () => {
    // Lingui's default is to render the id, and `messages.ts` states why that is
    // worse than rendering English: a control showing `dialog.rename.title` to a
    // user is the display-only sin wearing a translated coat. This asserts the
    // throw AND the key it names, because a bare `toThrow()` passes for any
    // failure at all — including the catalogue not having loaded.
    activateCatalogue('en', { [TITLE]: 'Open a document' });

    expect(() => resolve(OTHER)).toThrow(MessageMissing);
    expect(() => resolve(OTHER)).toThrow(/dialog\.rename\.title/u);
  });

  it('CONTROL: the same catalogue resolves a key it DOES have', () => {
    // Without this the case above passes for a resolver that throws for
    // everything, which is also what an unloaded catalogue produces — and an
    // unloaded catalogue is the state every one of these cases starts in.
    activateCatalogue('en', { [TITLE]: 'Open a document' });

    expect(resolve(TITLE)).toBe('Open a document');
  });

  it('activating a second catalogue replaces the first', () => {
    // The locale switch, asserted by the text changing for one key rather than
    // by the call not throwing. A `load` that merged would leave the old
    // language visible for every key the new catalogue happens not to carry,
    // which is the failure that looks like a translation gap.
    activateCatalogue('en', { [TITLE]: 'Open a document' });
    activateCatalogue('fr', { [TITLE]: 'Ouvrir un document' });

    expect(resolve(TITLE)).toBe('Ouvrir un document');
  });

  it('does not hold a reference to the caller’s catalogue object (via Lingui’s own copy)', () => {
    // KEPT, WITH ITS ATTRIBUTION CORRECTED — the same treatment `browserShim`'s
    // outbound-clone case carries, and for the same reason. It was written to
    // cover the spread in `activateCatalogue`; mutation showed it passes with
    // the spread removed, because `i18n.load` copies internally.
    //
    // So it does not test that spread. It tests the PROPERTY, which is worth
    // having and is currently supplied by Lingui: a caller cannot change the
    // resolver's answers by mutating what they handed it. It starts covering our
    // copy on the day Lingui stops making one, and that is the honest
    // description of what it guards.
    //
    // Since 2026-10-01 there is no spread: `activateCatalogue` builds a new
    // record of COMPILED messages (the case below), which is a copy of its own.
    const catalogue: Record<string, string> = { [TITLE]: 'Open a document' };
    activateCatalogue('en', catalogue);

    catalogue[TITLE] = 'Mutated after loading';

    expect(resolve(TITLE)).toBe('Open a document');
  });
});

describe('the catalogue is compiled once, at load', () => {
  /**
   * `_()` hands a string message to the compiler on EVERY call and caches nothing (`@lingui/core` 6.6.0), so a
   * catalogue loaded as strings is parsed again for every label of every render — 174 ms in the parser of an 8.1 s
   * scroll, measured 2026-10-01. Counted here by a compiler that counts, swapped in for the length of each case.
   */
  function counting(): { readonly calls: () => number; readonly restore: () => void } {
    let calls = 0;
    i18n.setMessagesCompiler((message) => {
      calls += 1;
      return compileMessage(message);
    });
    return { calls: () => calls, restore: () => i18n.setMessagesCompiler(compileMessage) };
  }

  it('resolving an activated catalogue compiles nothing, and interpolates as before', () => {
    activateCatalogue('en', { [TITLE]: 'Open {name}' });
    const compiler = counting();
    try {
      expect(i18n._(TITLE, { name: 'a.pdf' })).toBe('Open a.pdf');
      expect(i18n._(TITLE, { name: 'b.pdf' })).toBe('Open b.pdf');
      expect(compiler.calls()).toBe(0);
    } finally {
      compiler.restore();
    }
  });

  it('CONTROL: the same catalogue loaded as strings is compiled on every call', () => {
    // Without this the case above passes for a counter that never counts — the state a compiler swapped in after
    // Lingui stopped consulting it would also produce.
    i18n.load('en', { [TITLE]: 'Open {name}' });
    i18n.activate('en');
    const compiler = counting();
    try {
      expect(i18n._(TITLE, { name: 'a.pdf' })).toBe('Open a.pdf');
      expect(i18n._(TITLE, { name: 'b.pdf' })).toBe('Open b.pdf');
      expect(compiler.calls()).toBe(2);
    } finally {
      compiler.restore();
    }
  });
});
