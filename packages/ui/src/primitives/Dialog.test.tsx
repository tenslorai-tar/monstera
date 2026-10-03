// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { messageKey } from '@monstera/shared';
import { act, render as renderBare, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { DIALOG_CANCEL } from '../messages/en.js';
import { Button } from './Button.js';
import { Dialog, DialogChoices, DialogFooter, DialogRow } from './Dialog.js';

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

  it('is NOT closed by the click that ends a press begun before it opened, and IS by a press begun after', async () => {
    // A dialog opened on a pointer-up — a drawn text box — was closed by the `click` that ends that same press:
    // Base UI's `intentional` dismissal asks only whether the press started inside the popup (measured 2026-10-03,
    // reason `outside-press` on a `click` 1 ms after the `mouseup`).
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    await screen.findByRole('dialog', { name: 'Rename document' });
    const outside = document.body;
    outside.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await new Promise((settle) => setTimeout(settle, 0));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    // CONTROL: a whole press outside, begun while the dialog is open, still closes it.
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      outside.dispatchEvent(
        type.startsWith('pointer')
          ? new PointerEvent(type, { bubbles: true, button: 0, pointerType: 'mouse' })
          : new MouseEvent(type, { bubbles: true, button: 0 }),
      );
    }
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('opens ON ITS FIRST TEXT FIELD when its body has one, in the commit that opens it', () => {
    // A text box, a typewriter and a note opened with focus on the popup, so typing went nowhere (the owner's review).
    render(
      <Dialog closeLabel={CLOSE} onOpenChange={vi.fn()} open title={TITLE}>
        <input aria-label="first" type="checkbox" />
        <input aria-label="words" type="text" />
      </Dialog>,
    );
    // NOT AFTER A FRAME: read synchronously after the render, where Base UI's own initial focus would come later.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('words');
  });

  it('LEAVES FOCUS WHERE THE PERSON PUT IT when the dialog renders again', () => {
    // The opening focus is a ref callback, and one whose identity changed would run on every render, pulling focus back
    // to the first field from the second while the person typed there.
    const dialog = (key: string): ReactElement => (
      <Dialog closeLabel={CLOSE} onOpenChange={() => undefined} open title={TITLE}>
        <input aria-label="first" data-render={key} type="text" />
        <input aria-label="second" type="text" />
      </Dialog>
    );
    const { rerender } = render(dialog('one'));
    act(() => {
      screen.getByRole('textbox', { name: 'second' }).focus();
    });
    rerender(dialog('two'));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('second');
  });

  it('CONTROL: a dialog with no text field opens on the popup, not on its Close button', async () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: 'Rename document' });
    await waitFor(() => {
      expect(document.activeElement).toBe(dialog);
    });
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

  it('closes on the FIRST Escape pressed WHERE FOCUS LANDS when it opens', async () => {
    // THE SEPARATING FIXTURE is the element focus actually moved to, read back — not one the case chose. The case above
    // focuses the popup and fires at it, which a real open never did before 2026-09-15: focus landed on the Close
    // button, whose tooltip swallowed the first Escape, and that case passed throughout.
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
    });
    const landed = document.activeElement;
    if (!(landed instanceof HTMLElement)) throw new Error('focus landed on an element');
    landed.dispatchEvent(new globalThis.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
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

describe('the dialog pattern', () => {
  const QUESTION = messageKey('dialog.pattern-test.question');
  const QUESTION_NOTE = messageKey('dialog.pattern-test.question-note');
  const FIRST = messageKey('dialog.pattern-test.first');
  const FIRST_NOTE = messageKey('dialog.pattern-test.first-note');
  const SECOND = messageKey('dialog.pattern-test.second');
  const SECOND_NOTE = messageKey('dialog.pattern-test.second-note');
  activateCatalogue('en', {
    [TITLE]: 'Rename document',
    [CLOSE]: 'Close',
    [CONFIRM]: 'Confirm',
    [OUTSIDE]: 'Outside',
    [DIALOG_CANCEL]: 'Cancel',
    [QUESTION]: 'What to keep',
    [QUESTION_NOTE]: 'How much of the page',
    [FIRST]: 'Everything',
    [FIRST_NOTE]: 'Text and pictures',
    [SECOND]: 'Words',
    [SECOND_NOTE]: 'Only the text',
  });

  it("the footer's Cancel closes exactly as the header's close control does, and confirms nothing", () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <Dialog closeLabel={CLOSE} onOpenChange={onOpenChange} open title={TITLE}>
        <DialogFooter>
          <Button label={CONFIRM} onClick={onConfirm} />
        </DialogFooter>
      </Dialog>,
    );
    screen.getByRole('button', { name: 'Cancel' }).click();
    // THE ARGUMENT, for the close control's reason above; and the action beside it untouched, because a Cancel that
    // also ran the action would pass the first assertion.
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('choices are one group named by the question, checked as the value says, and a choice reports its value', () => {
    const onChange = vi.fn();
    render(
      <DialogChoices<'first' | 'second'>
        label={QUESTION}
        note={QUESTION_NOTE}
        onChange={onChange}
        options={[
          { value: 'first', label: FIRST, note: FIRST_NOTE },
          { value: 'second', label: SECOND, note: SECOND_NOTE },
        ]}
        value="first"
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'What to keep How much of the page' })).toBeDefined();
    const first = screen.getByRole<HTMLInputElement>('radio', { name: 'Everything Text and pictures' });
    const second = screen.getByRole<HTMLInputElement>('radio', { name: 'Words Only the text' });
    expect([first.checked, second.checked]).toEqual([true, false]);
    second.click();
    expect(onChange).toHaveBeenCalledWith('second');
  });

  it("a row's two children are its text part, holding the question then the note, and its control part, holding the control under its own name", () => {
    // THE STRUCTURE THE ROW'S FLEX RULE LAYS OUT SIDE BY SIDE, not the layout: happy-dom measures nothing, and no
    // rendered case measures `.m-dialog-row` today.
    const { container } = render(
      <DialogRow label={QUESTION} note={QUESTION_NOTE}>
        <Button label={CONFIRM} />
      </DialogRow>,
    );
    const row = container.querySelector('.m-dialog-row');
    if (row === null) throw new Error('no dialog row');
    const [text, control] = [...row.children];
    expect([...row.children].map((child) => child.className)).toStrictEqual(['m-dialog-row__text', 'm-dialog-row__control']);
    expect([...(text?.children ?? [])].map((child) => [child.className, child.textContent])).toStrictEqual([
      ['m-dialog-row__label', 'What to keep'],
      ['m-dialog-row__note', 'How much of the page'],
    ]);
    expect(control?.contains(screen.getByRole('button', { name: 'Confirm' }))).toBe(true);
  });
});
