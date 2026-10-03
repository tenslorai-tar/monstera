// @vitest-environment happy-dom
import { MAX_ANNOTATION_TEXT } from '@monstera/contract';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AnnotationNoteBody from './AnnotationNoteBody.js';
import { InDialog } from './inDialog.js';

/**
 * The shared text form, under the rule `primitives/attempt.ts` names: what is typed being wrong is said at once, and
 * nothing typed only once the person presses the action (the owner, 2026-10-03). Its dialogs used to open with
 * *"Type the comment this note should hold."* under a field nobody had had a chance to fill.
 */
const EMPTY = 'Type the comment this note should hold.';
const TOO_LONG = 'That is too long for one note. Shorten it, or use several.';

afterEach(() => {
  cleanup();
});

function note(): { resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  render(
    <InDialog>
      <AnnotationNoteBody resolve={resolve} update={vi.fn()} />
    </InDialog>,
  );
  return { resolve };
}

describe('the annotation text form', () => {
  it('opens SAYING NOTHING, with its action enabled so that it can be pressed', () => {
    note();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add note' }).hasAttribute('disabled')).toBe(false);
  });

  it('says what is missing once the action is pressed with nothing typed, answers nothing, and puts the person back in the field', () => {
    const { resolve } = note();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    });
    expect(screen.getByRole('alert').textContent).toBe(EMPTY);
    expect(resolve).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Comment' }));
  });

  it('CONTROL: answers once something is typed, and says nothing', () => {
    const { resolve } = note();
    act(() => {
      fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: 'Check the totals.' } });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    });
    expect(resolve).toHaveBeenCalledWith({ text: 'Check the totals.' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says what typed is TOO LONG as soon as it is typed, before any press, and disables the action', () => {
    note();
    act(() => {
      fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: 'x'.repeat(MAX_ANNOTATION_TEXT + 1) } });
    });
    expect(screen.getByRole('alert').textContent).toBe(TOO_LONG);
    expect(screen.getByRole('button', { name: 'Add note' }).hasAttribute('disabled')).toBe(true);
  });
});
