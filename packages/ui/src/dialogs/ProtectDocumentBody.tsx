import { useLingui } from '@lingui/react';
import {
  DOCUMENT_PASSWORD_MAX_CHARS,
  PDF_ENCRYPTIONS,
  PDF_PERMISSIONS,
  type PdfEncryption,
  type PdfPermission,
} from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useId, useState } from 'react';

import {
  PERMISSION_ANNOTATE,
  PERMISSION_ASSEMBLE,
  PERMISSION_COPY,
  PERMISSION_FILL_FORMS,
  PERMISSION_MODIFY,
  PERMISSION_PRINT,
  PERMISSION_PRINT_HIGH_QUALITY,
  PROTECT_DOCUMENT_APPLY,
  PROTECT_DOCUMENT_EXPLAINS,
  PROTECT_DOCUMENT_NEEDS_A_PASSWORD,
  PROTECT_DOCUMENT_OWNER,
  PROTECT_DOCUMENT_PERMISSIONS,
  PROTECT_DOCUMENT_REMOVE,
  PROTECT_DOCUMENT_REMOVES,
  PROTECT_DOCUMENT_SCHEME,
  PROTECT_DOCUMENT_SCHEME_AES128,
  PROTECT_DOCUMENT_SCHEME_AES256,
  PROTECT_DOCUMENT_SCHEME_NONE,
  PROTECT_DOCUMENT_SCHEME_RC4128,
  PROTECT_DOCUMENT_SCHEME_RC440,
  PROTECT_DOCUMENT_USER,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ProtectDocumentAnswer } from './protectDocument.js';

/**
 * Each scheme's own words, keyed on the contract's list.
 *
 * **Exhaustive by the record's type**, so a scheme added to `PDF_ENCRYPTIONS`
 * is a compile error here rather than an option that renders its own
 * identifier. The weak two say what they are FOR — old readers — because a list
 * that offered `rc4-40` with no sentence would be offering a person a worse
 * choice with nothing to judge it by.
 */
const SCHEME_TITLES: Readonly<Record<PdfEncryption, MessageKey>> = {
  none: PROTECT_DOCUMENT_SCHEME_NONE,
  'aes-256': PROTECT_DOCUMENT_SCHEME_AES256,
  'aes-128': PROTECT_DOCUMENT_SCHEME_AES128,
  'rc4-128': PROTECT_DOCUMENT_SCHEME_RC4128,
  'rc4-40': PROTECT_DOCUMENT_SCHEME_RC440,
};

/** Each permission's own words, exhaustive for {@link SCHEME_TITLES}' reason. */
const PERMISSION_TITLES: Readonly<Record<PdfPermission, MessageKey>> = {
  print: PERMISSION_PRINT,
  modify: PERMISSION_MODIFY,
  copy: PERMISSION_COPY,
  annotate: PERMISSION_ANNOTATE,
  'fill-forms': PERMISSION_FILL_FORMS,
  assemble: PERMISSION_ASSEMBLE,
  'print-high-quality': PERMISSION_PRINT_HIGH_QUALITY,
};

/**
 * Set, change or remove a document's protection.
 *
 * ## The default is EVERYTHING GRANTED, and that is not a convenience
 *
 * An unprotected document grants every permission, so a dialog that opened with
 * boxes cleared would offer *protect this* and quietly mean *and take away six
 * things*. A person removes what they mean to remove.
 *
 * ## `none` HIDES the fields rather than disabling them
 *
 * A password box a person can type into and which is then discarded is the
 * display-only defect with a keyboard attached. Choosing *None* is choosing to
 * remove protection, and the dialog says what saving will then do.
 *
 * ## Both password fields are `secret`
 *
 * Which is the whole reason `Input` learned that prop. Nothing here keeps a
 * value: they live in this component's state while the dialog is open and go
 * out of scope with it (ADR-0055).
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ProtectDocumentBody({
  resolve,
}: DialogAnswering<ProtectDocumentAnswer>): ReactElement {
  const { _ } = useLingui();
  const schemeId = useId();
  const [encryption, setEncryption] = useState<PdfEncryption>('aes-256');
  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [granted, setGranted] = useState<readonly PdfPermission[]>(PDF_PERMISSIONS);

  const removing = encryption === 'none';
  const tooLong =
    userPassword.length > DOCUMENT_PASSWORD_MAX_CHARS ||
    ownerPassword.length > DOCUMENT_PASSWORD_MAX_CHARS;
  // A PASSWORD IS NOT TRIMMED — `documentPassword.ts` carries the reason: PDF
  // hands the bytes to a hash, so a password ending in a space is a password.
  const usable = removing || (!tooLong && (userPassword.length > 0 || ownerPassword.length > 0));

  return (
    <div className="m-protect-document">
      <label className="m-document-choice" htmlFor={schemeId}>
        {_(PROTECT_DOCUMENT_SCHEME)}
        {/* A NATIVE `<select>`, for `DocumentChoice`'s reason: Base UI's popup
            injects a `<style>` element and §9.27's pinned CSP admits no inline
            style, so the primitive set has no select. */}
        <select
          id={schemeId}
          data-protect-scheme=""
          onChange={(event) => {
            setEncryption(event.target.value as PdfEncryption);
          }}
          value={encryption}
        >
          {PDF_ENCRYPTIONS.map((scheme) => (
            <option key={scheme} value={scheme}>
              {_(SCHEME_TITLES[scheme])}
            </option>
          ))}
        </select>
      </label>

      {removing ? (
        <p className="m-protect-document__note">{_(PROTECT_DOCUMENT_REMOVES)}</p>
      ) : (
        <>
          <Input
            label={PROTECT_DOCUMENT_USER}
            onValueChange={setUserPassword}
            secret
            value={userPassword}
          />
          <Input
            label={PROTECT_DOCUMENT_OWNER}
            onValueChange={setOwnerPassword}
            secret
            value={ownerPassword}
          />
          <fieldset className="m-protect-document__permissions">
            <legend>{_(PROTECT_DOCUMENT_PERMISSIONS)}</legend>
            {PDF_PERMISSIONS.map((permission) => (
              <label key={permission}>
                <input
                  checked={granted.includes(permission)}
                  data-protect-permission={permission}
                  onChange={(event) => {
                    setGranted((current) =>
                      event.target.checked
                        ? [...current, permission]
                        : current.filter((held) => held !== permission),
                    );
                  }}
                  type="checkbox"
                />
                {_(PERMISSION_TITLES[permission])}
              </label>
            ))}
          </fieldset>
          <p className="m-protect-document__note">{_(PROTECT_DOCUMENT_EXPLAINS)}</p>
        </>
      )}

      <p className="m-protect-document__problem" role="status">
        {usable ? '' : _(PROTECT_DOCUMENT_NEEDS_A_PASSWORD)}
      </p>
      <Button
        disabled={!usable}
        label={removing ? PROTECT_DOCUMENT_REMOVE : PROTECT_DOCUMENT_APPLY}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute: the
          // result schema refuses both incoherent shapes, and a mismatch would
          // throw `DialogResultRejected` over the user's document.
          if (!usable) return;
          resolve(
            removing
              ? { encryption: 'none', permissions: [...PDF_PERMISSIONS] }
              : {
                  encryption,
                  // OMITTED rather than sent empty. An empty string is a
                  // password the schema refuses, and *no user password* is a
                  // real and useful state: the document opens for everybody and
                  // only its permissions are protected.
                  ...(userPassword.length > 0 ? { userPassword } : {}),
                  ...(ownerPassword.length > 0 ? { ownerPassword } : {}),
                  permissions: [...granted],
                },
          );
        }}
        variant="primary"
      />
    </div>
  );
}
