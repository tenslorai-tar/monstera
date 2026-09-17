// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import ExportExcelBody from './ExportExcelBody.js';
import type { ExportExcelProps } from './exportExcel.js';

/**
 * The Excel export dialog's body. The command's half — that the answers reach
 * `document.pageTables` and `document.exportExcel` — is
 * `commands/documentCommands.test.ts`'; this half is that TYPING in a cell and
 * CHOOSING a layout or a page are what put them in the answer.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

const PROPS: ExportExcelProps = {
  index: 1,
  page: 2,
  pageCount: 3,
  tables: [
    {
      rows: [
        [
          { text: 'Item', clipped: false },
          { text: 'Qty', clipped: false },
        ],
        [
          { text: 'Bolt', clipped: false },
          { text: 'a long cell', clipped: true },
        ],
      ],
    },
  ],
  truncated: false,
  layout: 'sheet-per-page',
  edits: [],
};

function shown(props: Partial<ExportExcelProps> = {}): ReturnType<typeof vi.fn> {
  const resolve = vi.fn();
  render(
    <Wrapped>
      <ExportExcelBody {...PROPS} {...props} resolve={resolve} />
    </Wrapped>,
  );
  return resolve;
}

const cell = (row: number, column: number): HTMLInputElement =>
  screen.getByRole('textbox', { name: `Table 1, row ${String(row)}, column ${String(column)}` });

describe('ExportExcelBody', () => {
  it('answers the TYPED text for the cell typed in, and nothing for the others', () => {
    const resolve = shown();
    fireEvent.change(cell(2, 1), { target: { value: 'Hex bolt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose where to save…' }));
    expect(resolve).toHaveBeenCalledWith({
      kind: 'export',
      layout: 'sheet-per-page',
      edits: [{ table: 0, row: 1, column: 0, text: 'Hex bolt' }],
    });
  });

  it('CONTROL: a cell typed BACK to what was found is no edit', () => {
    const resolve = shown();
    fireEvent.change(cell(2, 1), { target: { value: 'Hex bolt' } });
    fireEvent.change(cell(2, 1), { target: { value: 'Bolt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose where to save…' }));
    expect(resolve).toHaveBeenCalledWith({ kind: 'export', layout: 'sheet-per-page', edits: [] });
  });

  it('makes a clipped cell read-only, since an edit would replace text nobody saw', () => {
    shown();
    expect(cell(2, 2).readOnly).toBe(true);
    expect(cell(2, 1).readOnly).toBe(false);
  });

  it('moves to a page by ANSWERING it, carrying the edits and the layout chosen', () => {
    const resolve = shown();
    fireEvent.click(screen.getByRole('radio', { name: 'Every table on one sheet' }));
    fireEvent.change(cell(1, 2), { target: { value: 'Count' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(resolve).toHaveBeenCalledWith({
      kind: 'page',
      to: 2,
      layout: 'one-sheet',
      edits: [{ table: 0, row: 0, column: 1, text: 'Count' }],
    });
  });

  it('shows the edits it was opened with, so returning to a page shows what was typed on it', () => {
    shown({ edits: [{ table: 0, row: 0, column: 0, text: 'Part' }] });
    expect(cell(1, 1).value).toBe('Part');
    expect(cell(1, 2).value).toBe('Qty');
  });

  it('CONTROL: offers no page before the first or after the last', () => {
    shown({ index: 0, page: 1, pageCount: 1 });
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveProperty('disabled', true);
  });
});
