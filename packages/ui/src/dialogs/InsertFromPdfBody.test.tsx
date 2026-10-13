// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import InsertFromPdfBody from './InsertFromPdfBody.js';
import { InDialog } from './inDialog.js';
import { INSERT_FROM_PDF_RESULT } from './insertFromPdfResult.js';

/**
 * Insert from PDF's own rules: which source pages, before or after which page of this document, converted once to the
 * zero-based position the command sends. Every answer is read through the dialog's result schema. Where the pages go is
 * the one placement row every inserting dialog takes (`PagePlacement.tsx`, the owner's O3).
 */
afterEach(() => {
  cleanup();
});

const ALPHA = { docId: 'd-a', name: 'Alpha.pdf', pageCount: 6 };

function opened(props: Partial<Parameters<typeof InsertFromPdfBody>[0]> = {}): { readonly resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  render(
    <InDialog>
      <InsertFromPdfBody choices={[ALPHA]} pageCount={9} page={3} resolve={resolve} update={vi.fn()} {...props} />
    </InDialog>,
  );
  return { resolve };
}

const answered = (resolve: ReturnType<typeof vi.fn>): unknown => INSERT_FROM_PDF_RESULT.parse(resolve.mock.calls[0]?.[0]);
const insert = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
};
const pageNumber = (): HTMLElement => screen.getByRole('textbox', { name: 'Page number' });

describe('InsertFromPdfBody', () => {
  it('OPENS AFTER THE PAGE ON SHOW with every source page, and sends that page as the position', () => {
    // PAGE 4 ON SHOW (zero-based 3): after it is zero-based 4.
    const { resolve } = opened();
    expect(screen.getByText('6 pages')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'After' }).getAttribute('aria-pressed')).toBe('true');
    expect(pageNumber()).toHaveProperty('value', '4');
    insert();
    expect(answered(resolve)).toStrictEqual({ kind: 'insert', source: 'd-a', sourcePages: 'all', at: 4 });
  });

  it('BEFORE the page typed is one place earlier — the control for the case above', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Before' }));
    fireEvent.change(pageNumber(), { target: { value: '1' } });
    insert();
    expect(answered(resolve)).toStrictEqual({ kind: 'insert', source: 'd-a', sourcePages: 'all', at: 0 });
  });

  it('AFTER THE LAST PAGE is the one position past the end, typed or chosen; BEFORE THE FIRST is the start', () => {
    const typed = opened();
    fireEvent.change(pageNumber(), { target: { value: '9' } });
    insert();
    expect(answered(typed.resolve)).toStrictEqual({ kind: 'insert', source: 'd-a', sourcePages: 'all', at: 9 });
    cleanup();
    const last = opened();
    fireEvent.click(screen.getByRole('button', { name: 'The last page' }));
    insert();
    expect(answered(last.resolve)).toStrictEqual({ kind: 'insert', source: 'd-a', sourcePages: 'all', at: 9 });
    cleanup();
    const first = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Before' }));
    fireEvent.click(screen.getByRole('button', { name: 'The first page' }));
    insert();
    expect(answered(first.resolve)).toStrictEqual({ kind: 'insert', source: 'd-a', sourcePages: 'all', at: 0 });
  });

  it('CHOSEN SOURCE PAGES are answered, and a page this document lacks is said on the press', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Select pages' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '2-3' } });
    fireEvent.change(pageNumber(), { target: { value: '10' } });
    insert();
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Choose a page of this document, from 1 to 9.');

    fireEvent.change(pageNumber(), { target: { value: '2' } });
    insert();
    expect(answered(resolve)).toStrictEqual({ kind: 'insert', source: 'd-a', sourcePages: [1, 2], at: 2 });
  });

  it('CHOOSE FILE answers every entry, and a draft reopens with them', () => {
    const first = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Before' }));
    fireEvent.change(pageNumber(), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }));
    const draft = { sourcePages: { every: true, text: '' }, placement: { side: 'before', page: 'page', typed: '7' } } as const;
    expect(answered(first.resolve)).toStrictEqual({ kind: 'choose-file', draft });
    cleanup();

    const again = opened({ draft });
    insert();
    expect(answered(again.resolve)).toStrictEqual({ kind: 'insert', source: 'd-a', sourcePages: 'all', at: 6 });
  });
});
