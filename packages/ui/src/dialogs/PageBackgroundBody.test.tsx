// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { colourFromHex } from '../annotations/annotationStyle.js';
import PageBackgroundBody from './PageBackgroundBody.js';
import { InDialog } from './inDialog.js';
import { PAGE_BACKGROUND_RESULT } from './pageBackground.js';
import { DEFAULT_PAGE_TINT, PAGE_TINTS } from './pageBackgroundColours.js';

/**
 * The dialog is finished the moment it opens: cream is chosen, every page is the scope, and *Add background* answers
 * that. What each case asserts is the answer, read through the dialog's own result schema, because the answer is the
 * only thing the command takes from the body.
 */
afterEach(() => {
  cleanup();
});

const rgb = (hex: string): { red: number; green: number; blue: number } => {
  const colour = colourFromHex(hex);
  if (colour === undefined) throw new Error(`not a colour: ${hex}`);
  const [red, green, blue] = colour;
  return { red, green, blue };
};

const blue = PAGE_TINTS.find((tint) => tint.hex === '#d9e8f7')?.hex ?? '';

describe('PageBackgroundBody', () => {
  it('OPENS ON CREAM FOR EVERY PAGE, and answers that unchanged', () => {
    const resolve = vi.fn();
    render(
      <InDialog>
        <PageBackgroundBody pages={[2]} resolve={resolve} update={vi.fn()} />
      </InDialog>,
    );

    expect(screen.getByRole('button', { name: 'Cream' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'All pages' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Add background' }));

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(PAGE_BACKGROUND_RESULT.parse(resolve.mock.calls[0]?.[0])).toStrictEqual({
      pages: 'all',
      ...rgb(DEFAULT_PAGE_TINT),
    });
  });

  it('A SWATCH AND THE SCOPE CHANGE THE ANSWER, so the opening answer is not a constant', () => {
    // THE CONTROL FOR THE CASE ABOVE: a body that always answered cream for every page passes it and fails this.
    const resolve = vi.fn();
    render(
      <InDialog>
        <PageBackgroundBody pages={[2]} resolve={resolve} update={vi.fn()} />
      </InDialog>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pale blue' }));
    fireEvent.click(screen.getByRole('button', { name: 'This page' }));
    expect(screen.getByRole('button', { name: 'Pale blue' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Cream' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Add background' }));

    expect(PAGE_BACKGROUND_RESULT.parse(resolve.mock.calls[0]?.[0])).toStrictEqual({ pages: [2], ...rgb(blue) });
  });

  it('A CUSTOM COLOUR IS ANSWERED, and no swatch reads as chosen beside it', () => {
    const resolve = vi.fn();
    render(
      <InDialog>
        <PageBackgroundBody pages={[0]} resolve={resolve} update={vi.fn()} />
      </InDialog>,
    );

    fireEvent.change(screen.getByLabelText('Custom colour'), { target: { value: '#123456' } });
    expect(screen.getByRole('button', { name: 'Cream' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Add background' }));

    expect(PAGE_BACKGROUND_RESULT.parse(resolve.mock.calls[0]?.[0])).toStrictEqual({
      pages: 'all',
      ...rgb('#123456'),
    });
  });
});
