import { messageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { MessageMissing, activateCatalogue, resolve } from './i18n.js';

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
    // The spread stays for a reason of its own: `load` takes a mutable record,
    // and the alternative is widening the parameter's type with a cast.
    const catalogue: Record<string, string> = { [TITLE]: 'Open a document' };
    activateCatalogue('en', catalogue);

    catalogue[TITLE] = 'Mutated after loading';

    expect(resolve(TITLE)).toBe('Open a document');
  });
});
