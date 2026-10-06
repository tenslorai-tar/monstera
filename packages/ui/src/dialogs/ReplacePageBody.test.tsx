// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ReplacePageBody from './ReplacePageBody.js';
import { InDialog } from './inDialog.js';
import { REPLACE_PAGE_RESULT } from './replacePageResult.js';

/**
 * The replace dialog's own rules: it opens on as many source pages as it replaces, says when pages apart are given a
 * different number back, and answers *Choose file…* with what was entered. Every answer is read through the dialog's
 * result schema, because that is all the command takes from it.
 */
afterEach(() => {
  cleanup();
});

const ALPHA = { docId: 'd-a', name: 'Alpha.pdf', pageCount: 3 };
const BETA = { docId: 'd-b', name: 'Beta.pdf', pageCount: 1 };

function opened(props: Partial<Parameters<typeof ReplacePageBody>[0]> & { readonly pages: readonly number[] }): {
  readonly resolve: ReturnType<typeof vi.fn>;
} {
  const resolve = vi.fn();
  render(
    <InDialog>
      <ReplacePageBody choices={[ALPHA, BETA]} resolve={resolve} update={vi.fn()} {...props} />
    </InDialog>,
  );
  return { resolve };
}

const answered = (resolve: ReturnType<typeof vi.fn>): unknown => REPLACE_PAGE_RESULT.parse(resolve.mock.calls[0]?.[0]);

describe('ReplacePageBody', () => {
  it('ONE PAGE FROM A LONGER SOURCE opens on its first page, so the length is kept', () => {
    const { resolve } = opened({ pages: [4] });
    expect(screen.getByText('Page 5 will be removed and replaced.')).toBeTruthy();
    // THE CHOSEN DOCUMENT'S SIZE, beside the question.
    expect(screen.getByText('3 pages')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Page numbers' })).toHaveProperty('value', '1');
    fireEvent.click(screen.getByRole('button', { name: 'Replace page' }));
    expect(answered(resolve)).toStrictEqual({ kind: 'replace', source: 'd-a', sourcePages: [0] });
  });

  it('CONTROL: a source with as many pages as are replaced opens on Every page', () => {
    const { resolve } = opened({ pages: [4], source: 'd-b' });
    expect(screen.getByText('1 page')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Every page' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Replace page' }));
    expect(answered(resolve)).toStrictEqual({ kind: 'replace', source: 'd-b', sourcePages: 'all' });
  });

  it('PAGES APART given a different number back are SAID, and nothing is answered until the counts pair', () => {
    const { resolve } = opened({ pages: [4, 1] });
    expect(screen.getByText('Pages 2, 5 will be removed and replaced.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace 2 pages' }));
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      'Choose 2 pages to put in: the pages being replaced are not next to each other.',
    );

    // AND IT GOES as the choice pairs, before the next press.
    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '2-3' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Replace 2 pages' }));
    expect(answered(resolve)).toStrictEqual({ kind: 'replace', source: 'd-a', sourcePages: [1, 2] });
  });

  it('CONTROL: pages NEXT TO EACH OTHER may take a different number back', () => {
    const { resolve } = opened({ pages: [1, 2] });
    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace 2 pages' }));
    expect(answered(resolve)).toStrictEqual({ kind: 'replace', source: 'd-a', sourcePages: [2] });
  });

  it('CHOOSE FILE answers with what was entered, and a draft reopens with it', () => {
    const first = opened({ pages: [4] });
    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }));
    expect(answered(first.resolve)).toStrictEqual({
      kind: 'choose-file',
      draft: { sourcePages: { every: false, text: '2' } },
    });
    cleanup();

    const again = opened({ pages: [4], draft: { sourcePages: { every: false, text: '2' } } });
    expect(screen.getByRole('textbox', { name: 'Page numbers' })).toHaveProperty('value', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Replace page' }));
    expect(answered(again.resolve)).toStrictEqual({ kind: 'replace', source: 'd-a', sourcePages: [1] });
  });

  it('WITH NO OTHER DOCUMENT OPEN it says so beside Choose file, and Replace waits for a source', () => {
    const { resolve } = opened({ pages: [4], choices: [] });
    expect(screen.getByText('No other document is open. Choose a file.')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Replace page' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }));
    expect(answered(resolve)).toStrictEqual({ kind: 'choose-file', draft: { sourcePages: { every: true, text: '' } } });
  });
});
