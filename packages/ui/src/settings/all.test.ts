import { SECRET_SETTING_IDS } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { controlFor, DIALOG_SETTINGS } from '../dialogs/settings.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from './all.js';

/**
 * The registered set against the contract's list of secret ids.
 *
 * ## Both directions, because each failure is invisible from the other side
 *
 * A setting marked `secret: true` that the contract does not list would pass
 * `settings.save`'s refusal and reach the plaintext document. An id the
 * contract lists that no setting marks would be refused on `settings.save` and
 * never offered to `settings.saveSecret` by anything that reads the flag. Sorted
 * equality catches both; iterating either list alone would make it the universe
 * and miss the other's extra member.
 */
describe('the registered settings', () => {
  it('mark as secret EXACTLY the ids the contract keeps off settings.save', () => {
    const marked = ALL_SETTINGS.filter((setting) => setting.secret === true)
      .map((setting) => setting.id)
      .sort();

    // A VACUITY GUARD: two empty lists are equal, and a registry that stopped
    // marking anything secret would agree with a contract that listed nothing.
    expect(marked.length).toBeGreaterThan(0);
    expect(marked).toStrictEqual([...SECRET_SETTING_IDS].sort());
  });

  it('constructs as a registry, which refuses an enumerated setting not titled exactly', () => {
    // THE PRODUCTION SET, through the production check: `main.tsx` builds this
    // registry at startup, so a title missing here is a crash on launch rather
    // than a blank option — and this is the case that says so before a launch.
    expect(() => new SettingsRegistry(ALL_SETTINGS)).not.toThrow();
  });

  it('leaves out of the Settings dialog EXACTLY the kinds it has no honest control for', () => {
    // PINNED BY ID (ADR-0056 Decision 3), so a setting of such a kind registered
    // later changes this list in the same commit — a visible decision rather
    // than a preference that silently has nowhere to be set.
    const excluded = ALL_SETTINGS.filter((setting) => controlFor(setting) === undefined)
      .map((setting) => setting.id)
      .sort();
    // THE ANNOTATION COLOUR LEFT THIS LIST 2026-09-15 (ADR-0056's correction): it is
    // a colour kind now. The accent stays, because it can be refused on apply — and since
    // 2026-09-22 the Settings dialog draws it with a control of its own, the design's swatches.
    expect(excluded).toStrictEqual(['appearance.accent', 'editing.personal-dictionary']);

    // REMEMBERED STATE IS ALSO NOT A ROW (the owner's design pass): a panel's width is stored and
    // exported like any setting, and its control is the splitter rather than a number box here.
    //
    // PINNED BY ID for the excluded list's reason, and one more: this list is SUBTRACTED from the
    // dialog, so a count derived from it agrees with any setting wrongly marked remembered — which
    // would leave the dialog in silence (found by the audit of d2989fc..22b709d).
    const remembered = ALL_SETTINGS.filter(
      (setting) => setting.remembered === true && controlFor(setting) !== undefined,
    )
      .map((setting) => setting.id)
      .sort();
    expect(remembered).toStrictEqual([
      'appearance.context-panel-open',
      'appearance.context-panel-tab',
      'appearance.context-panel-width',
      'appearance.document-panel',
      'appearance.document-panel-open',
      'appearance.document-panel-width',
      // THE ORGANIZE GRID'S CARD SIZE (ADR-0104): its control is the grid's own Medium / Large.
      'appearance.organize-grid-size',
      'appearance.quick-toolbar-edge',
      'appearance.quick-toolbar-open',
      'appearance.ribbon-section',
      'editing.style-as-default',
      'viewing.split',
    ]);

    // AND NOTHING ELSE IS LOST: every setting is in the dialog, named above, or remembered.
    expect(DIALOG_SETTINGS.length + excluded.length + remembered.length).toBe(ALL_SETTINGS.length);
  });
});
