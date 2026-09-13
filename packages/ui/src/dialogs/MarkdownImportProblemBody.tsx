import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  MARKDOWN_IMPORT_ABSENT,
  MARKDOWN_IMPORT_AT_CAPACITY,
  MARKDOWN_IMPORT_CONTESTED,
  MARKDOWN_IMPORT_IMAGES_TOO_LARGE,
  MARKDOWN_IMPORT_IMAGE_UNREADABLE,
  MARKDOWN_IMPORT_IMAGE_UNREADABLE_NO_FILE,
  MARKDOWN_IMPORT_TOO_MANY_IMAGES,
  MARKDOWN_IMPORT_TOO_MANY_PIXELS,
  MARKDOWN_IMPORT_TOO_MANY_PIXELS_NO_FILE,
  MARKDOWN_IMPORT_MALFORMED_CSV,
  MARKDOWN_IMPORT_MALFORMED_CSV_NO_LINE,
  MARKDOWN_IMPORT_TOO_MANY_COLUMNS,
  MARKDOWN_IMPORT_TOO_MANY_COLUMNS_NO_LINE,
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
      // THE LINE IS NAMED WHERE THERE IS ONE, and a sentence without one where there
      // is not. A Markdown table's line can be null, and substituting a number would
      // send a person to a line that says nothing about their table.
      case 'malformed-csv':
        return props.line === null
          ? _(MARKDOWN_IMPORT_MALFORMED_CSV_NO_LINE)
          : _(MARKDOWN_IMPORT_MALFORMED_CSV, { line: props.line });
      case 'too-many-columns':
        return props.line === null
          ? _(MARKDOWN_IMPORT_TOO_MANY_COLUMNS_NO_LINE)
          : _(MARKDOWN_IMPORT_TOO_MANY_COLUMNS, { line: props.line });
      case 'destination-contested':
        return _(MARKDOWN_IMPORT_CONTESTED);
      case 'write-failed':
        return _(MARKDOWN_IMPORT_WRITE_FAILED);
      case 'absent':
        return _(MARKDOWN_IMPORT_ABSENT);
      case 'at-capacity':
        return _(MARKDOWN_IMPORT_AT_CAPACITY);
      // THE FILE IS NAMED WHERE THERE IS ONE, for the line's reason above.
      case 'image-unreadable':
        return props.file === null
          ? _(MARKDOWN_IMPORT_IMAGE_UNREADABLE_NO_FILE)
          : _(MARKDOWN_IMPORT_IMAGE_UNREADABLE, { file: props.file });
      case 'too-many-pixels':
        return props.file === null
          ? _(MARKDOWN_IMPORT_TOO_MANY_PIXELS_NO_FILE)
          : _(MARKDOWN_IMPORT_TOO_MANY_PIXELS, { file: props.file });
      case 'too-many-images':
        return _(MARKDOWN_IMPORT_TOO_MANY_IMAGES, { limit: props.limit });
      case 'images-too-large':
        return _(MARKDOWN_IMPORT_IMAGES_TOO_LARGE, {
          megabytes: Math.floor(props.limitBytes / (1024 * 1024)),
        });
    }
  }
}
