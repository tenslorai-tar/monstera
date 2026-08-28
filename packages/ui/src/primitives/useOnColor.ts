import { type Rgb, channels, onColor } from '@monstera/shared';
import { type RefObject, useEffect } from 'react';

/**
 * Solves a contrast-bearing colour against the tokens actually in effect and
 * applies it to an element, at the point of use.
 *
 * ## Why this cannot be a token
 *
 * ADR-0003 types `--accent` as a `fill` and deliberately gives it no companion
 * foreground: *"storing a derived color is a defect"*. A `--on-accent` token
 * would be one value baked for one theme while the theme is chosen at runtime,
 * so it would be right in the theme it was sampled in and quietly wrong in the
 * others — and a colour that fails contrast still renders, which is why nothing
 * would catch it.
 *
 * ## Why it reads the CASCADE rather than importing the values
 *
 * `tokens.css` is the single source of visual truth, and a TypeScript copy of
 * its hex values would be a second writer of one concern (B3) whose two halves
 * agree until somebody edits one. `getPropertyValue` asks the cascade what the
 * token resolved to — which is also the only way to be right under a theme this
 * module has never heard of.
 *
 * ## IT WRITES TO THE ELEMENT AND HOLDS NO STATE, and that is not a style choice
 *
 * The first version returned a string from `useState`, and
 * `react-hooks/set-state-in-effect` rejected it. The rule was pointing at a real
 * defect rather than a shape it disliked: state set from an effect body causes a
 * cascading render, **and** that version would never have re-solved. Its
 * dependencies were the token names, which do not change when the theme does —
 * so it computed once at mount and then held a stale colour for the rest of the
 * session, which is the stored derived colour ADR-0003 forbids, arriving by the
 * back door.
 *
 * An effect whose job is to synchronise an external system with React state is
 * exactly what effects are for, and the DOM node's inline style is that external
 * system. So the solved value goes straight onto the node, no render is
 * scheduled, and the observer below makes the answer follow the theme.
 *
 * ## CSP: `setProperty`, deliberately
 *
 * §9.27 pins `style-src 'self'` with no `'unsafe-inline'`, and records the
 * distinction that makes this legal: the directive governs `<style>` elements
 * and parsed `style=` attributes, and does **not** intercept CSSOM writes.
 * `element.style.setProperty` is a CSSOM write. Serialising the same value into
 * an attribute would not be.
 *
 * ## An unresolvable token clears the property rather than guessing
 *
 * No stylesheet, a name that does not exist, a value `channels` cannot parse, or
 * an `onColor` refusal all remove the property and let the stylesheet's own
 * colour stand. A hard-coded black would hide a missing token behind something
 * that looks deliberate.
 *
 * ## IT READS AT THE TARGET, AND THAT IS SETTLED BY THE DESIGN, NOT BY A TEST
 *
 * An earlier version read the tokens off `document.documentElement`. That was
 * chosen after measuring that happy-dom does not inherit custom properties to a
 * child — the test double deciding the product's behaviour — and it is wrong.
 *
 * The question is whether a token may carry a different value below the root,
 * and §10.2 answers it twice. *"Light, dark and high-contrast are token remaps
 * under `data-*` attributes"* names the attribute and does not confine it to the
 * root; and the derivation is specified against **the element's own
 * surroundings** — *"a derived output of that function against the element's
 * REAL background"*, with *"the selected-thumbnail ring — `onColor(accent, the
 * sidebar it actually sits on, 3.0)`"* as the worked example.
 *
 * `tokens.css` settles it in code: the theme blocks are written `[data-theme=
 * 'light']`, **unqualified**, not `:root[data-theme='light']`. An unqualified
 * attribute selector matches any element that carries it, and custom properties
 * inherit into that element's subtree — so an inverted panel or a preview pane
 * rendering the opposite theme is a supported arrangement, and a root-side read
 * would return the wrong values for every control inside it while rendering
 * something that merely looks slightly off.
 *
 * **One environment limit, with an expiry rather than a hope.** happy-dom
 * resolves a rule that matches the element itself and does **not** implement
 * custom-property inheritance, so a component test can verify that the read
 * happens at the target and cannot verify that a themed ANCESTOR reaches it.
 * That case belongs to the Playwright pass against a real engine (§10.7), and
 * it is the case this whole section is about — so it is owed, not covered.
 */

/**
 * @param target the element to write to
 * @param property the CSS property to set, e.g. `color`
 * @param wantedToken the token to start from, e.g. `--text`
 * @param backgroundTokens every surface the result must clear, e.g. `['--accent']`
 * @param minimum the WCAG ratio required — 4.5 for text, 3 for a boundary
 */
export function useOnColor(
  target: RefObject<HTMLElement | null>,
  property: string,
  wantedToken: string,
  backgroundTokens: readonly string[],
  minimum: number,
): void {
  // THE DEPENDENCY IS THE JOINED STRING, not the array. A caller writing
  // `['--accent']` inline hands a new array identity on every render, and an
  // effect depending on the array would re-run on every one of them. Joining
  // gives a value that changes when the token names change and not when the
  // caller re-renders, which is what the dependency list is asking about.
  const backgroundKey = backgroundTokens.join(' ');

  useEffect(() => {
    const apply = (): void => {
      const element = target.current;
      if (element === null) return;

      // AT THE ELEMENT, because a token may be remapped below the root — see
      // the section above, which settles this from §10.2 and `tokens.css`'s
      // unqualified `[data-theme]` selectors rather than from what any test
      // environment happens to implement.
      const style = globalThis.getComputedStyle(element);
      const read = (token: string): Rgb | null => channels(style.getPropertyValue(token).trim());

      const names = backgroundKey.length === 0 ? [] : backgroundKey.split(' ');

      // NO BACKGROUNDS MEANS THERE IS NOTHING HERE TO SOLVE, and that is a
      // different statement from `onColor`'s refusal of an empty set. `onColor`
      // is asked to produce a colour, so a caller who names no surface has not
      // said what the constraint is. This hook is asked to maintain a property
      // where the surface is UNDERIVED — and a variant sitting on a pair
      // `tokens.css` declares has no such surface, because `check:tokencontrast`
      // already owns that question (B3a). Passing the empty case through to
      // `onColor` would turn a correct call into a reported caller error.
      if (names.length === 0) {
        element.style.removeProperty(property);
        return;
      }

      const wanted = read(wantedToken);
      const backgrounds: Rgb[] = [];
      for (const name of names) {
        const background = read(name);
        if (background === null) {
          element.style.removeProperty(property);
          return;
        }
        backgrounds.push(background);
      }
      if (wanted === null) {
        element.style.removeProperty(property);
        return;
      }

      const result = onColor(wanted, backgrounds, minimum);
      if (!result.ok) {
        element.style.removeProperty(property);
        return;
      }
      element.style.setProperty(property, `rgb(${result.value.map(Math.round).join(', ')})`);
    };

    apply();

    // A theme switch changes what every token resolves to and changes no prop,
    // so nothing in React's model would re-run this. `data-theme` on the
    // document element is how a theme is selected (`tokens.css`), which makes
    // the attribute the external system to subscribe to — the second thing the
    // set-state-in-effect rule names an effect as being for.
    const observer = new globalThis.MutationObserver(apply);
    observer.observe(globalThis.document.documentElement, {
      attributeFilter: ['data-theme'],
      attributes: true,
      // SUBTREE, for the same reason the read moved to the element: a theme is
      // whatever element carries `data-theme`, so a panel switching its own
      // theme changes what this control's tokens resolve to and touches no
      // attribute on the root. Watching the root alone would re-solve for a
      // global switch and silently hold a stale colour for a scoped one —
      // which is the stored derived colour ADR-0003 forbids, again.
      subtree: true,
    });
    return (): void => {
      observer.disconnect();
    };
  }, [target, property, wantedToken, backgroundKey, minimum]);
}
