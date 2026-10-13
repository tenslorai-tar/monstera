// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import InsertImagesBody from './InsertImagesBody.js';
import { InDialog } from './inDialog.js';
import { INSERT_IMAGES_RESULT } from './insertImagesResult.js';

/** The insert-images dialog (O3): where, by the one placement row, then *Choose images…*. */
afterEach(() => {
  cleanup();
});

function opened(): { readonly resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  render(
    <InDialog>
      <InsertImagesBody pageCount={9} page={3} resolve={resolve} update={vi.fn()} />
    </InDialog>,
  );
  return { resolve };
}

const choose = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Choose images…' }));
};

describe('InsertImagesBody', () => {
  it('OPENS AFTER THE PAGE ON SHOW, and says what Choose images does before it does it', () => {
    const { resolve } = opened();
    expect(screen.getByText(/Each image becomes a page, in the order of the file names/u)).toBeTruthy();
    choose();
    expect(INSERT_IMAGES_RESULT.parse(resolve.mock.calls[0]?.[0])).toStrictEqual({ at: 4 });
  });

  it('BEFORE PAGE 2 is position 1 — CONTROL for the default above', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Before' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Page number' }), { target: { value: '2' } });
    choose();
    expect(INSERT_IMAGES_RESULT.parse(resolve.mock.calls[0]?.[0])).toStrictEqual({ at: 1 });
  });

  it('a page this document lacks is SAID on the press and nothing is answered', () => {
    const { resolve } = opened();
    fireEvent.change(screen.getByRole('textbox', { name: 'Page number' }), { target: { value: '12' } });
    choose();
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a page of this document, from 1 to 9.')).toBeTruthy();
  });
});
