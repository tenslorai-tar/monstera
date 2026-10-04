// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MergeDocumentBody from './MergeDocumentBody.js';
import { InDialog } from './inDialog.js';
import { MERGE_DOCUMENT_RESULT } from './mergeDocumentResult.js';

/**
 * Merge's places: at the start, at the end, after a page of this document — each converted once to the zero-based
 * position the command sends. Every answer is read through the dialog's result schema.
 */
afterEach(() => {
  cleanup();
});

const ALPHA = { docId: 'd-a', name: 'Alpha.pdf', pageCount: 3 };

function opened(props: Partial<Parameters<typeof MergeDocumentBody>[0]> = {}): { readonly resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  render(
    <InDialog>
      <MergeDocumentBody choices={[ALPHA]} pageCount={8} resolve={resolve} update={vi.fn()} {...props} />
    </InDialog>,
  );
  return { resolve };
}

const answered = (resolve: ReturnType<typeof vi.fn>): unknown => MERGE_DOCUMENT_RESULT.parse(resolve.mock.calls[0]?.[0]);
const merge = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
};

describe('MergeDocumentBody', () => {
  it('OPENS AT THE END, with no page field, and sends the page count', () => {
    const { resolve } = opened();
    expect(screen.getByRole('button', { name: 'At the end' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('textbox', { name: 'Page' })).toBeNull();
    merge();
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', source: 'd-a', at: 8 });
  });

  it('AT THE START sends 0 — the control for the case above', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'At the start' }));
    merge();
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', source: 'd-a', at: 0 });
  });

  it('AFTER PAGE asks for a page of this document, says one it lacks, and sends the page typed', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'After page' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '9' } });
    merge();
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Choose a page of this document, from 1 to 8.');

    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '3' } });
    merge();
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', source: 'd-a', at: 3 });
  });

  it('CHOOSE FILE answers the place, and a draft reopens with it', () => {
    const first = opened();
    fireEvent.click(screen.getByRole('button', { name: 'After page' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }));
    expect(answered(first.resolve)).toStrictEqual({ kind: 'choose-file', draft: { placement: 'after', page: '2' } });
    cleanup();

    const again = opened({ draft: { placement: 'after', page: '2' } });
    merge();
    expect(answered(again.resolve)).toStrictEqual({ kind: 'merge', source: 'd-a', at: 2 });
  });
});
