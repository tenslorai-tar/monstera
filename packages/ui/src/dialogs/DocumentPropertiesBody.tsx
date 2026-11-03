import { useLingui } from '@lingui/react';
import type { DocumentInformationFields } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';
import type { z } from 'zod';

import { byteSize } from '../byteSize.js';
import {
  DOCUMENT_PROPERTIES_APPLY,
  DOCUMENT_PROPERTIES_AUTHOR,
  DOCUMENT_PROPERTIES_BAD_DATE,
  DOCUMENT_PROPERTIES_CREATED,
  DOCUMENT_PROPERTIES_CREATOR,
  DOCUMENT_PROPERTIES_DATE_HINT,
  DOCUMENT_PROPERTIES_DATES_NOTE,
  DOCUMENT_PROPERTIES_FONTS,
  DOCUMENT_PROPERTIES_FONTS_MORE,
  DOCUMENT_PROPERTIES_KEYWORDS,
  DOCUMENT_PROPERTIES_MODIFIED,
  DOCUMENT_PROPERTIES_NO_FONTS,
  DOCUMENT_PROPERTIES_NOT_STATED,
  DOCUMENT_PROPERTIES_OPEN,
  DOCUMENT_PROPERTIES_PAGES,
  DOCUMENT_PROPERTIES_PAGES_LABEL,
  DOCUMENT_PROPERTIES_PAGES_NONE,
  DOCUMENT_PROPERTIES_ENCRYPTED,
  DOCUMENT_PROPERTIES_PERMISSION_ANNOTATE,
  DOCUMENT_PROPERTIES_PERMISSION_COPY,
  DOCUMENT_PROPERTIES_PERMISSION_EDIT,
  DOCUMENT_PROPERTIES_PERMISSION_PRINT,
  DOCUMENT_PROPERTIES_PRODUCER,
  DOCUMENT_PROPERTIES_RESTRICTED,
  DOCUMENT_PROPERTIES_SECURITY,
  DOCUMENT_PROPERTIES_SIZE,
  DOCUMENT_PROPERTIES_SIZE_NOTE,
  DOCUMENT_PROPERTIES_SUBJECT,
  DOCUMENT_PROPERTIES_TITLE_FIELD,
  DOCUMENT_PROPERTIES_VERSION,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { type DOCUMENT_PROPERTIES_PROPS, type DOCUMENT_PROPERTIES_RESULT, shownDate, typedDate } from './documentProperties.js';

const MILLIMETRES_PER_POINT = 25.4 / 72;

const PERMISSIONS = ['print', 'copy', 'edit', 'annotate'] as const;

/** Each permission's name, keyed so a permission the read gains arrives owing its words. */
const PERMISSION_NAMES: Readonly<Record<(typeof PERMISSIONS)[number], MessageKey>> = {
  print: DOCUMENT_PROPERTIES_PERMISSION_PRINT,
  copy: DOCUMENT_PROPERTIES_PERMISSION_COPY,
  edit: DOCUMENT_PROPERTIES_PERMISSION_EDIT,
  annotate: DOCUMENT_PROPERTIES_PERMISSION_ANNOTATE,
};

type Props = z.infer<typeof DOCUMENT_PROPERTIES_PROPS>;

/**
 * The properties window's body (ADR-0283): the four texts and two dates to edit, then what the document is, read only,
 * and under the dates the sentence that they are the PDF's own. *Apply* answers the six; a date that is not one is said
 * beside it and holds the answer back. A default export because `declareDialog` takes a `lazy()` component.
 */
export default function DocumentPropertiesBody({
  information,
  fonts,
  fontsTruncated,
  bytes,
  resolve,
}: Props & DialogAnswering<z.infer<typeof DOCUMENT_PROPERTIES_RESULT>>): ReactElement {
  const { _, i18n } = useLingui();
  const start = information.fields;
  const [title, setTitle] = useState(start.title);
  const [author, setAuthor] = useState(start.author);
  const [subject, setSubject] = useState(start.subject);
  const [keywords, setKeywords] = useState(start.keywords);
  const [created, setCreated] = useState(shownDate(start.created));
  const [modified, setModified] = useState(shownDate(start.modified));

  const createdDate = typedDate(created);
  const modifiedDate = typedDate(modified);
  const restricted = Object.entries(information.permissions).some(([, allowed]) => !allowed);
  const page = information.firstPage;

  return (
    <div className="m-document-properties">
      <Input label={DOCUMENT_PROPERTIES_TITLE_FIELD} value={title} onValueChange={setTitle} opensFocused />
      <Input label={DOCUMENT_PROPERTIES_AUTHOR} value={author} onValueChange={setAuthor} />
      <Input label={DOCUMENT_PROPERTIES_SUBJECT} value={subject} onValueChange={setSubject} />
      <Input label={DOCUMENT_PROPERTIES_KEYWORDS} value={keywords} onValueChange={setKeywords} />
      <DialogRow label={DOCUMENT_PROPERTIES_CREATED} problem={createdDate === undefined ? _(DOCUMENT_PROPERTIES_BAD_DATE) : undefined}>
        <Input
          label={DOCUMENT_PROPERTIES_CREATED}
          labelShownBeside
          value={created}
          onValueChange={setCreated}
          placeholder={DOCUMENT_PROPERTIES_DATE_HINT}
          invalid={createdDate === undefined}
          // A TIMESTAMP, with its zone: past the browser's twenty characters (ADR-0157).
          runsLong
        />
      </DialogRow>
      <DialogRow label={DOCUMENT_PROPERTIES_MODIFIED} problem={modifiedDate === undefined ? _(DOCUMENT_PROPERTIES_BAD_DATE) : undefined}>
        <Input
          label={DOCUMENT_PROPERTIES_MODIFIED}
          labelShownBeside
          value={modified}
          onValueChange={setModified}
          placeholder={DOCUMENT_PROPERTIES_DATE_HINT}
          invalid={modifiedDate === undefined}
          runsLong
        />
      </DialogRow>
      <p className="m-dialog-section__note">{_(DOCUMENT_PROPERTIES_DATES_NOTE)}</p>

      <dl className="m-dialog-facts">
        <dt>{_(DOCUMENT_PROPERTIES_CREATOR)}</dt>
        <dd>{information.creator ?? _(DOCUMENT_PROPERTIES_NOT_STATED)}</dd>
        <dt>{_(DOCUMENT_PROPERTIES_PRODUCER)}</dt>
        <dd>{information.producer ?? _(DOCUMENT_PROPERTIES_NOT_STATED)}</dd>
        <dt>{_(DOCUMENT_PROPERTIES_VERSION)}</dt>
        <dd>{information.format === '' ? _(DOCUMENT_PROPERTIES_NOT_STATED) : information.format}</dd>
        <dt>{_(DOCUMENT_PROPERTIES_PAGES_LABEL)}</dt>
        <dd>
          {_(page === null ? DOCUMENT_PROPERTIES_PAGES_NONE : DOCUMENT_PROPERTIES_PAGES, {
            count: information.pageCount,
            width: page === null ? 0 : Math.round(page.width * MILLIMETRES_PER_POINT),
            height: page === null ? 0 : Math.round(page.height * MILLIMETRES_PER_POINT),
          })}
        </dd>
        <dt>{_(DOCUMENT_PROPERTIES_SIZE)}</dt>
        <dd>
          {byteSize(i18n, bytes)}
          {/* THE DOCUMENT AS IT STANDS NOW, unsaved edits included (ADR-0283's answers), so the line says why it can differ from the file's own size. */}
          <p className="m-dialog-section__note">{_(DOCUMENT_PROPERTIES_SIZE_NOTE)}</p>
        </dd>
        <dt>{_(DOCUMENT_PROPERTIES_SECURITY)}</dt>
        <dd>
          {information.encryption === 'None' ? _(DOCUMENT_PROPERTIES_OPEN) : _(DOCUMENT_PROPERTIES_ENCRYPTED, { method: information.encryption })}
          {restricted
            ? ` ${_(DOCUMENT_PROPERTIES_RESTRICTED, {
                actions: PERMISSIONS.filter((permission) => !information.permissions[permission]).map((permission) => _(PERMISSION_NAMES[permission])).join(', '),
              })}`
            : null}
        </dd>
        <dt>{_(DOCUMENT_PROPERTIES_FONTS)}</dt>
        <dd>
          {fonts.length === 0 ? _(DOCUMENT_PROPERTIES_NO_FONTS) : fonts.map((font) => font.name).join(', ')}
          {fontsTruncated ? ` ${_(DOCUMENT_PROPERTIES_FONTS_MORE)}` : null}
        </dd>
      </dl>

      <DialogFooter>
        <Button
          label={DOCUMENT_PROPERTIES_APPLY}
          variant="primary"
          disabled={createdDate === undefined || modifiedDate === undefined}
          onClick={() => {
            if (createdDate === undefined || modifiedDate === undefined) return;
            const fields: DocumentInformationFields = { title, author, subject, keywords, created: createdDate, modified: modifiedDate };
            resolve({ fields });
          }}
        />
      </DialogFooter>
    </div>
  );
}
