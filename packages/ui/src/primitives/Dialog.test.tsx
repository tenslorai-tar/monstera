// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { messageKey } from '@monstera/shared';
import { render as renderBare, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { Button } from './Button.js';
import { Dialog } from './Dialog.js';

/**
 * `closeLabel` travels to `IconButton` as a KEY and is resolved there, so this
 * file exercises the one property that shape has: a key handed to a child is
 * resolved once, by the control that renders it, rather than twice.
 */
const TITLE = messageKey('dialog.rename.title');
const CLOSE = messageKey('action.close.label');
const CONFIRM = messageKey('action.confirm.label');
const OUTSIDE = messageKey('action.outside.label');
activateCatalogue('en', {
  [TITLE]: 'Rename document',
  [CLOSE]: 'Close',
  [CONFIRM]: 'Confirm',
  [OUTSIDE]: 'Outside',
});

function Messages({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function render(ui: ReactElement): ReturnType<typeof renderBare> {
  return renderBare(ui, { wrapper: Messages });
}

/** A dialog with something focusable inside it and something outside. */
function Harness({ onOpenChange = vi.fn() }: { onOpenChange?: () => void }): React.ReactElement {
  return (
    <>
      <Button label={OUTSIDE} />
      <Dialog closeLabel={CLOSE} onOpenChange={onOpenChange} open title={TITLE}>
        <Button label={CONFIRM} />
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('is named by its title', () => {
    render(<Harness />);
    // BY ROLE AND NAME. A popup that renders its title as an unassociated
    // heading looks identical on screen and is anonymous to a screen reader.
    expect(screen.getByRole('dialog', { name: 'Rename document' })).toBeDefined();
  });

  it('renders nothing when closed', () => {
    render(
      <Dialog closeLabel={CLOSE} onOpenChange={vi.fn()} open={false} title={TITLE}>
        <Button label={CONFIRM} />
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('carries a close control with an accessible name', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
  });

  it('asks to close when the close control is used', () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    screen.getByRole('button', { name: 'Close' }).click();

    // The ARGUMENT, not the call. A close control that reported `true` would
    // satisfy `toHaveBeenCalled` and leave the dialog open forever.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('asks to close on Escape', () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    const dialog = screen.getByRole('dialog', { name: 'Rename document' });
    dialog.focus();
    dialog.dispatchEvent(
      new globalThis.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  describe('the focus trap', () => {
    it('takes the rest of the document out of the accessibility tree', () => {
      render(<Harness />);

      // THE OBSERVABLE IS WHAT THE TRAP DID TO THE DOCUMENT, not a Tab
      // keypress. happy-dom implements no sequential focus navigation, so
      // dispatching Tab and asserting where focus went would assert nothing —
      // focus would simply not move, which is also what a working trap looks
      // like. That is the fixture the defect also satisfies, so it is not the
      // assertion.
      //
      // This is a stronger claim than it looks. `queryByRole` searches the
      // accessibility tree, so the outside button being unreachable BY NAME is
      // the same property a screen reader has: while the dialog is open, the
      // rest of the document does not exist.
      expect(screen.queryByRole('button', { name: 'Outside' })).toBeNull();

      const outside = screen.getByRole('button', { hidden: true, name: 'Outside' });
      const inert = outside.closest('[data-base-ui-inert]');
      expect(inert).not.toBeNull();
      expect(inert?.getAttribute('aria-hidden')).toBe('true');
    });

    it('leaves the dialog itself reachable', () => {
      render(<Harness />);
      const dialog = screen.getByRole('dialog', { name: 'Rename document' });

      // The separating half. "Everything is inert" and "the right things are
      // inert" produce the same result for the case above — an inert-the-whole-
      // tree bug would pass it — and only this one fails.
      expect(dialog.closest('[data-base-ui-inert]')).toBeNull();
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeDefined();
    });

    it('installs focus guards around the popup', () => {
      render(<Harness />);
      const guards = document.querySelectorAll('[data-base-ui-focus-guard]');
      expect(guards.length).toBeGreaterThanOrEqual(2);
    });

    /*
     * WHAT THE GUARDS CASE ABOVE DOES NOT SEPARATE, measured rather than
     * assumed: mutating `modal` to `false` leaves it green. Base UI installs the
     * guards either way, so their presence is evidence that the dialog is a
     * real Base UI popup — which is what would go red if someone re-derived one
     * from a div, the failure Rule 0 names — and it is NOT evidence that focus
     * is trapped.
     *
     * The only case in this file that the `modal` mutation reddens is the
     * accessibility-tree one. That is the trap's coverage here, and this note
     * is why the count of cases mentioning focus is not the measure of it.
     */

    it('moves focus into the dialog when it opens', async () => {
      render(<Harness />);
      const dialog = screen.getByRole('dialog', { name: 'Rename document' });
      // Asynchronous on purpose: Base UI moves initial focus after paint, so a
      // synchronous read is taken before the trap has acted and reports a
      // failure that is the harness's, not the component's.
      await vi.waitFor(() => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      });
    });
  });
});
