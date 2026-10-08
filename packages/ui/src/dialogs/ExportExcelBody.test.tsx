// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue } from '../i18n.js';
import { InDialog } from './inDialog.js';
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
  return <InDialog>{children}</InDialog>;
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
  range: { every: true, text: '' },
};

const EVERY_PAGE = [0, 1, 2];

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
      pages: EVERY_PAGE,
    });
  });

  it('CONTROL: a cell typed BACK to what was found is no edit', () => {
    const resolve = shown();
    fireEvent.change(cell(2, 1), { target: { value: 'Hex bolt' } });
    fireEvent.change(cell(2, 1), { target: { value: 'Bolt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose where to save…' }));
    expect(resolve).toHaveBeenCalledWith({
      kind: 'export',
      layout: 'sheet-per-page',
      engine: 'automatic',
      edits: [],
      pages: EVERY_PAGE,
    });
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
      range: { every: true, text: '' },
    });
  });

  it('ITS PAGES ARE THE EXPORTS’ SHARED ROW (ADR-0161): a move carries the row AS TYPED, and the export sends the pages', () => {
    const resolve = shown();
    fireEvent.click(screen.getByRole('button', { name: 'Select pages' }));
    // HALF TYPED, and a move to another page is no reason to refuse or to parse it.
    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '1-' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(resolve).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'page', range: { every: false, text: '1-' } }));
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    // OPENED AGAIN where the person left it, as the command does on the next page.
    const again = shown({ range: { every: false, text: '1-' } });
    const field = screen.getByRole('textbox', { name: 'Page numbers' });
    expect((field as HTMLInputElement).value).toBe('1-');
    fireEvent.click(screen.getByRole('button', { name: 'Choose where to save…' }));
    expect(again).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();

    fireEvent.change(field, { target: { value: '1, 3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose where to save…' }));
    expect(again).toHaveBeenCalledWith(expect.objectContaining({ kind: 'export', pages: [0, 2] }));
  });

  it('a SERVICE says how many of the chosen pages leave the computer, and nothing while the row names none', () => {
    shown({ engines: ['automatic', 'azure'], engine: 'azure', range: { every: false, text: '2-3' } });
    expect(screen.getByText(/^2 pages of this document will be sent to Azure Document Intelligence/u)).toBeTruthy();
    // CONTROL: "All" is for every page only.
    expect(screen.queryByText(/All 3 pages/u)).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '' } });
    expect(screen.queryByText(/will be sent to/u)).toBeNull();
  });

  it('CONTROL: with one engine there is no engine choice at all — and it SAYS how to get one (§10.5)', () => {
    shown();
    expect(screen.queryByRole('radio', { name: 'Claude' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'What is in this document?' })).toBeNull();
    expect(screen.getByText(/key in Settings/u)).toBeTruthy();
  });

  it('CONTROL: with a service offered, the no-key sentence is not shown', () => {
    shown({ engines: ['automatic', 'claude'] });
    expect(screen.queryByText(/key in Settings/u)).toBeNull();
  });

  it('a PRINTED SCAN read on this computer sends nothing, says what it leaves in the document, hides the grid, and answers no edits', () => {
    const resolve = shown({ engines: ['automatic', 'built-in'] });
    fireEvent.change(cell(2, 1), { target: { value: 'Hex bolt' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Printed scan, read on this computer' }));
    // NOTHING LEAVES THE COMPUTER, so no page count is said; what the read leaves in the document is.
    expect(screen.queryByText(/will be sent to/u)).toBeNull();
    expect(screen.getByText(/Nothing leaves your computer\. The words are also kept, unseen, in this document/u)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose where to save…' }));
    expect(resolve).toHaveBeenCalledWith({
      kind: 'export',
      layout: 'sheet-per-page',
      engine: 'built-in',
      edits: [],
      pages: EVERY_PAGE,
    });
  });

  it('choosing a SERVICE says what leaves the computer, hides the grid, and answers no edits', () => {
    const resolve = shown({ engines: ['automatic', 'azure', 'claude'] });
    // Typed BEFORE the switch: a correction to MuPDF's table must not cross with a service engine.
    fireEvent.change(cell(2, 1), { target: { value: 'Hex bolt' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Handwritten or scanned, read by Azure' }));

    expect(screen.getByText(/All 3 pages of this document will be sent to Azure Document Intelligence/u)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    // IN THE FOOTER BESIDE CANCEL, as in the other state: it stood alone at the body's left (the gallery, 2026-10-03).
    const footer = document.querySelector('.m-dialog-footer');
    expect([...(footer?.querySelectorAll('button') ?? [])].map((button) => button.textContent)).toStrictEqual([
      'Cancel',
      'Choose where to save…',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Choose where to save…' }));
    expect(resolve).toHaveBeenCalledWith({
      kind: 'export',
      layout: 'sheet-per-page',
      engine: 'azure',
      edits: [],
      pages: EVERY_PAGE,
    });
  });

  it('says a ONE-page document’s page goes, not “all 1 page”', () => {
    shown({ index: 0, page: 1, pageCount: 1, engines: ['automatic', 'claude'] });
    fireEvent.click(screen.getByRole('radio', { name: 'Handwritten or scanned, read by Claude' }));
    expect(screen.getByText(/^This document’s page will be sent to Anthropic’s Claude/u)).toBeTruthy();
    expect(screen.queryByText(/All 1 page/u)).toBeNull();
  });

  it('CONTROL: switching BACK to this PDF’s own text keeps what was typed', () => {
    const resolve = shown({ engines: ['automatic', 'claude'] });
    fireEvent.change(cell(2, 1), { target: { value: 'Hex bolt' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Handwritten or scanned, read by Claude' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Typed text (the PDF’s own words)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose where to save…' }));
    expect(resolve).toHaveBeenCalledWith({
      kind: 'export',
      layout: 'sheet-per-page',
      engine: 'automatic',
      edits: [{ table: 0, row: 1, column: 0, text: 'Hex bolt' }],
      pages: EVERY_PAGE,
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
