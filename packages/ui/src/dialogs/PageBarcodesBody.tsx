import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  PAGE_BARCODES_CONTENT,
  PAGE_BARCODES_FOUND,
  PAGE_BARCODES_NONE,
  PAGE_BARCODES_REFUSED,
  PAGE_BARCODES_TRUNCATED,
  PAGE_BARCODES_TYPE,
} from '../messages/en.js';

type PageBarcodesProps =
  | {
      readonly kind: 'read';
      readonly page: number;
      readonly barcodes: readonly { readonly format: string; readonly text: string }[];
      readonly truncated: boolean;
    }
  | { readonly kind: 'refused'; readonly page: number };

/**
 * The barcode read's body: each barcode's type and what it says, in the order the reader found
 * them.
 *
 * ## Both columns are DATA, never message keys
 *
 * The type is zxing-cpp's name and the content is the document's, so neither is translated. The
 * content is selectable text, which is how a person copies a number or a link out of it — and it
 * is never made a link here: a URL in a barcode is a document's content, and opening one runs
 * nothing until a person chooses to (invariant 24).
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function PageBarcodesBody(props: PageBarcodesProps): ReactElement {
  const { _, i18n } = useLingui();
  const page = new Intl.NumberFormat(i18n.locale).format(props.page);

  if (props.kind === 'refused') {
    return (
      <p className="m-page-barcodes" data-refused="true">
        {_(PAGE_BARCODES_REFUSED, { page })}
      </p>
    );
  }
  if (props.barcodes.length === 0) {
    return <p className="m-page-barcodes">{_(PAGE_BARCODES_NONE, { page })}</p>;
  }
  return (
    <div className="m-page-barcodes">
      <p>{_(PAGE_BARCODES_FOUND, { count: props.barcodes.length, page })}</p>
      <table className="m-page-barcodes__table">
        <thead>
          <tr>
            <th scope="col">{_(PAGE_BARCODES_TYPE)}</th>
            <th scope="col">{_(PAGE_BARCODES_CONTENT)}</th>
          </tr>
        </thead>
        <tbody>
          {props.barcodes.map((barcode, at) => (
            // THE POSITION IS THE KEY: two identical labels on one page are two barcodes.
            <tr key={at}>
              <td lang="en">{barcode.format}</td>
              <td className="m-page-barcodes__content">{barcode.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.truncated ? <p>{_(PAGE_BARCODES_TRUNCATED)}</p> : null}
    </div>
  );
}
