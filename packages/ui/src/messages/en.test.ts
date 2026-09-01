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
});
