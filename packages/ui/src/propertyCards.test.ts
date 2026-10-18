// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { CARD_CLASSES, controlsOutsideCards } from './propertyCards.js';

/** The stylesheet, read as `stylesheetMotion.test.ts` reads it: this package never imports Node's filesystem. */
const SHEETS: Readonly<Record<string, string>> = import.meta.glob<string>('./app.css', { query: '?raw', import: 'default', eager: true });

/**
 * The checker every Properties view's cases run (Addendum 3, 2026-10-18), and the copy it holds of the card rule.
 */

describe('the Properties cards', () => {
  it('the checker’s card classes are the card rule’s selectors in app.css, in its order', () => {
    const css = SHEETS['./app.css'] ?? '';
    // A GLOB THAT MATCHED NOTHING would compare an empty list with an empty rule.
    expect(css.length).toBeGreaterThan(1000);
    // THE RULE WHOSE FIRST SELECTOR IS `.m-card`: its selector list, up to the brace.
    const rule = /\n(\.m-card,[\s\S]*?)\{/u.exec(css)?.[1] ?? '';
    const selectors = rule
      .split(',')
      .map((each) => each.trim())
      .filter((each) => each !== '');
    expect(selectors).toStrictEqual(CARD_CLASSES.map((name) => `.${name}`));
  });

  it('finds no control outside a card where every group is in one', () => {
    const root = document.createElement('section');
    root.className = 'm-properties';
    root.innerHTML = [
      '<header class="m-properties__head"><button>head</button></header>',
      '<div class="m-properties__row"><label>Colour<input></label></div>',
      '<label class="m-properties__check"><input type="checkbox"> Fill</label>',
      '<details><summary>Blend</summary><div class="m-properties__row"><select></select></div></details>',
      '<div class="m-properties__foot"><button>Delete</button></div>',
    ].join('');
    expect(controlsOutsideCards(root)).toStrictEqual([]);
  });

  it('CONTROL: a group left outside a card is found, by its control', () => {
    const root = document.createElement('section');
    root.className = 'm-properties';
    root.innerHTML = '<div class="m-properties__row"><input></div><div class="m-loose"><span>Opacity</span><input data-loose=""></div>';
    expect(controlsOutsideCards(root).map((control) => control.getAttribute('data-loose'))).toStrictEqual(['']);
  });
});
