// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import InsertMarkdownBody from './InsertMarkdownBody.js';
import { InDialog } from './inDialog.js';
import { INSERT_MARKDOWN_RESULT } from './insertMarkdownResult.js';

/**
 * Insert from Markdown's own rules: at the start, at the end or after a page, converted once to the zero-based position
 * the command sends. Every answer is read through the dialog's result schema.
 */
afterEach(() => {
  cleanup();
});

function opened(props: Partial<Parameters<typeof InsertMarkdownBody>[0]> = {}): { readonly resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  render(
    <InDialog>
      <InsertMarkdownBody pageCount={9} page={3} resolve={resolve} update={vi.fn()} {...props} />
    </InDialog>,
  );
  return { resolve };
}

const answered = (resolve: ReturnType<typeof vi.fn>): unknown => INSERT_MARKDOWN_RESULT.parse(resolve.mock.calls[0]?.[0]);
const choose = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }));
};

describe('InsertMarkdownBody', () => {
  it('OPENS AT THE END, after the last page, which is where the command always put the pages, and sends the page count', () => {
    const { resolve } = opened();
    expect(screen.getByRole('button', { name: 'After' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'The last page' }).getAttribute('aria-pressed')).toBe('true');
    choose();
    expect(answered(resolve)).toStrictEqual({ at: 9, family: 'Arimo' });
  });

  it('BEFORE THE FIRST PAGE is position 0 — the control for the end above, which is the page count', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Before' }));
    fireEvent.click(screen.getByRole('button', { name: 'The first page' }));
    choose();
    expect(answered(resolve)).toStrictEqual({ at: 0, family: 'Arimo' });
  });

  it('AFTER PAGE N is N, counted from 1 on screen: after page 3 is 3', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Page' }));
    // THE PAGE ON SHOW, one-based, is what the field starts on: zero-based 3 is page 4.
    expect(screen.getByRole('textbox', { name: 'Page number' })).toHaveProperty('value', '4');
    fireEvent.change(screen.getByRole('textbox', { name: 'Page number' }), { target: { value: '3' } });
    choose();
    expect(answered(resolve)).toStrictEqual({ at: 3, family: 'Arimo' });
  });

  it('ANSWERS THE FONT PICKED in the one picker, from the computer’s list main handed it (D1) — CONTROL: the cases above answer the default', () => {
    const fonts = {
      listed: true,
      families: [{ name: 'Tinos', origin: 'bundled' as const, embedding: 'subset' as const, bold: true, italic: true, looksLike: 'Times New Roman' }],
      more: 0,
    };
    const { resolve } = opened({ fonts });
    fireEvent.click(screen.getByRole('button', { name: 'Font: Arimo' }));
    const tinos = document.querySelector('[data-font-choice="Tinos"]');
    if (tinos === null) throw new Error('Tinos, from the list main handed the dialog, is not offered');
    fireEvent.click(tinos);
    choose();
    expect(answered(resolve)).toStrictEqual({ at: 9, family: 'Tinos' });
  });

  it('a page this document lacks is SAID on the press and nothing is answered — CONTROL: the page field is not shown for the first or the last page', () => {
    const { resolve } = opened();
    expect(screen.queryByRole('textbox', { name: 'Page number' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Page' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Page number' }), { target: { value: '10' } });
    choose();
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a page of this document, from 1 to 9.')).toBeTruthy();
  });
});
