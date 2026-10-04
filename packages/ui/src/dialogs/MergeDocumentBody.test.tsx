// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MergeDocumentBody from './MergeDocumentBody.js';
import { InDialog } from './inDialog.js';
import { MERGE_DOCUMENT_RESULT } from './mergeDocumentResult.js';

/**
 * Merge's documents and places (the owner's item 13d, ADR-0152): a numbered list a person orders, then at the start,
 * at the end, or after a page of this document — each place converted once to the zero-based position the command
 * sends. Every answer is read through the dialog's result schema.
 */
afterEach(() => {
  cleanup();
});

const ALPHA = { docId: 'd-a', name: 'Alpha.pdf', pageCount: 3 };
const BETA = { docId: 'd-b', name: 'Beta.pdf', pageCount: 1 };

function opened(props: Partial<Parameters<typeof MergeDocumentBody>[0]> = {}): { readonly resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  render(
    <InDialog>
      <MergeDocumentBody choices={[ALPHA, BETA]} pageCount={8} resolve={resolve} update={vi.fn()} {...props} />
    </InDialog>,
  );
  return { resolve };
}

const answered = (resolve: ReturnType<typeof vi.fn>): unknown => MERGE_DOCUMENT_RESULT.parse(resolve.mock.calls[0]?.[0]);
const press = (name: string): void => {
  fireEvent.click(screen.getByRole('button', { name }));
};
const choose = (number: number, docId: string): void => {
  fireEvent.change(screen.getByRole('combobox', { name: `Document ${String(number)}` }), { target: { value: docId } });
};

describe('MergeDocumentBody', () => {
  it('OPENS AT THE END with the first document listed, and sends the page count', () => {
    const { resolve } = opened();
    expect(screen.getByRole('button', { name: 'At the end' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('textbox', { name: 'Page' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    press('Merge');
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ['d-a'], at: 8 });
  });

  it('AT THE START sends 0 — the control for the case above', () => {
    const { resolve } = opened();
    press('At the start');
    press('Merge');
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ['d-a'], at: 0 });
  });

  it('AFTER PAGE asks for a page of this document, says one it lacks, and sends the page typed', () => {
    const { resolve } = opened();
    press('After page');
    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '9' } });
    press('Merge');
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Choose a page of this document, from 1 to 8.');

    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '3' } });
    press('Merge');
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ['d-a'], at: 3 });
  });

  it('SEVERAL DOCUMENTS go in the order the list shows, and Move up changes it', () => {
    const { resolve } = opened();
    press('Add a document');
    choose(2, 'd-b');
    // MOVED, so the answer is not the order the documents were added in: an answer in addition order fails here.
    press('Move document 2 up');
    expect(screen.getByRole('button', { name: 'Move document 1 up' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Move document 2 down' }).hasAttribute('disabled')).toBe(true);
    press('Merge');
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ['d-b', 'd-a'], at: 8 });
  });

  it('THE SAME DOCUMENT may be listed twice, and Remove takes out the row pressed, not its document', () => {
    const { resolve } = opened();
    press('Add a document');
    press('Add a document');
    choose(2, 'd-b');
    // Rows 1 and 3 are both Alpha: removing row 1 must leave Beta then Alpha, which removing by document would not.
    press('Remove document 1');
    press('Merge');
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ['d-b', 'd-a'], at: 8 });
  });

  it('NOTHING LISTED says so and cannot be merged', () => {
    const { resolve } = opened();
    press('Remove document 1');
    expect(screen.getByText('No document chosen yet. Add one, or choose a file.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Merge' }).hasAttribute('disabled')).toBe(true);
    press('Merge');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('A DOCUMENT NO LONGER OFFERED is not merged in: one listed in the draft but closed since', () => {
    const { resolve } = opened({ draft: { placement: 'end', page: '1', documents: ['d-a', 'd-gone'] } });
    expect(screen.getByRole('button', { name: 'Merge' }).hasAttribute('disabled')).toBe(true);
    press('Remove document 2');
    press('Merge');
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ['d-a'], at: 8 });
  });

  it('CHOOSE FILE answers the list and the place, and reopens with the file just picked added at the end', () => {
    const first = opened();
    press('After page');
    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '2' } });
    press('Choose file…');
    expect(answered(first.resolve)).toStrictEqual({
      kind: 'choose-file',
      draft: { placement: 'after', page: '2', documents: ['d-a'] },
    });
    cleanup();

    const again = opened({ source: 'd-b', draft: { placement: 'after', page: '2', documents: ['d-a'] } });
    press('Merge');
    expect(answered(again.resolve)).toStrictEqual({ kind: 'merge', documents: ['d-a', 'd-b'], at: 2 });
  });

  it('A PICK ALREADY LISTED is not added twice: the command asks again with it chosen after a cancelled pick', () => {
    const { resolve } = opened({ source: 'd-b', draft: { placement: 'end', page: '1', documents: ['d-a', 'd-b'] } });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    press('Merge');
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ['d-a', 'd-b'], at: 8 });
  });

  it('NO OTHER DOCUMENT OPEN lists none, says so, and offers Choose file', () => {
    opened({ choices: [] });
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('No other document is open. Choose a file.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a document' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Choose file…' }).hasAttribute('disabled')).toBe(false);
  });
});
