import { compileMessage } from '@lingui/message-utils/compileMessage';
import { describe, expect, it } from 'vitest';

import { EN } from './en.js';
import { PSEUDO_LOCALE, SHIPPED_LOCALES, pseudoCatalogue, pseudoMessage } from './pseudo.js';

/**
 * Every argument a message names — placeholders and plural or select subjects — in order, READ FROM LINGUI'S OWN
 * COMPILER. A token is `[name]` or `[name, kind, branches]`; anything else is text.
 *
 * It was a pattern over the source, `{word}` or `{word,`, and that is a second opinion about ICU beside the one the
 * application runs: it read a plural branch whose whole text is one word — `one {it} other {them}` — as two
 * placeholders, which the compiler knows are text, and reported a correct message as broken.
 */
function argumentsOf(message: string): string[] {
  return namesIn(compileMessage(message));
}

/** {@link argumentsOf} over a message already compiled, so a case that compiles each message compiles it ONCE. */
function namesIn(compiled: unknown): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    for (const token of node as unknown[]) {
      if (!Array.isArray(token)) continue;
      const [name, , branches] = token as [unknown, unknown, unknown];
      if (typeof name === 'string') names.push(name);
      if (typeof branches === 'object' && branches !== null) for (const branch of Object.values(branches)) walk(branch);
    }
  };
  walk(compiled);
  return names;
}

describe('the proof locale', () => {
  it('keeps every message’s ICU syntax: it compiles, and names the same arguments', () => {
    // EACH MESSAGE COMPILED ONCE, and its English read by key. This compiled every message three times and found its
    // English by scanning the whole catalogue for each key — 1.4 s alone on 2026-09-29, past five under a full run.
    const english: Readonly<Record<string, string | undefined>> = EN;
    const broken = Object.entries(pseudoCatalogue(EN)).flatMap(([key, message]) => {
      let compiled: unknown;
      try {
        compiled = compileMessage(message);
      } catch (error) {
        return [`${key}: ${String(error)}`];
      }
      return namesIn(compiled).join(',') === argumentsOf(english[key] ?? '').join(',') ? [] : [`${key}: arguments`];
    });
    expect(broken, `\n${broken.join('\n')}\n`).toStrictEqual([]);
  });

  it('reads a message’s arguments as the compiler does — a one-word branch is text, a placeholder in a branch is not', () => {
    expect(argumentsOf('Keep {count, plural, one {it} other {them}} now')).toStrictEqual(['count']);
    // CONTROL: the walk does reach inside a branch, so the case above is not an empty walk passing.
    expect(argumentsOf('{kind, select, a {A {name}} other {B}} of {total}')).toStrictEqual(['kind', 'name', 'total']);
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
