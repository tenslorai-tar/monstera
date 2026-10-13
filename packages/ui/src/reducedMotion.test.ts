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

/** The two kinds of motion CSS has, each by every property that can start one — shorthand and longhand. */
const FAMILIES = {
  transition: ['transition', 'transition-property', 'transition-duration'],
  animation: ['animation', 'animation-name', 'animation-duration'],
} as const;
type Family = keyof typeof FAMILIES;

/** A value that makes a motion property move nothing: no property or name, or no time. */
const STILL = /^(?:none|0|0s|0ms)$/u;

/** Each declaration in a rule body as the motion family it belongs to and whether its value stills it. */
function motionDeclarations(body: string): { readonly family: Family; readonly still: boolean }[] {
  // PARSED BY DECLARATION, not matched by one pattern: a lookahead for `none` after `\s*` lets the whitespace
  // backtrack to nothing, so `transition: none` read as motion and every override read as one more motion.
  return body.split(';').flatMap((declaration) => {
    const colon = declaration.indexOf(':');
    if (colon < 0) return [];
    const property = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    const family = (Object.keys(FAMILIES) as Family[]).find((name) =>
      (FAMILIES[name] as readonly string[]).includes(property),
    );
    return family === undefined ? [] : [{ family, still: STILL.test(value) }];
  });
}

/**
 * A rule whose animation runs on a SCROLL or VIEW timeline: its progress is where the person has scrolled, so it has no
 * time, which is `STILL`'s own definition of not moving. Keyed on the rule's last `animation-timeline`, since the
 * `animation` shorthand resets the timeline and only a declaration after it stands.
 */
function scrollDriven(body: string): boolean {
  let driven = false;
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if (property === 'animation-timeline') driven = /^(?:scroll|view)\(/u.test(value);
    else if (property === 'animation') driven = false;
  }
  return driven;
}

/** The motion families a rule body STARTS: a motion property set to something that moves. */
function moves(body: string): Set<Family> {
  const driven = scrollDriven(body);
  return new Set(
    motionDeclarations(body)
      .filter((entry) => !entry.still && !(driven && entry.family === 'animation'))
      .map((entry) => entry.family),
  );
}

/**
 * The families a rule body STILLS: a motion property set to none or to no time. A rule under the attribute
 * that says nothing about motion stills nothing, however it is selected.
 */
function stills(body: string): Set<Family> {
  return new Set(motionDeclarations(body).filter((entry) => entry.still).map((entry) => entry.family));
}

const REDUCED = ":root[data-motion='reduced'] ";

describe('reduced motion', () => {
  const all = Object.values(SHEETS).flatMap(rules);
  // KEYED BY FAMILY AND SELECTOR, so a transition stilled by `animation: none` is still a moving transition.
  const moving = all
    .filter((rule) => !rule.selector.startsWith(REDUCED))
    .flatMap((rule) => [...moves(rule.body)].map((family) => `${family} ${rule.selector}`));
  const stilled = new Set(
    all
      .filter((rule) => rule.selector.startsWith(REDUCED))
      .flatMap((rule) => [...stills(rule.body)].map((family) => `${family} ${rule.selector.slice(REDUCED.length).trim()}`)),
  );

  it('the search can see: it finds the switch and the toast, the two motions known to exist', () => {
    // THE POSITIVE CONTROL. A read that found no motions would pass the case below for every stylesheet.
    expect(Object.keys(SHEETS).length).toBeGreaterThan(1);
    expect(moving).toContain('transition .m-switch::after');
    expect(moving).toContain('animation .m-toast');
  });

  it('the parse reads LONGHAND motion, and a rule that sets no motion stills none', () => {
    // CONSTRUCTED INPUTS, because the stylesheets today spell only shorthands — so a reader blind to longhand
    // would pass the positive control above and miss the first `transition-duration` anyone writes.
    expect([...moves('transition-property: opacity; transition-duration: 200ms')]).toStrictEqual(['transition']);
    expect([...moves('animation-name: m-pulse')]).toStrictEqual(['animation']);
    expect([...moves('transition-duration: 0s')]).toStrictEqual([]);
    expect([...stills('opacity: 1')]).toStrictEqual([]);
    expect([...stills('')]).toStrictEqual([]);
    expect([...stills('animation: none')]).toStrictEqual(['animation']);
  });

  it('an animation on a scroll timeline is not motion; the same animation on time is, and a transition beside it is', () => {
    expect([...moves('animation: m-fade auto linear both; animation-timeline: scroll(nearest)')]).toStrictEqual([]);
    expect([...moves('animation-name: m-fade; animation-timeline: view()')]).toStrictEqual([]);
    // CONTROLS: the same name on the document's clock moves; a shorthand AFTER the timeline resets it to time; and a
    // scroll timeline excuses only its own family.
    expect([...moves('animation: m-fade 200ms linear both')]).toStrictEqual(['animation']);
    expect([...moves('animation-timeline: scroll(nearest); animation: m-fade 200ms')]).toStrictEqual(['animation']);
    expect([...moves('animation-timeline: scroll(); transition: opacity 120ms')]).toStrictEqual(['transition']);
  });

  it('every selector that moves is stilled under data-motion="reduced", in the same family', () => {
    expect(
      moving.filter((key) => !stilled.has(key)),
      `stilled under the attribute: ${JSON.stringify([...stilled])}`,
    ).toStrictEqual([]);
  });
});
