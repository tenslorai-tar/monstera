import type { ReactElement } from 'react';

import { EXPORT_PAGES_APPLY, EXPORT_TEXT_PAGES_NOTE, PAGE_RANGE_EXPORT_EMPTY } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ExportPagesAnswer, ExportPagesProps } from './exportPages.js';
import { PageRangeChoice, usePageRange } from './PageRangeChoice.js';

/**
 * The body of an export whose one question is the pages: both text exports (ADR-0161).
 *
 * Main picks the file after this, so the button names that next step, as the other exports' do.
 */
export default function ExportPagesBody({
  pageCount,
  resolve,
}: ExportPagesProps & DialogAnswering<ExportPagesAnswer>): ReactElement {
  const range = usePageRange(pageCount);

  return (
    <div className="m-export-pages">
      <PageRangeChoice empty={PAGE_RANGE_EXPORT_EMPTY} note={EXPORT_TEXT_PAGES_NOTE} range={range} />
      <DialogFooter>
        <Button
          label={EXPORT_PAGES_APPLY}
          variant="primary"
          onClick={() => {
            const pages = range.proceed();
            if (pages === undefined) return;
            resolve({ pages: [...pages] });
          }}
        />
      </DialogFooter>
    </div>
  );
}
