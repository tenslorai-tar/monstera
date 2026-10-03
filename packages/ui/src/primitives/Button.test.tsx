// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { channels, contrast, messageKey } from '@monstera/shared';
import { render as renderBare, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
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
const OPEN_FILE = messageKey('dialog.cloud.open');
const OPEN = messageKey('dialog.cloud.open-shown');
activateCatalogue('en', { [SAVE]: 'Save', [OPEN_FILE]: 'Open {name}', [OPEN]: 'Open' });

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
function declareTokens(accent = '#2fb96a', bottom = accent): void {
  // A STYLESHEET RULE THAT MATCHES THE CONTROL, not properties set on the root.
  // `useOnColor` reads at the element, because §10.2 remaps tokens under
  // `data-*` attributes and `tokens.css` writes those selectors unqualified, so
  // a token may carry a different value below the root. Declaring them here the
  // way the real cascade does is what keeps the harness from quietly testing a
  // different read site than the one that ships.
  //
  // THE FILL IS THE GRADIENT'S TWO ENDS, which is what `.m-button--primary` paints; one value for both unless a case
  // needs them apart.
  const sheet = document.createElement('style');
  sheet.dataset['fixture'] = 'tokens';
  sheet.textContent = `.m-button { --text: #e7eaec; --accent-grad-top: ${accent}; --accent-grad-bottom: ${bottom}; }`;
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

  it('SHOWS its shorter words where given, and keeps the whole label as its name', () => {
    render(<Button label={OPEN_FILE} shown={OPEN} values={{ name: 'lease.pdf' }} />);
    const button = screen.getByRole('button', { name: 'Open lease.pdf' });
    // What a sighted person reads is the one part not hidden from the eye; the name is the hidden part.
    expect(button.querySelector('[aria-hidden]')?.textContent).toBe('Open');
    expect(button.querySelector('.m-visually-hidden')?.textContent).toBe('Open lease.pdf');
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

  it('ICON ONLY keeps the label as the name and the tooltip, and shows no words (ADR-0113)', () => {
    render(<Button label={SAVE} icon="Heart" iconOnly />);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('title')).toBe('Save');
    expect(button.className).toContain('m-button--icon-only');
    expect(button.querySelector('.m-visually-hidden')?.textContent).toBe('Save');
  });

  it('CONTROL: icon only with NO icon draws its words, since a blank button would be nothing to see', () => {
    render(<Button label={SAVE} iconOnly />);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('title')).toBeNull();
    expect(button.querySelector('.m-visually-hidden')).toBeNull();
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

      // `useOnColor` solves in a layout effect; the wait is for the render, not for a later frame.
      await vi.waitFor(() => {
        expect(button.style.color).not.toBe('');
      });

      const applied = channels(button.style.color);
      const accent = channels('#2fb96a');
      if (applied === null || accent === null) throw new Error('a colour did not parse');
      expect(contrast(applied, accent)).toBeGreaterThanOrEqual(4.5);
    });

    it('has its colour BEFORE THE FIRST PAINT: it is on the element when the commit that inserts it ends', async () => {
      // A default-priority render commits in one task: DOM insertion, then layout effects, synchronously; passive
      // effects are scheduled for a LATER task, after which the browser may already have painted. The observer's
      // callback is a microtask queued by the insertion, so it runs when the commit task ends and before any later
      // one — it reads what the first paint shows. (`act` and `flushSync` both flush passive effects too, so neither
      // can separate the two.) A colour solved in a passive effect was drawn once in the stylesheet's unchecked ink.
      declareTokens();
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      const seen = new Promise<string | undefined>((answer) => {
        const observer = new MutationObserver(() => {
          const button = container.querySelector('button');
          if (button === null) return;
          observer.disconnect();
          answer(button.style.color);
        });
        observer.observe(container, { childList: true, subtree: true });
      });
      try {
        root.render(
          <Messages>
            <Button label={SAVE} variant="primary" />
          </Messages>,
        );
        expect(await seen).not.toBe('');
      } finally {
        root.unmount();
        container.remove();
      }
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

    it('solves NOTHING while disabled, so the stylesheet draws a disabled button', async () => {
      // An inline colour beats every stylesheet rule, including `.m-button:disabled`, and the fill
      // stayed the accent — so a disabled primary rendered exactly as an enabled one. The Assistant's
      // Send with no key stored looked ready to press.
      declareTokens();
      const { rerender } = render(<Button label={SAVE} variant="primary" />);
      const button = screen.getByRole('button', { name: 'Save' });
      // Waiting for the solve first is what makes the next wait mean something: an empty colour
      // before any effect has run is also what a component that never cleared it would show.
      await vi.waitFor(() => {
        expect(button.style.color).not.toBe('');
      });

      rerender(<Button disabled label={SAVE} variant="primary" />);
      await vi.waitFor(() => {
        expect(button.style.color).toBe('');
      });
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

    it('solves to 7:1 under the HIGH-CONTRAST theme, and to 4.5:1 under an ordinary one', async () => {
      // THE FLOOR IS THE THEME'S, not the call site's (ADR-0003, corrected 2026-09-16).
      // `Button` asks for `'text'` rather than a number, and `useOnColor` reads the theme
      // in force at the control — so this case is what separates the two floors, and the
      // live run that produced the correction measured the shipped label at 4.69:1 in
      // high contrast, which is above 4.5 and below 7.
      declareTokens();
      document.documentElement.setAttribute('data-theme', 'hc');
      render(<Button label={SAVE} variant="primary" />);
      const button = screen.getByRole('button', { name: 'Save' });
      await vi.waitFor(() => {
        expect(button.style.color).not.toBe('');
      });

      const accent = channels('#2fb96a');
      const underHighContrast = channels(button.style.color);
      if (accent === null || underHighContrast === null) throw new Error('a colour did not parse');
      expect(contrast(underHighContrast, accent)).toBeGreaterThanOrEqual(7);

      // THE CONTROL, and it is the half that makes the assertion above mean anything: the
      // same fixture under an ordinary theme must clear 4.5 and NOT reach 7. A hook that
      // solved everything at 7 would satisfy the first assertion and fail here, which is
      // ADR-0003's first rejected alternative — raising the floor in every theme.
      document.documentElement.setAttribute('data-theme', 'light');
      await vi.waitFor(() => {
        const ordinary = channels(button.style.color);
        if (ordinary === null) throw new Error('a colour did not parse');
        expect(contrast(ordinary, accent)).toBeLessThan(7);
      });
      const ordinary = channels(button.style.color);
      if (ordinary === null) throw new Error('a colour did not parse');
      expect(contrast(ordinary, accent)).toBeGreaterThanOrEqual(4.5);
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
      document.documentElement.style.setProperty('--accent-grad-top', '#10243a');
      document.documentElement.style.setProperty('--accent-grad-bottom', '#10243a');
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

    it('clears BOTH ends of the gradient it is painted on, not only the top', async () => {
      // ENDS THE STARTING TEXT CLEARS ONE OF AND FAILS THE OTHER, in both orders — so a solve that read only the top
      // keeps the text in one order and a solve that read only the bottom keeps it in the other. The light theme's
      // label was the first: solved against `--accent`, which is lighter than both of its ends (the stage audit of
      // 1e1bfad..e24eca0e). These ARE light's two ends, and white clears both, so a solve exists.
      const text = channels('#e7eaec');
      for (const [top, bottom] of [
        ['#15803d', '#116631'],
        ['#116631', '#15803d'],
      ] as const) {
        declareTokens(top, bottom);
        const { unmount } = render(<Button label={SAVE} variant="primary" />);
        const button = screen.getByRole('button', { name: 'Save' });
        await vi.waitFor(() => {
          expect(button.style.color).not.toBe('');
        });

        const applied = channels(button.style.color);
        const ends = [channels(top), channels(bottom)];
        if (applied === null || text === null || ends[0] === null || ends[1] === null) {
          throw new Error('a colour did not parse');
        }
        for (const end of ends) expect(contrast(applied, end ?? [0, 0, 0]), top).toBeGreaterThanOrEqual(4.5);
        // THE CONTROL: the starting text is readable on one end and not on the other, which is what makes each order
        // catch a one-ended read.
        expect(ends.map((end) => contrast(text, end ?? [0, 0, 0]) >= 4.5).sort()).toStrictEqual([false, true]);
        unmount();
        for (const sheet of document.querySelectorAll('style[data-fixture="tokens"]')) sheet.remove();
      }
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

  // EVERY BRAND TONE IS A FILL (the owner's decision, 2026-10-01): each draws through `.m-button--tone` and has its label
  // solved against `--tone-top` and `--tone-bottom`, starting from `--tone-label`. The stylesheet maps a tone's class to
  // those three; happy-dom does not substitute a `var()` inside a custom property, so the fixture declares them direct.
  describe('every brand tone is a fill whose label is solved', () => {
    // A LABEL THAT FAILS ITS FILL: the dark theme's violet label on a mid violet, 2.8:1. A tone drawn as an outline,
    // or one that skipped the solve, would keep this colour — so the case separates the two from a solved fill.
    const label = '#160b33';
    const ends = ['#6d28d9', '#5b21b6'] as const;
    const declareTone = (): void => {
      const sheet = document.createElement('style');
      sheet.dataset['fixture'] = 'tokens';
      sheet.textContent = `.m-button { --tone-label: ${label}; --tone-top: ${ends[0]}; --tone-bottom: ${ends[1]}; }`;
      document.head.append(sheet);
    };

    for (const variant of ['gold', 'violet'] as const) {
      it(`${variant} draws through the shared tone rule and clears 4.5:1 on both stops`, async () => {
        declareTone();
        render(<Button label={SAVE} variant={variant} />);
        const button = screen.getByRole('button', { name: 'Save' });
        expect(button.className).toContain('m-button--tone');
        expect(button.className).toContain(`m-button--${variant}`);

        await vi.waitFor(() => {
          expect(button.style.color).not.toBe('');
        });
        const applied = channels(button.style.color);
        const started = channels(label);
        const stops = ends.map((end) => channels(end));
        if (applied === null || started === null || stops.some((stop) => stop === null)) {
          throw new Error('a colour did not parse');
        }
        for (const stop of stops) expect(contrast(applied, stop ?? [0, 0, 0])).toBeGreaterThanOrEqual(4.5);
        // THE CONTROL: the label it started from fails both stops, so passing above means it was solved.
        for (const stop of stops) expect(contrast(started, stop ?? [0, 0, 0])).toBeLessThan(4.5);
      });
    }

    it('CONTROL: the outlined and plain variants are not tones, and a disabled tone solves nothing', async () => {
      declareTone();
      const { rerender } = render(<Button label={SAVE} />);
      const button = screen.getByRole('button', { name: 'Save' });
      expect(button.className).not.toContain('m-button--tone');
      rerender(<Button label={SAVE} variant="primary" />);
      expect(button.className).not.toContain('m-button--tone');

      rerender(<Button label={SAVE} variant="violet" />);
      await vi.waitFor(() => {
        expect(button.style.color).not.toBe('');
      });
      rerender(<Button disabled label={SAVE} variant="violet" />);
      await vi.waitFor(() => {
        expect(button.style.color).toBe('');
      });
    });
  });
});
