import { describe, expect, it } from 'vitest';

/**
 * NO STYLESHEET DECLARES AN ANIMATION THAT REPEATS FOR EVER.
 *
 * The one that did was the opening state's turning mark, and what it cost is in `app.css` beside `.m-page-opening`: it
 * ran for exactly as long as the engine host took to start, so its frames competed with that start, and with a debugger
 * attached at launch the host missed its connect bound and the document was poisoned. A waiting state is the place an
 * endless animation is drawn, and a wait is what it slows. Refused here for every stylesheet, read by search so a file
 * added tomorrow is covered the day it is added.
 *
 * Read through Vite's `import.meta.glob` with `?raw`, `fullAppTestLimit.test.ts`' route: this package never imports
 * Node.
 */

const SHEETS: Readonly<Record<string, string>> = import.meta.glob<string>('./**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** One stylesheet's animation declarations — the shorthand and the iteration count — with comments removed first. */
function animations(css: string): readonly string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  return [...code.matchAll(/\banimation(?:-iteration-count)?\s*:\s*([^;}]+)/gu)].map((found) => (found[1] ?? '').trim());
}

/** The declarations among them that repeat for ever. */
function endless(css: string): readonly string[] {
  return animations(css).filter((value) => /\binfinite\b/u.test(value));
}

describe('stylesheet motion', () => {
  it('the search can see: it reads every stylesheet and finds the animations they declare', () => {
    // THE POSITIVE CONTROL. A glob that matched nothing, or a pattern that read no declaration, would make the case
    // below pass with nothing looked at.
    expect(Object.keys(SHEETS).sort()).toEqual(['./app.css', './primitives/primitives.css', './tokens.css']);
    expect(Object.values(SHEETS).flatMap(animations).length).toBeGreaterThan(0);
  });

  it('CONTROL: the rule the opening state carried is reported, and the same words in a comment are not', () => {
    const carried = '.m-page-opening svg {\n  animation: m-turn 1s linear infinite;\n}\n';
    expect(endless(carried)).toEqual(['m-turn 1s linear infinite']);
    expect(endless('.x { animation-iteration-count: infinite; }')).toEqual(['infinite']);
    expect(endless('/* animation: m-turn 1s linear infinite; */ .x { animation: m-in 200ms ease-out; }')).toEqual([]);
  });

  it('no stylesheet declares an animation that repeats for ever', () => {
    const found = Object.entries(SHEETS).flatMap(([file, css]) => endless(css).map((value) => `${file}: ${value}`));
    expect(found).toEqual([]);
  });
});
