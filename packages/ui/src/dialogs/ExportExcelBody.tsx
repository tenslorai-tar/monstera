import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  EXPORT_EXCEL_APPLY,
  EXPORT_EXCEL_LAYOUT,
  EXPORT_EXCEL_ONE_SHEET,
  EXPORT_EXCEL_SHEET_PER_PAGE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ExportExcelAnswer } from './exportExcel.js';

type SheetLayout = ExportExcelAnswer['layout'];

/** Each layout and the sentence that says what a person gets, as a record so a third arrives owing its words. */
const LAYOUTS: Readonly<Record<SheetLayout, MessageKey>> = {
  'sheet-per-page': EXPORT_EXCEL_SHEET_PER_PAGE,
  'one-sheet': EXPORT_EXCEL_ONE_SHEET,
};

/**
 * The Excel export dialog's body: a sheet for each page, or every table on one.
 *
 * **A sheet per page is selected first**: it keeps where each table came from,
 * which one sheet loses, and combining is the choice a person makes on purpose.
 */
export default function ExportExcelBody({ resolve }: DialogAnswering<ExportExcelAnswer>): ReactElement {
  const { _ } = useLingui();
  const [layout, setLayout] = useState<SheetLayout>('sheet-per-page');

  return (
    <div className="m-export-excel">
      <fieldset className="m-export-excel__layout">
        <legend>{_(EXPORT_EXCEL_LAYOUT)}</legend>
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
      </fieldset>
      <Button
        label={EXPORT_EXCEL_APPLY}
        variant="primary"
        onClick={() => {
          resolve({ layout });
        }}
      />
    </div>
  );
}
