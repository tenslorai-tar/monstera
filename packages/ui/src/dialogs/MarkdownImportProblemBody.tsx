import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  MARKDOWN_IMPORT_ABSENT,
  MARKDOWN_IMPORT_AT_CAPACITY,
  MARKDOWN_IMPORT_CONTESTED,
  MARKDOWN_IMPORT_NOTHING_TO_DRAW,
  MARKDOWN_IMPORT_NOT_UTF8,
  MARKDOWN_IMPORT_TOO_LARGE,
  MARKDOWN_IMPORT_UNENCODABLE,
  MARKDOWN_IMPORT_UNENCODABLE_LINE,
  MARKDOWN_IMPORT_UNREADABLE,
  MARKDOWN_IMPORT_WRITE_FAILED,
} from '../messages/en.js';
import type { MarkdownImportProblem } from './markdownImportProblem.js';

/**
 * The Markdown import problem dialog's body.
 *
 * `InsertImageProblemBody`'s rules: each sentence says what happened to the person's
 * work, and the limit is converted to megabytes at the point of display. The two
 * reasons that follow a WRITE say the PDF was saved, because it was.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function MarkdownImportProblemBody(props: MarkdownImportProblem): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-markdown-import-problem">
      <p>{sentence()}</p>
    </div>
  );

  function sentence(): string {
    switch (props.reason) {
      case 'unreadable':
        return _(MARKDOWN_IMPORT_UNREADABLE);
      case 'too-large':
        return _(MARKDOWN_IMPORT_TOO_LARGE, {
          megabytes: Math.floor(props.limitBytes / (1024 * 1024)),
        });
      case 'not-utf8':
        return _(MARKDOWN_IMPORT_NOT_UTF8);
      case 'unencodable-text':
        return props.line === null
          ? _(MARKDOWN_IMPORT_UNENCODABLE)
          : _(MARKDOWN_IMPORT_UNENCODABLE_LINE, { line: props.line });
      case 'nothing-to-draw':
        return _(MARKDOWN_IMPORT_NOTHING_TO_DRAW);
      case 'destination-contested':
        return _(MARKDOWN_IMPORT_CONTESTED);
      case 'write-failed':
        return _(MARKDOWN_IMPORT_WRITE_FAILED);
      case 'absent':
        return _(MARKDOWN_IMPORT_ABSENT);
      case 'at-capacity':
        return _(MARKDOWN_IMPORT_AT_CAPACITY);
    }
  }
}
