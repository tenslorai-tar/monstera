import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  SIGNATURES_APPENDED,
  SIGNATURES_CHANGED,
  SIGNATURES_INTACT,
  SIGNATURES_NONE,
  SIGNATURES_NOT_TRUSTED,
  SIGNATURES_UNREADABLE,
  SIGNATURES_VALID_BETWEEN,
} from '../messages/en.js';
import type { ShownSignature } from './signatures.js';

/**
 * What the document's signatures say.
 *
 * ## THREE OUTCOMES PER SIGNATURE, never one tick
 *
 * *Intact*, *the document changed since this was signed*, and *something was
 * appended this signature says nothing about* are three different facts, and
 * the third is the one a single indicator hides: a reader that folded them
 * would show an intact signature over half a document.
 *
 * ## And a sentence that says what this does NOT check
 *
 * The digest is verified; the certificate's **trust** is not. Chain building,
 * revocation and trust anchors are a different question, and a panel that
 * showed a tick without saying so would be making the promise
 * ADR-0054 explicitly does not make. The sentence is on screen rather than in
 * this comment, because the person deciding whether to trust the document is
 * the one who needs it.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SignaturesBody({
  signatures,
  unreadable,
}: {
  readonly signatures: readonly ShownSignature[];
  readonly unreadable: boolean;
}): ReactElement {
  const { _ } = useLingui();

  if (signatures.length === 0) {
    return (
      <div className="m-signatures">
        <p>{_(unreadable ? SIGNATURES_UNREADABLE : SIGNATURES_NONE)}</p>
      </div>
    );
  }

  return (
    <div className="m-signatures">
      <ul className="m-signatures__list">
        {signatures.map((signature, index) => (
          <li className="m-signatures__item" data-signature={index} key={index}>
            <p className="m-signatures__signer">
              {signature.signer}
              {signature.organisation === '' ? '' : ` — ${signature.organisation}`}
            </p>
            <p
              className="m-signatures__state"
              data-covers={String(signature.coversDocument && signature.coversWholeFile)}
            >
              {_(
                !signature.coversDocument
                  ? SIGNATURES_CHANGED
                  : signature.coversWholeFile
                    ? SIGNATURES_INTACT
                    : SIGNATURES_APPENDED,
              )}
            </p>
            {signature.reason === '' ? null : <p>{signature.reason}</p>}
            {signature.location === '' ? null : <p>{signature.location}</p>}
            <p className="m-signatures__validity">
              {_(SIGNATURES_VALID_BETWEEN, {
                from: signature.notBefore.slice(0, 10),
                to: signature.notAfter.slice(0, 10),
              })}
            </p>
          </li>
        ))}
      </ul>
      <p className="m-signatures__note">{_(SIGNATURES_NOT_TRUSTED)}</p>
    </div>
  );
}
