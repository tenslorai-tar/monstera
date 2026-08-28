import { describe, expect, it } from 'vitest';

import { messageDomain, messageKey } from './messages.js';

describe('messageKey', () => {
  it('accepts a domain-qualified key', () => {
    expect(messageKey('dialog.rename.title')).toBe('dialog.rename.title');
    expect(messageKey('command.save.label')).toBe('command.save.label');
    expect(messageKey('app.title')).toBe('app.title');
  });

  it('refuses a sentence, which is the input this type exists to stop', () => {
    // THE CASE THAT MATTERS. A brand whose minter accepts anything documents an
    // intention; the whole value of the type is that this call cannot succeed.
    expect(() => messageKey('Save changes')).toThrow(/not a message key/u);
    expect(() => messageKey('Rename document')).toThrow(/not a message key/u);
  });

  it('refuses a bare name, because a key with no domain has nowhere to be extracted to', () => {
    // Extraction produces one catalogue per domain, so a single segment is not
    // a key that happens to be short — it is a key with no destination.
    expect(() => messageKey('save')).toThrow(/not a message key/u);
  });

  it('refuses the malformed shapes a typo actually produces', () => {
    expect(() => messageKey('')).toThrow();
    expect(() => messageKey('.leading')).toThrow();
    expect(() => messageKey('trailing.')).toThrow();
    expect(() => messageKey('double..dot')).toThrow();
    expect(() => messageKey('Dialog.Rename')).toThrow();
    expect(() => messageKey('dialog rename')).toThrow();
  });

  it('names the offending value and says what a key looks like', () => {
    // A refusal that does not show the input makes the developer guess which of
    // several keys on the line was wrong.
    expect(() => messageKey('Save changes')).toThrow(/"Save changes"/u);
    expect(() => messageKey('Save changes')).toThrow(/dialog\.rename\.title/u);
  });
});

describe('messageDomain', () => {
  it('derives the domain from the key rather than taking it separately', () => {
    expect(messageDomain(messageKey('dialog.rename.title'))).toBe('dialog');
    expect(messageDomain(messageKey('command.save.label'))).toBe('command');
  });
});
