// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { channels, contrast, messageKey } from '@monstera/shared';
import { render as renderBare, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { Button } from './Button.js';

/**
 * The label is a `MessageKey` now, so every case needs a catalogue and a
 * provider — `useLingui` throws without one, deliberately.
 *
 * The queries below are unchanged: they ask for the accessible name `Save`, and
 * that is what the catalogue resolves this key to. **A test that queried by the
 * KEY would pass against a control rendering the key**, which is the exact
 * defect the resolver exists to prevent, so the name stays English on purpose.
 */
const SAVE = messageKey('command.save.label');
activateCatalogue('en', { [SAVE]: 'Save' });

function Messages({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/** Every render in this file needs the provider, so it is supplied once. */
function render(ui: ReactElement): ReturnType<typeof renderBare> {
  return renderBare(ui, { wrapper: Messages });
}

/**
 * `tokens.css` is not loaded in a component test, so the tokens the primitives
 * read are declared here on the document element and resolve through the same
 * cascade the real ones do.
 *
 * THE VALUES ARE THE REAL ONES, from `tokens.css`'s dark theme, and that is
 * load-bearing rather than tidy: `--text` on `--accent` measures about 1.8:1,
 * which FAILS the 4.5 a label needs. A fixture whose text already cleared its
 * fill would be satisfied by a component that ignored `onColor` entirely — the
 * defect and the correct behaviour would produce the same colour, and the case
 * would separate nothing.
 */
function declareTokens(accent = '#2fb96a'): void {
  // A STYLESHEET RULE THAT MATCHES THE CONTROL, not properties set on the root.
  // `useOnColor` reads at the element, because §10.2 remaps tokens under
  // `data-*` attributes and `tokens.css` writes those selectors unqualified, so
  // a token may carry a different value below the root. Declaring them here the
  // way the real cascade does is what keeps the harness from quietly testing a
  // different read site than the one that ships.
  const sheet = document.createElement('style');
  sheet.dataset['fixture'] = 'tokens';
  sheet.textContent = `.m-button { --text: #e7eaec; --accent: ${accent}; }`;
  document.head.append(sheet);
}

afterEach(() => {
  for (const sheet of document.querySelectorAll('style[data-fixture="tokens"]')) sheet.remove();
  document.documentElement.removeAttribute('data-theme');
});

describe('Button', () => {
  it('renders its label as the accessible name', () => {
    render(<Button label={SAVE} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
  });

  it('calls onClick when activated', () => {
    const onClick = vi.fn();
    render(<Button label={SAVE} onClick={onClick} />);
    screen.getByRole('button', { name: 'Save' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled label={SAVE} onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.hasAttribute('disabled')).toBe(true);
    button.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is reachable and activatable from the keyboard', () => {
    render(<Button label={SAVE} />);
    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();
    expect(document.activeElement).toBe(button);
    // A native <button> is what makes Enter and Space work without a handler,
    // which is why the primitive renders one rather than a div with a role.
    expect(button.tagName).toBe('BUTTON');
  });

  it('defaults to type=button, so it cannot submit a form it did not mean to', () => {
    render(<Button label={SAVE} />);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('type')).toBe('button');
  });

  describe('the primary variant computes its foreground', () => {
    it('applies a colour that clears 4.5:1 against the fill in effect', async () => {
      declareTokens();
      render(<Button label={SAVE} variant="primary" />);
      const button = screen.getByRole('button', { name: 'Save' });

      // `useOnColor` solves in an effect, so the first paint carries no colour.
      await vi.waitFor(() => {
        expect(button.style.color).not.toBe('');
      });

      const applied = channels(button.style.color);
      const accent = channels('#2fb96a');
      if (applied === null || accent === null) throw new Error('a colour did not parse');
      expect(contrast(applied, accent)).toBeGreaterThanOrEqual(4.5);
    });

    it('  ...and that colour is NOT the --text token it started from', async () => {
      declareTokens();
      render(<Button label={SAVE} variant="primary" />);
      const button = screen.getByRole('button', { name: 'Save' });
      await vi.waitFor(() => {
        expect(button.style.color).not.toBe('');
      });

      // THE CASE THAT SEPARATES. The assertion above is satisfied by any
      // component that happened to pick a readable colour, including one that
      // returned `--text` unchanged in a theme where `--text` already cleared.
      // Here it does not clear — 1.8:1 — so a component that skipped the solve
      // would land on exactly this value.
      const started = channels('#e7eaec');
      const accent = channels('#2fb96a');
      const applied = channels(button.style.color);
      if (started === null || accent === null) throw new Error('a fixture colour did not parse');
      expect(applied).not.toEqual(started);
      expect(contrast(started, accent)).toBeLessThan(4.5);
    });

    it('re-solves when the theme changes', async () => {
      declareTokens();
      render(<Button label={SAVE} variant="primary" />);
      const button = screen.getByRole('button', { name: 'Save' });
      await vi.waitFor(() => {
        expect(button.style.color).not.toBe('');
      });
      const onDark = button.style.color;

      // A theme switch changes what every token resolves to and changes no
      // prop, so nothing in React's model re-runs the solve. This is the case
      // the first version of `useOnColor` failed silently: it held the colour
      // it computed at mount for the rest of the session, which is the stored
      // derived colour ADR-0003 forbids arriving by the back door.
      //
      // The later rule wins on equal specificity, which is how a theme block
      // overrides the base one in `tokens.css`.
      declareTokens('#10243a');
      document.documentElement.setAttribute('data-theme', 'light');

      await vi.waitFor(() => {
        expect(button.style.color).not.toBe(onDark);
      });

      // And the new answer is right, not merely different: against a dark fill
      // the near-white `--text` already clears, so the solve should return it
      // unchanged rather than darkening again.
      const applied = channels(button.style.color);
      const newAccent = channels('#10243a');
      if (applied === null || newAccent === null) throw new Error('a colour did not parse');
      expect(contrast(applied, newAccent)).toBeGreaterThanOrEqual(4.5);
    });

    it('CLEARS THE FLOOR AFTER ROUNDING, on an accent chosen because it did not', async () => {
      // THE FIX AT THE SITE THAT MATTERS, and it is here because the hook's own
      // cases did not reach it.
      //
      // `useOnColor` read `result.value.map(Math.round)` until 2026-09-03 —
      // nearest, which is back toward the fill half the time. With `--text` at
      // `#e7eaec` on this accent, `onColor` answers 234.482, 237.047, 238.757
      // at just over 4.5:1, and nearest rounds it to `#eaedef`, which measures
      // **4.4965:1**. The button would have carried a colour that fails the
      // ratio it had just been solved for.
      //
      // `#0068d8` is not a hand-picked oddity: a partial scan on 2026-09-03
      // found **72** accents with this shape in the first slice it walked. The
      // defect was common and invisible, because every existing case here uses
      // an accent whose answer happens to round the harmless way.
      declareTokens('#0068d8');
      render(<Button label={SAVE} variant="primary" />);
      const button = screen.getByRole('button', { name: 'Save' });

      await vi.waitFor(() => {
        expect(button.style.color).not.toBe('');
      });

      const applied = channels(button.style.color);
      const accent = channels('#0068d8');
      if (applied === null || accent === null) throw new Error('a colour did not parse');
      // ASSERTED ON WHAT THE ELEMENT CARRIES, parsed back out of the style,
      // because that is the colour a browser paints. Asserting on the solver's
      // answer is exactly the mistake this case exists for.
      expect(contrast(applied, accent)).toBeGreaterThanOrEqual(4.5);
    });

    it('reads the tokens at the control, not at the document root', async () => {
      // THE TWO READ SITES ARE MADE TO DISAGREE, which is the only way a case
      // can tell them apart. The root says the fill is nearly black, where the
      // near-white `--text` already clears 4.5 and the solve returns it
      // unchanged; the control says the fill is the brand green, where `--text`
      // measures ~1.8:1 and the solve must darken. A fixture where both sites
      // carried the same value would pass whichever site the hook read — the
      // defect and the fix producing one output, which is no case at all.
      document.documentElement.style.setProperty('--text', '#e7eaec');
      document.documentElement.style.setProperty('--accent', '#10243a');
      declareTokens('#2fb96a');

      render(<Button label={SAVE} variant="primary" />);
      const button = screen.getByRole('button', { name: 'Save' });
      await vi.waitFor(() => {
        expect(button.style.color).not.toBe('');
      });

      const applied = channels(button.style.color);
      const rootFill = channels('#10243a');
      const controlFill = channels('#2fb96a');
      if (applied === null || rootFill === null || controlFill === null) {
        throw new Error('a fixture colour did not parse');
      }

      // Solved against the control's fill, so it clears there.
      expect(contrast(applied, controlFill)).toBeGreaterThanOrEqual(4.5);

      // And it is NOT what a root-side read would have produced. Asserting the
      // negative as well, because "clears against the control" is also true of
      // some colours a root read could return by luck.
      expect(applied).not.toEqual(channels('#e7eaec'));
      expect(contrast(channels('#e7eaec') ?? [0, 0, 0], rootFill)).toBeGreaterThanOrEqual(4.5);

      document.documentElement.removeAttribute('style');
    });

    it('applies no colour when the tokens cannot be read, rather than guessing', () => {
      // No `declareTokens()`. An unresolvable token is a defect to see; a
      // hard-coded black would hide it behind something that looks deliberate.
      render(<Button label={SAVE} variant="primary" />);
      expect(screen.getByRole('button', { name: 'Save' }).style.color).toBe('');
    });

    it('leaves the default variant to the stylesheet', () => {
      declareTokens();
      render(<Button label={SAVE} />);
      // The default variant sits on `--surface`, which `--text` is declared
      // against in tokens.css and checked by `check:tokencontrast`. Solving it
      // again here would be a second opinion about a pair that already has an
      // authority (B3a).
      expect(screen.getByRole('button', { name: 'Save' }).style.color).toBe('');
    });
  });
});
