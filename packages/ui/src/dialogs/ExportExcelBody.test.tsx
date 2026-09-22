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
  engines: ['automatic'],
  engine: 'automatic',
  edits: [],
};

function shown(props: Partial<ExportExcelProps> = {}): ReturnType<typeof vi.fn> {
  const resolve = vi.fn();
  render(
    <Wrapped>
      <ExportExcelBody {...PROPS} {...props} resolve={resolve} update={() => undefined} />
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
      engine: 'automatic',
      edits: [{ table: 0, row: 1, column: 0, text: 'Hex bolt' }],
    });
  });

  it('CONTROL: a cell typed BACK to what was found is no edit', () => {
    const resolve = shown();
    fireEvent.change(cell(2, 1), { target: { value: 'Hex bolt' } });
    fireEvent.change(cell(2, 1), { target: { value: 'Bolt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose where to save…' }));
    expect(resolve).toHaveBeenCalledWith({ kind: 'export', layout: 'sheet-per-page', engine: 'automatic', edits: [] });
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
      engine: 'automatic',
      edits: [{ table: 0, row: 0, column: 1, text: 'Count' }],
    });
  });

  it('CONTROL: with one engine there is no engine choice at all — and it SAYS how to get one (§10.5)', () => {
    shown();
    expect(screen.queryByRole('radio', { name: 'Claude' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Read the tables with' })).toBeNull();
    expect(screen.getByText(/add a key in Settings/u)).toBeTruthy();
  });

  it('CONTROL: with a service offered, the no-key sentence is not shown', () => {
    shown({ engines: ['automatic', 'claude'] });
    expect(screen.queryByText(/add a key in Settings/u)).toBeNull();
  });

  it('choosing a SERVICE says what leaves the computer, hides the grid, and answers no edits', () => {
    const resolve = shown({ engines: ['automatic', 'azure', 'claude'] });
    // Typed BEFORE the switch: a correction to MuPDF's table must not cross with a service engine.
    fireEvent.change(cell(2, 1), { target: { value: 'Hex bolt' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Azure Document Intelligence' }));

    expect(screen.getByText(/All 3 pages of this document will be sent to Azure Document Intelligence/u)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose where to save…' }));
    expect(resolve).toHaveBeenCalledWith({ kind: 'export', layout: 'sheet-per-page', engine: 'azure', edits: [] });
  });

  it('says a ONE-page document’s page goes, not “all 1 page”', () => {
    shown({ index: 0, page: 1, pageCount: 1, engines: ['automatic', 'claude'] });
    fireEvent.click(screen.getByRole('radio', { name: 'Claude' }));
    expect(screen.getByText(/^This document’s page will be sent to Anthropic’s Claude/u)).toBeTruthy();
    expect(screen.queryByText(/All 1 page/u)).toBeNull();
  });

  it('CONTROL: switching BACK to this PDF’s own text keeps what was typed', () => {
    const resolve = shown({ engines: ['automatic', 'claude'] });
    fireEvent.change(cell(2, 1), { target: { value: 'Hex bolt' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Claude' }));
    fireEvent.click(screen.getByRole('radio', { name: 'This PDF’s own text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose where to save…' }));
    expect(resolve).toHaveBeenCalledWith({
      kind: 'export',
      layout: 'sheet-per-page',
      engine: 'automatic',
      edits: [{ table: 0, row: 1, column: 0, text: 'Hex bolt' }],
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
