import { compileMessage } from '@lingui/message-utils/compileMessage';
import { describe, expect, it } from 'vitest';

import { EN } from './en.js';
import { PSEUDO_LOCALE, SHIPPED_LOCALES, pseudoCatalogue, pseudoMessage } from './pseudo.js';

/** Every argument a message names — placeholders and plural or select subjects — in order. */
const argumentsOf = (message: string): string[] => [...message.matchAll(/\{\s*(\w+)\s*[,}]/gu)].map((match) => match[1] ?? '');

describe('the proof locale', () => {
  it('keeps every message’s ICU syntax: it compiles, and names the same arguments', () => {
    const broken = Object.entries(pseudoCatalogue(EN)).flatMap(([key, message]) => {
      try {
        compileMessage(message);
      } catch (error) {
        return [`${key}: ${String(error)}`];
      }
      const english = Object.entries(EN).find(([id]) => id === key)?.[1] ?? '';
      return argumentsOf(message).join(',') === argumentsOf(english).join(',') ? [] : [`${key}: arguments`];
    });
    expect(broken, `\n${broken.join('\n')}\n`).toStrictEqual([]);
  });

  it('transforms text, and copies placeholders, selectors and # exactly', () => {
    // THREE DOTS: "Page  of " is nine characters once the placeholders are out, and a third of nine is three.
    expect(pseudoMessage('Page {page} of {count}')).toBe('⟦Þáĝé {page} óƒ {count}···⟧');
    const plural = pseudoMessage('{count, plural, one {This page} other {These # pages}}');
    expect(plural.startsWith('⟦{count, plural, one {Ţĥíš þáĝé} other {Ţĥéšé # þáĝéš}}')).toBe(true);
    // CONTROL: the transform changes plain text, so a copy of the catalogue would fail the case above.
    expect(pseudoMessage('Save')).not.toContain('Save');
  });

  it('is longer than English by about a third, so a layout that only fits English shows it', () => {
    const english = 'Keyboard shortcuts';
    expect(pseudoMessage(english).length).toBeGreaterThanOrEqual(Math.ceil(english.length * 1.3));
  });

  it('is never a locale a person is offered', () => {
    expect(SHIPPED_LOCALES).toStrictEqual(['en']);
    expect((SHIPPED_LOCALES as readonly string[]).includes(PSEUDO_LOCALE)).toBe(false);
  });
});
