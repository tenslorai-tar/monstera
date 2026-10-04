// @vitest-environment happy-dom
import { MAX_LINK_URI } from '@monstera/contract';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InDialog } from './inDialog.js';
import OpenFromUrlBody from './OpenFromUrlBody.js';

/**
 * *Open from web address*, under the rule `primitives/attempt.ts` names: what is typed being wrong is said at once,
 * and nothing typed only once the person presses the action (the owner, 2026-10-03).
 */
const EMPTY = 'Type the address of the PDF to open.';
const TOO_LONG = 'That address is too long.';
const SCHEME = 'Only secure addresses can be opened: start with https://.';
const APPLY = 'Open';

afterEach(() => {
  cleanup();
});

function opened(): { resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  render(
    <InDialog>
      <OpenFromUrlBody resolve={resolve} update={vi.fn()} />
    </InDialog>,
  );
  return { resolve };
}

function type(value: string): void {
  act(() => {
    fireEvent.change(screen.getByRole('textbox', { name: 'Address' }), { target: { value } });
  });
}

function press(): void {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: APPLY }));
  });
}

describe('Open from web address', () => {
  it('opens SAYING NOTHING, in one line, with its action enabled so that it can be pressed', () => {
    opened();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Address' }).tagName).toBe('INPUT');
    expect(screen.getByRole('button', { name: APPLY }).hasAttribute('disabled')).toBe(false);
  });

  it('says what is missing once the action is pressed with nothing typed, answers nothing, and puts the person back in the field', () => {
    const { resolve } = opened();
    press();
    expect(screen.getByRole('alert').textContent).toBe(EMPTY);
    expect(resolve).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Address' }));
  });

  it('CONTROL: answers a secure address as typed, the trim left to the result schema, and says nothing', () => {
    const { resolve } = opened();
    type(' https://example.com/report.pdf ');
    press();
    expect(resolve).toHaveBeenCalledWith({ text: ' https://example.com/report.pdf ' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says an address that is not https: is refused as soon as it is typed, and disables the action', () => {
    opened();
    type('http://example.com/report.pdf');
    expect(screen.getByRole('alert').textContent).toBe(SCHEME);
    expect(screen.getByRole('button', { name: APPLY }).hasAttribute('disabled')).toBe(true);
  });

  it('says what typed is TOO LONG past the channel’s bound, and not at it', () => {
    opened();
    const atBound = `https://example.com/${'a'.repeat(MAX_LINK_URI - 'https://example.com/'.length)}`;
    type(atBound);
    expect(screen.queryByRole('alert')).toBeNull();
    type(`${atBound}a`);
    expect(screen.getByRole('alert').textContent).toBe(TOO_LONG);
    expect(screen.getByRole('button', { name: APPLY }).hasAttribute('disabled')).toBe(true);
  });
});
