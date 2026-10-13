// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import InsertBlankPageBody, { blankPageCount } from './InsertBlankPageBody.js';
import { InDialog } from './inDialog.js';
import { INSERT_BLANK_PAGE_RESULT } from './insertBlankPageResult.js';

/**
 * The blank page dialog (O3): how many, and where by the one placement row, converted once to the zero-based position
 * the command sends. Every answer is read through the dialog's result schema.
 */
afterEach(() => {
  cleanup();
});

function opened(): { readonly resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  render(
    <InDialog>
      <InsertBlankPageBody pageCount={9} page={3} resolve={resolve} update={vi.fn()} />
    </InDialog>,
  );
  return { resolve };
}

const answered = (resolve: ReturnType<typeof vi.fn>): unknown => INSERT_BLANK_PAGE_RESULT.parse(resolve.mock.calls[0]?.[0]);
const insert = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
};
const howMany = (): HTMLElement => screen.getByRole('textbox', { name: 'How many pages' });

describe('InsertBlankPageBody', () => {
  it('OPENS ON ONE PAGE AFTER THE PAGE ON SHOW, which is what the command did before it asked — page 4 of 9 is position 4', () => {
    const { resolve } = opened();
    expect(howMany()).toHaveProperty('value', '1');
    expect(screen.getByRole('button', { name: 'After' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Page number' })).toHaveProperty('value', '4');
    insert();
    expect(answered(resolve)).toStrictEqual({ at: 4, count: 1 });
  });

  it('FIVE BEFORE THE FIRST PAGE is five at position 0 — CONTROL for the default above', () => {
    const { resolve } = opened();
    fireEvent.change(howMany(), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Before' }));
    fireEvent.click(screen.getByRole('button', { name: 'The first page' }));
    insert();
    expect(answered(resolve)).toStrictEqual({ at: 0, count: 5 });
  });

  it('AFTER THE LAST PAGE is the page count', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'The last page' }));
    insert();
    expect(answered(resolve)).toStrictEqual({ at: 9, count: 1 });
  });

  it('a count that is not a whole number from 1 to 100 is SAID on the press and nothing is answered', () => {
    const { resolve } = opened();
    fireEvent.change(howMany(), { target: { value: '0' } });
    insert();
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByText('Type a number of pages from 1 to 100.')).toBeTruthy();
  });

  it('blankPageCount takes 1 to 100 and refuses the rest — CONTROL: each edge is on the side it names', () => {
    expect(blankPageCount('1')).toBe(1);
    expect(blankPageCount(' 100 ')).toBe(100);
    expect(blankPageCount('101')).toBeUndefined();
    expect(blankPageCount('0')).toBeUndefined();
    expect(blankPageCount('2.5')).toBeUndefined();
    expect(blankPageCount('')).toBeUndefined();
  });
});
