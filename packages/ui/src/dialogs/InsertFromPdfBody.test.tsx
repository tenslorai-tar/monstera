// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import InsertFromPdfBody from './InsertFromPdfBody.js';
import { InDialog } from './inDialog.js';
import { INSERT_FROM_PDF_RESULT } from './insertFromPdfResult.js';

/**
 * Insert from PDF's own rules: which source pages, before or after which page of this document, converted once to the
 * zero-based position the command sends. Every answer is read through the dialog's result schema.
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

describe('InsertFromPdfBody', () => {
  it('OPENS AFTER THE PAGE ON SHOW with every source page, and sends that page as the position', () => {
    // PAGE 4 ON SHOW (zero-based 3): after it is zero-based 4.
    const { resolve } = opened();
    expect(screen.getByText('6 pages')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'After page' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Page' })).toHaveProperty('value', '4');
    insert();
    expect(answered(resolve)).toStrictEqual({ kind: 'insert', source: 'd-a', sourcePages: 'all', at: 4 });
  });

  it('BEFORE the page typed is one place earlier — the control for the case above', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Before page' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '1' } });
    insert();
    expect(answered(resolve)).toStrictEqual({ kind: 'insert', source: 'd-a', sourcePages: 'all', at: 0 });
  });

  it('AFTER THE LAST PAGE is the one position past the end', () => {
    const { resolve } = opened();
    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '9' } });
    insert();
    expect(answered(resolve)).toStrictEqual({ kind: 'insert', source: 'd-a', sourcePages: 'all', at: 9 });
  });

  it('CHOSEN SOURCE PAGES are answered, and a page this document lacks is said on the press', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Select pages' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '2-3' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '10' } });
    insert();
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Choose a page of this document, from 1 to 9.');

    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '2' } });
    insert();
    expect(answered(resolve)).toStrictEqual({ kind: 'insert', source: 'd-a', sourcePages: [1, 2], at: 2 });
  });

  it('CHOOSE FILE answers every entry, and a draft reopens with them', () => {
    const first = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Before page' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }));
    const draft = { sourcePages: { every: true, text: '' }, placement: 'before', page: '7' };
    expect(answered(first.resolve)).toStrictEqual({ kind: 'choose-file', draft });
    cleanup();

    const again = opened({ draft: { sourcePages: { every: true, text: '' }, placement: 'before', page: '7' } });
    insert();
    expect(answered(again.resolve)).toStrictEqual({ kind: 'insert', source: 'd-a', sourcePages: 'all', at: 6 });
  });
});
