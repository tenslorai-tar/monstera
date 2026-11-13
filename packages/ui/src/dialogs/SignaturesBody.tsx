import { useLingui } from '@lingui/react';
import { type ReactElement, useEffect, useRef } from 'react';

import {
  SIGNATURES_APPENDED,
  SIGNATURES_CERTIFICATE,
  SIGNATURES_CHANGED,
  SIGNATURES_INTACT,
  SIGNATURES_LOCATION,
  SIGNATURES_NONE,
  SIGNATURES_NOT_TRUSTED,
  SIGNATURES_REASON,
  SIGNATURES_SAVE_SIGNED_VERSION,
  SIGNATURES_SIGNER,
  SIGNATURES_SIGNER_OF,
  SIGNATURES_STATUS,
  SIGNATURES_UNREADABLE,
  SIGNATURES_VALID_BETWEEN,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogScroll, DialogSection } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
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
  verified,
  resolve,
  update,
}: {
  readonly signatures: readonly ShownSignature[];
  readonly unreadable: boolean;
  readonly verified: readonly number[];
} & DialogAnswering<{ readonly signedThrough: number } | { readonly shown: true }>): ReactElement {
  const { _ } = useLingui();

  // SHOWN, said ONCE, after the window is drawn: the opener checks each signed version from here, never before. Once
  // by a ref and not by `update`'s identity, which changes with each reply (`RegionReadBody`'s reason): a second report
  // would start the checks again.
  const told = useRef(false);
  useEffect(() => {
    if (told.current) return;
    told.current = true;
    update({ shown: true });
  });

  if (signatures.length === 0) {
    return (
      <div className="m-signatures">
        <p>{_(unreadable ? SIGNATURES_UNREADABLE : SIGNATURES_NONE)}</p>
        <DialogFooter dismissal="close" />
      </div>
    );
  }

  // THE LIST SCROLLS, NOT THE BODY: with the body scrolling, two signatures with long strings put Close below the fold
  // at 760 x 560 (seen 2026-10-03). A fragment, so the scroll part is the body's own child, which the layout keys on;
  // the sentence about trust stays in view beside the footer.
  return (
    <>
      <DialogScroll>
        {/* A SECTION PER SIGNATURE, its signer as the heading and each fact NAMED beside its value: as bullets, a
            reason and a place read as two bare lines nobody could tell apart (*"I approve this report"*, *"Head
            office"*), the owner's review 1c. */}
        {signatures.map((signature, index) => (
          <DialogSection
            data={{ 'data-signature': String(index) }}
            key={index}
            title={signature.organisation === '' ? SIGNATURES_SIGNER : SIGNATURES_SIGNER_OF}
            values={{ signer: signature.signer, organisation: signature.organisation }}
          >
            <dl className="m-dialog-facts">
              <dt>{_(SIGNATURES_STATUS)}</dt>
              <dd data-covers={String(signature.coversDocument && signature.coversWholeFile)}>
                {_(
                  !signature.coversDocument
                    ? SIGNATURES_CHANGED
                    : signature.coversWholeFile
                      ? SIGNATURES_INTACT
                      : SIGNATURES_APPENDED,
                )}
              </dd>
              {signature.reason === '' ? null : (
                <>
                  <dt>{_(SIGNATURES_REASON)}</dt>
                  <dd>{signature.reason}</dd>
                </>
              )}
              {signature.location === '' ? null : (
                <>
                  <dt>{_(SIGNATURES_LOCATION)}</dt>
                  <dd>{signature.location}</dd>
                </>
              )}
              <dt>{_(SIGNATURES_CERTIFICATE)}</dt>
              <dd>
                {_(SIGNATURES_VALID_BETWEEN, {
                  from: signature.notBefore.slice(0, 10),
                  to: signature.notAfter.slice(0, 10),
                })}
              </dd>
            </dl>
            {/* THE SIGNED VERSION, offered where the file holds more than this signature signed, or it no longer reads
                as signed, AND main has checked that its cut is in the file and verifies (ADR-0291 Decision 7, as
                written): a button that could only answer "could not be found" is not offered. */}
            {(signature.coversDocument && signature.coversWholeFile) || !verified.includes(signature.signedThrough) ? null : (
              <Button
                label={SIGNATURES_SAVE_SIGNED_VERSION}
                onClick={() => {
                  resolve({ signedThrough: signature.signedThrough });
                }}
              />
            )}
          </DialogSection>
        ))}
      </DialogScroll>
      <p className="m-signatures__note">{_(SIGNATURES_NOT_TRUSTED)}</p>
      <DialogFooter dismissal="close" />
    </>
  );
}
