// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ImportPageAsLayerBody from './ImportPageAsLayerBody.js';
import { InDialog } from './inDialog.js';
import { IMPORT_PAGE_AS_LAYER_RESULT } from './importPageAsLayerResult.js';

/**
 * Import page as layer in plain words: the sentence says which page of which document goes over which page, as the
 * choices change, and the source page is the one typed, converted once. Every answer is read through the result schema.
 */
afterEach(() => {
  cleanup();
});

const LETTERHEAD = { docId: 'd-l', name: 'Letterhead.pdf', pageCount: 3 };
const FORM = { docId: 'd-f', name: 'Form.pdf', pageCount: 1 };

function opened(props: Partial<Parameters<typeof ImportPageAsLayerBody>[0]> = {}): { readonly resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  render(
    <InDialog>
      <ImportPageAsLayerBody choices={[LETTERHEAD, FORM]} page={2} resolve={resolve} update={vi.fn()} {...props} />
    </InDialog>,
  );
  return { resolve };
}

const answered = (resolve: ReturnType<typeof vi.fn>): unknown =>
  IMPORT_PAGE_AS_LAYER_RESULT.parse(resolve.mock.calls[0]?.[0]);
const sentence = (): string => document.querySelector('.m-import-page-as-layer__which')?.textContent ?? '';

describe('ImportPageAsLayerBody', () => {
  it('SAYS IN PLAIN WORDS which page goes over which, and follows the page typed', () => {
    const { resolve } = opened();
    expect(sentence()).toBe('Page 1 of Letterhead.pdf will be laid over page 3 as a layer you can hide.');
    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '2' } });
    expect(sentence()).toBe('Page 2 of Letterhead.pdf will be laid over page 3 as a layer you can hide.');
    fireEvent.click(screen.getByRole('button', { name: 'Import as layer' }));
    expect(answered(resolve)).toStrictEqual({ kind: 'import', source: 'd-l', sourcePage: 1 });
  });

  it('A PAGE THE SOURCE LACKS is said on the press, and the sentence stops naming one', () => {
    const { resolve } = opened({ source: 'd-f' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '2' } });
    expect(sentence()).toBe('The page you choose will be laid over page 3 as a layer you can hide.');
    fireEvent.click(screen.getByRole('button', { name: 'Import as layer' }));
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Choose a page of the document above, from 1 to 1.');
  });

  it('CHOOSE FILE answers the page typed, and with nothing open it says so', () => {
    const first = opened();
    fireEvent.change(screen.getByRole('textbox', { name: 'Page' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }));
    expect(answered(first.resolve)).toStrictEqual({ kind: 'choose-file', draft: { sourcePage: '3' } });
    cleanup();

    opened({ choices: [] });
    expect(sentence()).toBe('The page you choose will be laid over page 3 as a layer you can hide.');
    expect(screen.getByText('No other document is open. Choose a file.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import as layer' })).toHaveProperty('disabled', true);
  });
});
