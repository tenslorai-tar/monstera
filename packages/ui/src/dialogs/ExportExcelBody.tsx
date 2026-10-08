import { useLingui } from '@lingui/react';
import { MAX_TABLE_CELL_TEXT } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  EXPORT_EXCEL_APPLY,
  EXPORT_EXCEL_CELL,
  EXPORT_EXCEL_CLIPPED,
  EXPORT_EXCEL_BUILT_IN_NOTE,
  EXPORT_EXCEL_ENGINE,
  EXPORT_EXCEL_ENGINE_BUILT_IN,
  EXPORT_EXCEL_SERVICES_NO_KEY,
  EXPORT_EXCEL_ENGINE_AUTOMATIC,
  EXPORT_EXCEL_ENGINE_AZURE,
  EXPORT_EXCEL_ENGINE_CLAUDE,
  EXPORT_EXCEL_LAYOUT,
  EXPORT_EXCEL_SENDS_AZURE,
  EXPORT_EXCEL_SENDS_CLAUDE,
  EXPORT_EXCEL_NEXT_PAGE,
  EXPORT_EXCEL_NO_TABLES_HERE,
  EXPORT_EXCEL_ONE_SHEET,
  EXPORT_EXCEL_PAGE,
  EXPORT_EXCEL_PAGES_NOTE,
  EXPORT_EXCEL_PREVIOUS_PAGE,
  EXPORT_EXCEL_SHEET_PER_PAGE,
  EXPORT_EXCEL_TABLE,
  EXPORT_EXCEL_TRUNCATED,
  PAGE_RANGE_EXPORT_EMPTY,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ExportExcelAnswer, ExportExcelProps } from './exportExcel.js';
import { PageRangeChoice, usePageRange } from './PageRangeChoice.js';

type SheetLayout = ExportExcelAnswer['layout'];
type Engine = ExportExcelAnswer['engine'];
type Edit = ExportExcelAnswer['edits'][number];

/** Each layout and the sentence that says what a person gets, as a record so a third arrives owing its words. */
const LAYOUTS: Readonly<Record<SheetLayout, MessageKey>> = {
  'sheet-per-page': EXPORT_EXCEL_SHEET_PER_PAGE,
  'one-sheet': EXPORT_EXCEL_ONE_SHEET,
};

/** Each engine's name, as a record for the same reason. */
const ENGINES: Readonly<Record<Engine, MessageKey>> = {
  automatic: EXPORT_EXCEL_ENGINE_AUTOMATIC,
  'built-in': EXPORT_EXCEL_ENGINE_BUILT_IN,
  azure: EXPORT_EXCEL_ENGINE_AZURE,
  claude: EXPORT_EXCEL_ENGINE_CLAUDE,
};

/** What a service engine sends, said before anything is sent (ADR-0086 Decision 4). */
const SENDS: Readonly<Record<Exclude<Engine, 'automatic' | 'built-in'>, MessageKey>> = {
  azure: EXPORT_EXCEL_SENDS_AZURE,
  claude: EXPORT_EXCEL_SENDS_CLAUDE,
};

const keyOf = (table: number, row: number, column: number): string =>
  `${String(table)}:${String(row)}:${String(column)}`;

/**
 * The Excel export dialog's body: the page's tables as MuPDF found them, each cell
 * a field a person can correct, where the tables go, and the way to other pages.
 *
 * **An edit is kept only where it differs from what was found**, so typing a cell
 * back to its text is no edit at all, and what crosses is the corrections.
 *
 * **A clipped cell is read-only**: its text is longer than the grid carries, and an
 * edit would replace the part nobody saw.
 *
 * **A sheet per page is selected first**: it keeps where each table came from,
 * which one sheet loses, and combining is the choice a person makes on purpose.
 */
export default function ExportExcelBody({
  index,
  page,
  pageCount,
  tables,
  truncated,
  layout: initialLayout,
  engines,
  engine: initialEngine,
  edits: initialEdits,
  range: initialRange,
  resolve,
}: ExportExcelProps & DialogAnswering<ExportExcelAnswer>): ReactElement {
  const { _ } = useLingui();
  const range = usePageRange(pageCount, initialRange);
  const [layout, setLayout] = useState<SheetLayout>(initialLayout);
  const [engine, setEngine] = useState<Engine>(initialEngine);
  const [edits, setEdits] = useState<ReadonlyMap<string, Edit>>(
    () => new Map(initialEdits.map((edit) => [keyOf(edit.table, edit.row, edit.column), edit])),
  );

  // THE GRID'S EDITS ARE MUPDF'S TABLES', so a service engine sends none — the channel refuses
  // them with any other engine, and a correction to a table the service never read would be
  // written nowhere.
  const answer = (): ExportExcelAnswer['edits'] => (engine === 'automatic' ? [...edits.values()] : []);

  // THE ROW AS LEFT travels with a move to another page, unparsed: a half-typed range is not wrong yet (`PageRangeChoice`).
  const left = { every: range.every, text: range.text };
  const exportChosen = (made: ExportExcelAnswer['edits']): void => {
    const pages = range.proceed();
    if (pages === undefined) return;
    resolve({ kind: 'export', layout, engine, edits: made, pages: [...pages] });
  };

  const pageChoice = (
    <PageRangeChoice empty={PAGE_RANGE_EXPORT_EMPTY} note={EXPORT_EXCEL_PAGES_NOTE} range={range} />
  );

  const layoutChoice = (
    <DialogRow label={EXPORT_EXCEL_LAYOUT}>
      <div aria-label={_(EXPORT_EXCEL_LAYOUT)} className="m-export-excel__layout" role="radiogroup">
        {(Object.keys(LAYOUTS) as SheetLayout[]).map((each) => (
          <label key={each}>
            <input
              type="radio"
              name="export-excel-layout"
              checked={layout === each}
              onChange={() => {
                setLayout(each);
              }}
            />
            {_(LAYOUTS[each])}
          </label>
        ))}
      </div>
    </DialogRow>
  );

  // §10.5's NO-KEY STATE: with no service's key stored there is no engine to choose, and a dialog
  // that says nothing about it leaves a person with a scanned table no way to learn the other route.
  const engineChoice =
    engines.length <= 1 ? (
      <p className="m-export-excel__no-key" data-export-excel-no-key="">
        {_(EXPORT_EXCEL_SERVICES_NO_KEY)}
      </p>
    ) : (
      <DialogRow label={EXPORT_EXCEL_ENGINE}>
        <div aria-label={_(EXPORT_EXCEL_ENGINE)} className="m-export-excel__layout" role="radiogroup">
          {engines.map((each) => (
            <label key={each}>
              <input
                type="radio"
                name="export-excel-engine"
                checked={engine === each}
                onChange={() => {
                  setEngine(each);
                }}
              />
              {_(ENGINES[each])}
            </label>
          ))}
        </div>
      </DialogRow>
    );

  if (engine !== 'automatic') {
    return (
      <div className="m-export-excel">
        {engineChoice}
        {pageChoice}
        {/* THE PAGES THAT WILL BE SENT, counted from the row, and said only while the row names some: a count of every
            page under *Select pages* would say more leaves this computer than does. A read on this computer sends nothing and
            says what it leaves in the document instead (ADR-0202). */}
        {engine === 'built-in' ? (
          <p>{_(EXPORT_EXCEL_BUILT_IN_NOTE)}</p>
        ) : range.chosen === undefined ? null : (
          <p>
            {_(SENDS[engine], {
              count: range.chosen.length,
              every: range.chosen.length === pageCount ? 'yes' : 'no',
            })}
          </p>
        )}
        {layoutChoice}
        {/* IN THE FOOTER, beside Cancel, as in the other state: here it stood alone at the body's left with no way to
            decline but the title bar, and the dialog sat outside the pattern's width (the gallery, 2026-10-03). */}
        <DialogFooter>
          <Button
            label={EXPORT_EXCEL_APPLY}
            variant="primary"
            onClick={() => {
              exportChosen([]);
            }}
          />
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="m-export-excel">
      {engineChoice}
      <div className="m-export-excel__pages">
        <Button
          label={EXPORT_EXCEL_PREVIOUS_PAGE}
          disabled={index === 0}
          onClick={() => {
            resolve({ kind: 'page', to: index - 1, layout, engine, edits: answer(), range: left });
          }}
        />
        <span>{_(EXPORT_EXCEL_PAGE, { page, count: pageCount })}</span>
        <Button
          label={EXPORT_EXCEL_NEXT_PAGE}
          disabled={index + 1 >= pageCount}
          onClick={() => {
            resolve({ kind: 'page', to: index + 1, layout, engine, edits: answer(), range: left });
          }}
        />
      </div>

      {tables.length === 0 ? <p>{_(EXPORT_EXCEL_NO_TABLES_HERE)}</p> : null}
      {tables.map((table, t) => (
        <div className="m-export-excel__table" key={t}>
          <table>
            <caption>{_(EXPORT_EXCEL_TABLE, { table: t + 1 })}</caption>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => {
                    const key = keyOf(t, r, c);
                    return (
                      <td key={c}>
                        <input
                          type="text"
                          aria-label={_(EXPORT_EXCEL_CELL, { table: t + 1, row: r + 1, column: c + 1 })}
                          title={cell.clipped ? _(EXPORT_EXCEL_CLIPPED) : undefined}
                          readOnly={cell.clipped}
                          maxLength={MAX_TABLE_CELL_TEXT}
                          value={edits.get(key)?.text ?? cell.text}
                          onChange={(event) => {
                            const text = event.currentTarget.value;
                            setEdits((current) => {
                              const next = new Map(current);
                              if (text === cell.text) next.delete(key);
                              else next.set(key, { table: t, row: r, column: c, text });
                              return next;
                            });
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {truncated ? <p>{_(EXPORT_EXCEL_TRUNCATED)}</p> : null}

      {/* BESIDE WHERE THE TABLES GO, under the grid: the two choices of what is written sit together, and the typed
          pages are kept apart from the review's own Previous and Next, which move the grid and choose nothing. */}
      {pageChoice}
      {layoutChoice}
      <DialogFooter>
        <Button
          label={EXPORT_EXCEL_APPLY}
          variant="primary"
          onClick={() => {
            exportChosen(answer());
          }}
        />
      </DialogFooter>
    </div>
  );
}
