import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  EXPORT_PAGES_APPLY,
  EXPORT_POWERPOINT_EDITABLE,
  EXPORT_POWERPOINT_EDITABLE_NOTE,
  EXPORT_POWERPOINT_EXACT,
  EXPORT_POWERPOINT_EXACT_NOTE,
  EXPORT_POWERPOINT_MODE,
  EXPORT_POWERPOINT_MODE_NOTE,
  EXPORT_POWERPOINT_PAGES_NOTE,
  PAGE_RANGE_EXPORT_EMPTY,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { type DialogChoice, DialogChoices, DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ExportPowerPointAnswer } from './exportPowerPoint.js';
import { PageRangeChoice, usePageRange } from './PageRangeChoice.js';

type Mode = ExportPowerPointAnswer['mode'];

/** Each mode, its short name and the sentence that says what a person gets, keyed so a third mode arrives owing its words. */
const MODES: Readonly<Record<Mode, Omit<DialogChoice<Mode>, 'value'>>> = {
  editable: { label: EXPORT_POWERPOINT_EDITABLE, note: EXPORT_POWERPOINT_EDITABLE_NOTE },
  exact: { label: EXPORT_POWERPOINT_EXACT, note: EXPORT_POWERPOINT_EXACT_NOTE },
};

/**
 * The PowerPoint export dialog's body: which pages, and whether the slides are editable or an exact picture of each page
 * ([ADR-0210](../../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 *
 * **Editable is selected first**, the owner's answer: people exporting to PowerPoint most often mean to change what they get.
 * The choice is not remembered, so the dialog is the same every time it opens. The file is main's to pick after this, so the
 * button names that next step, as the other exports' do.
 */
export default function ExportPowerPointBody({
  pageCount,
  resolve,
}: { readonly pageCount: number } & DialogAnswering<ExportPowerPointAnswer>): ReactElement {
  const range = usePageRange(pageCount);
  const [mode, setMode] = useState<Mode>('editable');

  return (
    <div className="m-export-powerpoint">
      <PageRangeChoice empty={PAGE_RANGE_EXPORT_EMPTY} note={EXPORT_POWERPOINT_PAGES_NOTE} range={range} />
      <DialogChoices<Mode>
        label={EXPORT_POWERPOINT_MODE}
        note={EXPORT_POWERPOINT_MODE_NOTE}
        options={(Object.keys(MODES) as Mode[]).map((value) => ({ value, ...MODES[value] }))}
        value={mode}
        onChange={setMode}
      />
      <DialogFooter>
        <Button
          label={EXPORT_PAGES_APPLY}
          variant="primary"
          onClick={() => {
            const pages = range.proceed();
            if (pages === undefined) return;
            resolve({ mode, pages: [...pages] });
          }}
        />
      </DialogFooter>
    </div>
  );
}
