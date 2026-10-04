import { describe, expect, it } from 'vitest';

import { EN } from './en.js';
import * as catalogue from './en.js';

/**
 * Every registered key has an entry, and nothing else does.
 *
 * ## Why this is not the type, which is what it looks like
 *
 * `EN` is declared `Readonly<Record<MessageKey, string>>`, and `MessageKey` is a
 * **branded string**. A `Record` keyed on a branded primitive is an *index
 * signature*, not an exhaustive key set — so the type refuses a key that was
 * never minted and says nothing at all about a minted key with no entry. The
 * declaration reads like completeness and delivers half of it.
 *
 * ## Why it does not wait on the first `<Trans>`, which is where it was parked
 *
 * The i18n row deferred this beside `@lingui/cli` extraction, both *"waiting on
 * the first `<Trans>`"*. Extraction genuinely does: it reads **source strings**,
 * and every message today is registry metadata rather than rendered prose.
 * Completeness does not — it compares two things that already exist, in one
 * file, and the deferral was a reason belonging to its neighbour.
 *
 * ## The keys are the module's own exports, not a grammar match
 *
 * Reading every exported string off the module is exact: this file exports
 * message keys and the catalogue, and nothing else. Scanning source for
 * `messageKey(` would be a second opinion about what a call site looks like —
 * the objection the row raises against doing that for extraction, which applies
 * here identically.
 *
 * A module-level registry inside `messageKey` was the other candidate and is
 * refused: ADR-0029 Decision 1 makes registries values composed at a point and
 * never module side effects, and a mint that recorded into a global would be
 * exactly that, in the package everything imports.
 */

/**
 * Words ending in *s* that follow a placeholder and are NOT a plural noun — a verb, *this*, *as* — so the count check
 * does not read them as one. Each is here because a message uses it; a new one is a line added on purpose.
 */
const NOT_A_PLURAL_NOUN: ReadonlySet<string> = new Set([
  'is',
  'was',
  'has',
  'does',
  'needs',
  'holds',
  'puts',
  'fixes',
  'publishes',
  // A KEY then what it does, in the status bar's tips: *{undoKey} undoes it*.
  'brings',
  'undoes',
  'goes',
  'searches',
  'this',
  'as',
]);

/** Placeholders that hold a fixed number above one, so a plural noun after them is always right. */
const FIXED_ABOVE_ONE: ReadonlySet<string> = new Set(['limit', 'megapixels']);

/** The text with every ICU `plural`, `select` and `selectordinal` argument taken out, braces balanced. */
function outsideIcuChoices(text: string): string {
  let out = '';
  let at = 0;
  while (at < text.length) {
    const choice = /^\{\s*\w+\s*,\s*(?:plural|select|selectordinal)\s*,/u.exec(text.slice(at));
    if (choice === null) {
      out += text[at] ?? '';
      at += 1;
      continue;
    }
    let depth = 0;
    for (; at < text.length; at += 1) {
      if (text[at] === '{') depth += 1;
      else if (text[at] === '}') {
        depth -= 1;
        if (depth === 0) {
          at += 1;
          break;
        }
      }
    }
    out += ' ';
  }
  return out;
}

/** Whether a message writes a count for the plural alone: a "(s)", or `{n} things` outside a plural. */
function countWrittenForThePluralAlone(text: string): boolean {
  if (text.includes('(s)')) return true;
  for (const match of outsideIcuChoices(text).matchAll(/\{(\w+)\}\s+([A-Za-z]+)/gu)) {
    const [, placeholder = '', word = ''] = match;
    if (!word.endsWith('s') || FIXED_ABOVE_ONE.has(placeholder)) continue;
    if (!NOT_A_PLURAL_NOUN.has(word.toLowerCase())) return true;
  }
  return false;
}

/** Every message key this module exports, by the export's own name. */
function exportedKeys(): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  for (const [name, value] of Object.entries(catalogue)) {
    if (typeof value === 'string') keys.set(name, value);
  }
  return keys;
}

describe('the English catalogue', () => {
  /**
   * THE POSITIVE CONTROL, and this file needs one more than most: the assertion
   * below is a search whose good news is an empty list, and an empty list is
   * also what a broken lookup returns. If `exportedKeys` found nothing — a
   * bundler change, a re-export, a rename — every case here would pass while
   * checking no keys at all.
   */
  it('finds the keys it is supposed to be checking', () => {
    const keys = exportedKeys();
    expect(keys.size).toBeGreaterThan(20);
    // Named, so the control fails on a rename rather than on a count that
    // happens to stay above a threshold.
    expect(keys.get('OPEN_DOCUMENT_TITLE')).toBe('command.open-document.title');
  });

  it('has an entry for every registered key', () => {
    const missing = [...exportedKeys()]
      .filter(([, key]) => !(key in EN))
      .map(([name, key]) => `${name} (${key})`);

    expect(missing).toStrictEqual([]);
  });

  /**
   * The other direction, and it is not the same claim. The type already refuses
   * an unminted key at the literal, but nothing refuses a key that was minted,
   * given an entry, and then stopped being exported — which leaves a string in
   * the catalogue that no component can ask for and every translator must
   * translate.
   */
  it('has no entry no code can reach', () => {
    const registered = new Set(exportedKeys().values());
    const orphans = Object.keys(EN).filter((key) => !registered.has(key));

    expect(orphans).toStrictEqual([]);
  });

  /**
   * A key with an empty string satisfies both cases above and renders as
   * nothing — the display-only defect, arriving in a catalogue: the control
   * exists, the lookup succeeds, and the user sees a blank.
   */
  it('has no entry that renders as nothing', () => {
    const blank = Object.entries(EN)
      .filter(([, text]) => text.trim() === '')
      .map(([key]) => key);

    expect(blank).toStrictEqual([]);
  });

  /**
   * THE FLOAT BAR HAS ONE NAME (the owner's 27 September list, item 3: *"everywhere"*). A search over every value, so
   * a string added later that says *toolbar* for it reddens here rather than in a screenshot. The control is the new
   * name being present at all: an empty catalogue would satisfy *no value says toolbar* too.
   */
  /**
   * A COUNT IS SAID THROUGH THE PLURAL RULE, never as "(s)" and never as a bare number before a plural noun (item 13i:
   * "1 files will be written"). 785fecc6 swept "(s)" by hand and left this shape standing, because nothing checked it.
   *
   * The rule is read off the text: a placeholder followed by a word ending in *s*, outside an ICU `plural` or `select`,
   * is a count written for the plural alone. Prose cannot tell a plural noun from a verb (*"{name} needs"*), so the
   * other words are named in {@link NOT_A_PLURAL_NOUN}, and a new one is a line someone adds on purpose. A fixed
   * number that is never one (a limit, a size) is named in {@link FIXED_ABOVE_ONE} for the same reason.
   */
  it('says every count through the plural rule, with no "(s)" and no bare number before a plural noun', () => {
    const offending = Object.entries(EN).filter(([, text]) => countWrittenForThePluralAlone(text));
    expect(offending.map(([key]) => key)).toStrictEqual([]);
  });

  it('CONTROL: the count check sees the shapes it is for, and passes the plural rule', () => {
    expect(countWrittenForThePluralAlone('{files} files will be written.')).toBe(true);
    expect(countWrittenForThePluralAlone('Counted {counted} of {total} pages.')).toBe(true);
    expect(countWrittenForThePluralAlone('Remove {count} duplicate page(s)')).toBe(true);
    expect(countWrittenForThePluralAlone('{count, plural, one {# file} other {# files}} will be written.')).toBe(false);
    expect(countWrittenForThePluralAlone('{name} needs a password.')).toBe(false);
  });

  it('calls the floating bar the Float bar everywhere, and nowhere the toolbar', () => {
    const values = Object.values(EN);
    expect(values.filter((text) => /\btool ?bars?\b/iu.test(text))).toStrictEqual([]);
    expect(values.filter((text) => text.includes('Float bar')).length).toBeGreaterThanOrEqual(5);
  });
});
