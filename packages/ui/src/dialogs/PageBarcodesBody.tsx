import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  PAGE_BARCODES_COPY,
  PAGE_BARCODES_COPY_ALL,
  PAGE_BARCODES_CONTENT,
  PAGE_BARCODES_FIELD_ADDRESS,
  PAGE_BARCODES_FIELD_COMPANY,
  PAGE_BARCODES_FIELD_EMAIL,
  PAGE_BARCODES_FIELD_NAME,
  PAGE_BARCODES_FIELD_PHONE,
  PAGE_BARCODES_FIELD_TITLE,
  PAGE_BARCODES_FIELD_WEB,
  PAGE_BARCODES_FOUND,
  PAGE_BARCODES_FOUND_ALL,
  PAGE_BARCODES_KIND_CONTACT,
  PAGE_BARCODES_KIND_EMAIL,
  PAGE_BARCODES_KIND_LINK,
  PAGE_BARCODES_KIND_PHONE,
  PAGE_BARCODES_KIND_TEXT,
  PAGE_BARCODES_NONE,
  PAGE_BARCODES_NONE_ALL,
  PAGE_BARCODES_OPEN,
  PAGE_BARCODES_PAGE,
  PAGE_BARCODES_READ_ALL,
  PAGE_BARCODES_REFUSED,
  PAGE_BARCODES_TRUNCATED,
  PAGE_BARCODES_TYPE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogScroll } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { type BarcodeContent, type ContactFields, classifyBarcode, friendlyFormat, textToCopy } from './barcodeContent.js';
import type { PageBarcodesReport } from './pageBarcodes.js';

type PageBarcodesProps =
  | {
      readonly kind: 'read';
      readonly page: number;
      readonly all: boolean;
      readonly pageCount: number;
      readonly barcodes: readonly {
        readonly format: string;
        readonly text: string;
        readonly page: number;
        readonly index: number;
      }[];
      readonly truncated: boolean;
    }
  | { readonly kind: 'refused'; readonly page: number };

const KIND_LABELS = {
  link: PAGE_BARCODES_KIND_LINK,
  phone: PAGE_BARCODES_KIND_PHONE,
  email: PAGE_BARCODES_KIND_EMAIL,
  contact: PAGE_BARCODES_KIND_CONTACT,
  text: PAGE_BARCODES_KIND_TEXT,
} as const satisfies Record<BarcodeContent['kind'], unknown>;

/**
 * The barcode read's body: each barcode's type by its everyday name, what its text IS, the text itself — a contact card as
 * its lines — and the actions that fit it: *Copy* on every row, *Open link* on a web link, *Copy all* for the list, and *Read
 * barcodes on all pages*.
 *
 * ## The text is DATA, never a message key, and never opened by being read
 *
 * The content is the document's, so it is not translated. A web link is a button, and the press is the person's: the dialog
 * only reports `open` with the barcode's page and place, and `main` reads the address from the document and opens it only
 * when its scheme is one that is followed (invariant 24).
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function PageBarcodesBody(props: PageBarcodesProps & DialogAnswering<PageBarcodesReport>): ReactElement {
  const { _, i18n } = useLingui();
  const shown = new Intl.NumberFormat(i18n.locale).format(props.page);

  if (props.kind === 'refused') {
    return (
      <>
        <p className="m-page-barcodes" data-refused="true">
          {_(PAGE_BARCODES_REFUSED, { page: shown })}
        </p>
        <DialogFooter dismissal="close" />
      </>
    );
  }
  const { barcodes, all, pageCount, update } = props;
  const readAll =
    all || pageCount < 2 ? undefined : (
      <Button
        label={PAGE_BARCODES_READ_ALL}
        onClick={() => {
          update({ kind: 'read-all' });
        }}
      />
    );
  if (barcodes.length === 0) {
    return (
      <>
        <p className="m-page-barcodes">{all ? _(PAGE_BARCODES_NONE_ALL) : _(PAGE_BARCODES_NONE, { page: shown })}</p>
        <DialogFooter aside={readAll} dismissal="close" />
      </>
    );
  }
  return (
    <>
      <DialogScroll label={_(PAGE_BARCODES_CONTENT)}>
        <div className="m-page-barcodes">
          <p>
            {all
              ? _(PAGE_BARCODES_FOUND_ALL, { count: barcodes.length })
              : _(PAGE_BARCODES_FOUND, { count: barcodes.length, page: shown })}
          </p>
          <table className="m-page-barcodes__table">
            <thead>
              <tr>
                {all ? <th scope="col">{_(PAGE_BARCODES_PAGE)}</th> : null}
                <th scope="col">{_(PAGE_BARCODES_TYPE)}</th>
                <th scope="col">{_(PAGE_BARCODES_CONTENT)}</th>
                <td />
              </tr>
            </thead>
            <tbody>
              {barcodes.map((barcode, at) => {
                const content = classifyBarcode(barcode.text);
                const number = at + 1;
                return (
                  // THE POSITION IS THE KEY: two identical labels on one page are two barcodes.
                  <tr key={at}>
                    {all ? <td>{new Intl.NumberFormat(i18n.locale).format(barcode.page)}</td> : null}
                    <td>{friendlyFormat(barcode.format)}</td>
                    <td className="m-page-barcodes__content">
                      <span className="m-page-barcodes__kind">{_(KIND_LABELS[content.kind])}</span>
                      {content.kind === 'contact' ? (
                        <ContactLines contact={content.contact} />
                      ) : (
                        <span className="m-page-barcodes__text">{barcode.text}</span>
                      )}
                    </td>
                    <td className="m-page-barcodes__actions">
                      {content.kind === 'link' ? (
                        <Button
                          label={PAGE_BARCODES_OPEN}
                          values={{ number }}
                          icon="ExternalLink"
                          iconOnly
                          onClick={() => {
                            update({ kind: 'open', page: barcode.page, index: barcode.index });
                          }}
                        />
                      ) : null}
                      <Button
                        label={PAGE_BARCODES_COPY}
                        values={{ number }}
                        icon="Copy"
                        iconOnly
                        onClick={() => {
                          update({ kind: 'copy', text: textToCopy(barcode.text) });
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {props.truncated ? <p>{_(PAGE_BARCODES_TRUNCATED)}</p> : null}
        </div>
      </DialogScroll>
      <DialogFooter
        aside={
          <>
            <Button
              label={PAGE_BARCODES_COPY_ALL}
              onClick={() => {
                update({ kind: 'copy-all' });
              }}
            />
            {readAll}
          </>
        }
        dismissal="close"
      />
    </>
  );
}

/** A contact card as name, title, company, phone, email and address lines — never the card's own markup. */
function ContactLines({ contact }: { readonly contact: ContactFields }): ReactElement {
  const { _ } = useLingui();
  const rows: readonly (readonly [typeof PAGE_BARCODES_FIELD_NAME, string])[] = [
    ...(contact.name === undefined ? [] : [[PAGE_BARCODES_FIELD_NAME, contact.name] as const]),
    ...(contact.title === undefined ? [] : [[PAGE_BARCODES_FIELD_TITLE, contact.title] as const]),
    ...(contact.company === undefined ? [] : [[PAGE_BARCODES_FIELD_COMPANY, contact.company] as const]),
    ...contact.phones.map((phone) => [PAGE_BARCODES_FIELD_PHONE, phone] as const),
    ...contact.emails.map((email) => [PAGE_BARCODES_FIELD_EMAIL, email] as const),
    ...(contact.address === undefined ? [] : [[PAGE_BARCODES_FIELD_ADDRESS, contact.address] as const]),
    ...contact.web.map((page) => [PAGE_BARCODES_FIELD_WEB, page] as const),
  ];
  return (
    <dl className="m-page-barcodes__contact">
      {rows.map(([label, value], at) => (
        <div key={at}>
          <dt>{_(label)}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
