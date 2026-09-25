import { describe, expect, it } from 'vitest';

/**
 * Every motion in the stylesheets is switched off under `data-motion="reduced"` — the Appearance setting's, or
 * Windows' (`applyMotion`). A motion added without its override would keep moving for a person who asked it
 * not to, and nothing on screen would say so; this reads the stylesheets and asks.
 *
 * Read through Vite's `import.meta.glob` with `?raw`, `fullAppTestLimit.test.ts`' route: this package imports no
 * Node, and the glob reads the files the bundle is built from.
 */
const SHEETS: Readonly<Record<string, string>> = import.meta.glob<string>(['./**/*.css'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Each rule as its selector and its body, comments removed. */
function rules(css: string): { readonly selector: string; readonly body: string }[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((match) => ({
    selector: (match[1] ?? '').trim(),
    body: match[2] ?? '',
  }));
}

/**
 * Whether a rule body sets a transition or an animation to something that moves.
 *
 * PARSED BY DECLARATION, not matched by one pattern: a lookahead for `none` after `\s*` lets the whitespace
 * backtrack to nothing, so `transition: none` read as motion and every override read as one more motion.
 */
function moves(body: string): boolean {
  return body.split(';').some((declaration) => {
    const colon = declaration.indexOf(':');
    if (colon < 0) return false;
    const property = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    return (property === 'transition' || property === 'animation') && value !== 'none';
  });
}

const REDUCED = ":root[data-motion='reduced'] ";

describe('reduced motion', () => {
  const all = Object.values(SHEETS).flatMap(rules);
  const moving = all.filter((rule) => !rule.selector.startsWith(REDUCED) && moves(rule.body)).map((rule) => rule.selector);
  const stilled = new Set(
    all
      .filter((rule) => rule.selector.startsWith(REDUCED) && !moves(rule.body))
      .map((rule) => rule.selector.slice(REDUCED.length).trim()),
  );

  it('the search can see: it finds the switch and the toast, the two motions known to exist', () => {
    // THE POSITIVE CONTROL. A read that found no motions would pass the case below for every stylesheet.
    expect(Object.keys(SHEETS).length).toBeGreaterThan(1);
    expect(moving).toContain('.m-switch::after');
    expect(moving).toContain('.m-toast');
  });

  it('every selector that moves is stilled under data-motion="reduced"', () => {
    expect(
      moving.filter((selector) => !stilled.has(selector)),
      `stilled under the attribute: ${JSON.stringify([...stilled])}`,
    ).toStrictEqual([]);
  });
});
