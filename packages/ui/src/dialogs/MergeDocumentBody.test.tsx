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

/** Documents taken whole, as the dialog answers them. */
const ALL = (...ids: string[]): { docId: string; pages: 'all' }[] => ids.map((docId) => ({ docId, pages: 'all' }));
/** Documents in a draft, nothing typed in their rows. */
const DRAFT = (...ids: string[]): { docId: string; pages: string }[] => ids.map((docId) => ({ docId, pages: '' }));

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
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ALL('d-a'), at: 8 });
  });

  it('AT THE START sends 0 — the control for the case above', () => {
    const { resolve } = opened();
    press('At the start');
    press('Merge');
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ALL('d-a'), at: 0 });
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
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ALL('d-a'), at: 3 });
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
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ALL('d-b', 'd-a'), at: 8 });
  });

  it('THE SAME DOCUMENT may be listed twice, and Remove takes out the row pressed, not its document', () => {
    const { resolve } = opened();
    press('Add a document');
    press('Add a document');
    choose(2, 'd-b');
    // Rows 1 and 3 are both Alpha: removing row 1 must leave Beta then Alpha, which removing by document would not.
    press('Remove document 1');
    press('Merge');
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ALL('d-b', 'd-a'), at: 8 });
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
    const { resolve } = opened({ draft: { placement: 'end', page: '1', documents: DRAFT('d-a', 'd-gone') } });
    expect(screen.getByRole('button', { name: 'Merge' }).hasAttribute('disabled')).toBe(true);
    press('Remove document 2');
    press('Merge');
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ALL('d-a'), at: 8 });
  });

  it('CHOOSE FILE answers the list and the place, and reopens with the file just picked added at the end', () => {
    const first = opened();
    press('After page');
    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '2' } });
    press('Choose file…');
    expect(answered(first.resolve)).toStrictEqual({
      kind: 'choose-file',
      draft: { placement: 'after', page: '2', documents: DRAFT('d-a') },
    });
    cleanup();

    const again = opened({ source: 'd-b', draft: { placement: 'after', page: '2', documents: DRAFT('d-a') } });
    press('Merge');
    expect(answered(again.resolve)).toStrictEqual({ kind: 'merge', documents: ALL('d-a', 'd-b'), at: 2 });
  });

  it('A PICK ALREADY LISTED is not added twice: the command asks again with it chosen after a cancelled pick', () => {
    const { resolve } = opened({ source: 'd-b', draft: { placement: 'end', page: '1', documents: DRAFT('d-a', 'd-b') } });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    press('Merge');
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: ALL('d-a', 'd-b'), at: 8 });
  });

  const pagesBox = (number: number): HTMLElement => {
    const found = screen.getAllByRole('textbox', { name: 'Pages to take' })[number - 1];
    if (found === undefined) throw new Error(`no pages field for document ${String(number)}`);
    return found;
  };

  it('PAGES CHOSEN OF A DOCUMENT go in as the set typed, in the order typed, and the other documents stay whole (ADR-0195)', () => {
    const { resolve } = opened({ choices: [{ ...ALPHA, pageCount: 8 }, BETA] });
    press('Add a document');
    choose(2, 'd-b');
    fireEvent.change(pagesBox(1), { target: { value: '4, 2' } });
    expect(screen.getByText('2 pages of 8 go in')).toBeTruthy();
    press('Merge');
    // ZERO-BASED AND IN THE ORDER TYPED (4 then 2 is [3, 1]), where a sorted or one-based answer is other numbers.
    expect(answered(resolve)).toStrictEqual({
      kind: 'merge',
      documents: [{ docId: 'd-a', pages: [3, 1] }, { docId: 'd-b', pages: 'all' }],
      at: 8,
    });
  });

  it('a RUN is written as one entry, and CONTROL: an empty box is every page', () => {
    const { resolve } = opened({ choices: [{ ...ALPHA, pageCount: 8 }, BETA] });
    fireEvent.change(pagesBox(1), { target: { value: '1-3, 5' } });
    press('Merge');
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: [{ docId: 'd-a', pages: [[0, 2], 4] }], at: 8 });
    cleanup();
    const again = opened({ choices: [{ ...ALPHA, pageCount: 8 }, BETA] });
    press('Merge');
    expect(answered(again.resolve)).toStrictEqual({ kind: 'merge', documents: ALL('d-a'), at: 8 });
  });

  it('a range the document does not have is NAMED on its row and nothing is sent', () => {
    const { resolve } = opened();
    fireEvent.change(pagesBox(1), { target: { value: '2-9' } });
    expect(screen.getByRole('alert').textContent).toContain('2-9');
    press('Merge');
    expect(resolve).not.toHaveBeenCalled();
    // AND A PART THAT IS NOT A PAGE, and a range that counts backwards, each by its own sentence naming the part.
    fireEvent.change(pagesBox(1), { target: { value: '1, x' } });
    expect(screen.getByRole('alert').textContent).toContain('x');
    fireEvent.change(pagesBox(1), { target: { value: '3-1' } });
    expect(screen.getByRole('alert').textContent).toContain('3-1');
    // CONTROL: fixing it lets the merge go.
    fireEvent.change(pagesBox(1), { target: { value: '1-3' } });
    expect(screen.queryByRole('alert')).toBeNull();
    press('Merge');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('CHOOSE FILE keeps what was typed in each row, and reopens with it', () => {
    const first = opened({ choices: [{ ...ALPHA, pageCount: 8 }, BETA] });
    fireEvent.change(pagesBox(1), { target: { value: '2, 4' } });
    press('Choose file…');
    expect(answered(first.resolve)).toStrictEqual({
      kind: 'choose-file',
      draft: { placement: 'end', page: '1', documents: [{ docId: 'd-a', pages: '2, 4' }] },
    });
  });

  const tile = (page: number): HTMLElement => screen.getByRole('button', { name: `Page ${String(page)}` });

  /** Opens the tiles and waits for them: the picker is loaded when first asked for (it brings the parser with it). */
  const choosePages = async (): Promise<void> => {
    press('Choose pages…');
    await screen.findByRole('button', { name: 'Page 1' });
  };

  it('CHOOSE PAGES shows each page as a tile that takes it or leaves it, and writes the row’s range field (item 5.1)', async () => {
    const { resolve } = opened({ choices: [{ ...ALPHA, pageCount: 6 }, BETA] });
    // CLOSED UNTIL ASKED: no tiles, and the button names what it does.
    expect(screen.queryByRole('button', { name: 'Page 1' })).toBeNull();
    await choosePages();
    // EVERY PAGE IS TAKEN WHILE THE FIELD IS EMPTY, which is what an empty field means.
    for (let page = 1; page <= 6; page += 1) expect(tile(page).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(tile(2));
    fireEvent.click(tile(5));
    expect(tile(2).getAttribute('aria-pressed')).toBe('false');
    // WRITTEN AS THE PARSER READS IT: 1, 3-4, 6.
    expect((pagesBox(1) as HTMLInputElement).value).toBe('1, 3-4, 6');
    press('Merge');
    expect(answered(resolve)).toStrictEqual({ kind: 'merge', documents: [{ docId: 'd-a', pages: [0, [2, 3], 5] }], at: 8 });
  });

  it('typing and clicking edit ONE field: a typed range shows as taken tiles, and taking every page empties the field', async () => {
    opened({ choices: [{ ...ALPHA, pageCount: 4 }, BETA] });
    await choosePages();
    fireEvent.change(pagesBox(1), { target: { value: '2-3' } });
    expect([1, 2, 3, 4].map((page) => tile(page).getAttribute('aria-pressed'))).toStrictEqual(['false', 'true', 'true', 'false']);
    fireEvent.click(tile(1));
    fireEvent.click(tile(4));
    expect((pagesBox(1) as HTMLInputElement).value).toBe('');
  });

  it('THE LAST PAGE TAKEN CANNOT BE LEFT: a row of no pages is not something a merge can say', async () => {
    opened({ choices: [{ ...ALPHA, pageCount: 4 }, BETA] });
    await choosePages();
    fireEvent.change(pagesBox(1), { target: { value: '3' } });
    fireEvent.click(tile(3));
    expect((pagesBox(1) as HTMLInputElement).value).toBe('3');
    expect(tile(3).getAttribute('aria-pressed')).toBe('true');
  });

  it('Hide pages closes the tiles and keeps the choice', async () => {
    opened({ choices: [{ ...ALPHA, pageCount: 4 }, BETA] });
    await choosePages();
    fireEvent.click(tile(1));
    press('Hide pages');
    expect(screen.queryByRole('button', { name: 'Page 1' })).toBeNull();
    expect((pagesBox(1) as HTMLInputElement).value).toBe('2-4');
  });

  it('NO OTHER DOCUMENT OPEN lists none, says so, and offers Choose file', () => {
    opened({ choices: [] });
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('No other document is open. Choose a file.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a document' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Choose file…' }).hasAttribute('disabled')).toBe(false);
  });
});
