// @vitest-environment happy-dom
import { channels, contrast } from '@monstera/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from './Button.js';

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
function declareTokens(): void {
  document.documentElement.style.setProperty('--text', '#e7eaec');
  document.documentElement.style.setProperty('--accent', '#2fb96a');
}

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

describe('Button', () => {
  it('renders its label as the accessible name', () => {
    render(<Button label="Save" />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
  });

  it('calls onClick when activated', () => {
    const onClick = vi.fn();
    render(<Button label="Save" onClick={onClick} />);
    screen.getByRole('button', { name: 'Save' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled label="Save" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.hasAttribute('disabled')).toBe(true);
    button.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is reachable and activatable from the keyboard', () => {
    render(<Button label="Save" />);
    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();
    expect(document.activeElement).toBe(button);
    // A native <button> is what makes Enter and Space work without a handler,
    // which is why the primitive renders one rather than a div with a role.
    expect(button.tagName).toBe('BUTTON');
  });

  it('defaults to type=button, so it cannot submit a form it did not mean to', () => {
    render(<Button label="Save" />);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('type')).toBe('button');
  });

  describe('the primary variant computes its foreground', () => {
    it('applies a colour that clears 4.5:1 against the fill in effect', async () => {
      declareTokens();
      render(<Button label="Save" variant="primary" />);
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
      render(<Button label="Save" variant="primary" />);
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
      render(<Button label="Save" variant="primary" />);
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
      document.documentElement.style.setProperty('--accent', '#10243a');
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

    it('applies no colour when the tokens cannot be read, rather than guessing', () => {
      // No `declareTokens()`. An unresolvable token is a defect to see; a
      // hard-coded black would hide it behind something that looks deliberate.
      render(<Button label="Save" variant="primary" />);
      expect(screen.getByRole('button', { name: 'Save' }).style.color).toBe('');
    });

    it('leaves the default variant to the stylesheet', () => {
      declareTokens();
      render(<Button label="Save" />);
      // The default variant sits on `--surface`, which `--text` is declared
      // against in tokens.css and checked by `check:tokencontrast`. Solving it
      // again here would be a second opinion about a pair that already has an
      // authority (B3a).
      expect(screen.getByRole('button', { name: 'Save' }).style.color).toBe('');
    });
  });
});
