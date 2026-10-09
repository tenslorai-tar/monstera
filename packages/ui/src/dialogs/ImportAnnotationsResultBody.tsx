import { useLingui } from '@lingui/react';
import type { AnnotationImportReport, AnnotationImportSkipped } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import {
  COMMENTS_IMPORT_COUNT, COMMENTS_IMPORT_EMPTY, COMMENTS_IMPORT_MISSING_PAGE,
  COMMENTS_IMPORT_UNSUPPORTED, COMMENTS_IMPORT_INVALID, COMMENTS_IMPORT_MORE,
  COMMENTS_IMPORT_FIELDS,
  COMMENTS_IMPORT_MISSING_ENTRY,
} from '../messages/en.js';

const REASON_TITLES: Readonly<Record<AnnotationImportSkipped['reason'], MessageKey>> = {
  'missing-page': COMMENTS_IMPORT_MISSING_PAGE,
  'unsupported-kind': COMMENTS_IMPORT_UNSUPPORTED,
  'missing-entry': COMMENTS_IMPORT_MISSING_ENTRY,
  'invalid-entry': COMMENTS_IMPORT_INVALID,
};

/** Reports the contained planner's counts and record numbers, without guessing at a failure. */
export default function ImportAnnotationsResultBody(report: AnnotationImportReport): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-import-result">
      <p>{_(report.total === 0 ? COMMENTS_IMPORT_EMPTY : COMMENTS_IMPORT_COUNT, { count: report.imported })}</p>
      <ul className="m-dialog-list">
        {report.skipped.map((skip) => (
          <li key={skip.comment}>
            {_(REASON_TITLES[skip.reason],
            { comment: skip.comment, page: skip.page ?? 0, pages: report.pages,
              field: _(COMMENTS_IMPORT_FIELDS[skip.field ?? 'entry']) })}
          </li>
        ))}
      </ul>
      {report.more > 0 ? <p>{_(COMMENTS_IMPORT_MORE, { count: report.more, listed: report.skipped.length })}</p> : null}
    </div>
  );
}
