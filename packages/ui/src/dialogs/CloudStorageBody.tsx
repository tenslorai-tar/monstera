import { useLingui } from '@lingui/react';
import {
  CLOUD_PICKER_PROVIDER_IDS,
  type CloudFile,
  type CloudPickerProviderId,
  type CloudProviderId,
  type CloudRefusal,
  type CloudState,
} from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  CLOUD_EXPLAIN_SIGNED_IN,
  CLOUD_EXPLAIN_SIGNED_OUT,
  CLOUD_FILES_EMPTY,
  CLOUD_FILES_LABEL,
  CLOUD_GOOGLE_NOTE,
  CLOUD_LIST,
  CLOUD_NOTE_SIGNED_IN,
  CLOUD_NOTE_SIGNED_OUT,
  CLOUD_NOTE_UPLOADED,
  CLOUD_OPEN,
  CLOUD_PICK,
  CLOUD_PROBLEMS,
  CLOUD_PROVIDER_NAMES,
  CLOUD_SIGN_IN,
  CLOUD_SIGN_OUT,
  CLOUD_STATE_NAMES,
  CLOUD_UPLOAD,
} from '../messages/en.js';
import { byteSize } from '../byteSize.js';
import { Button } from '../primitives/Button.js';
import { DialogActions, DialogFooter, DialogScroll, DialogSection } from '../primitives/Dialog.js';
import { Icon } from '../primitives/Icon.js';
import { cloudFileLine } from '../recentLine.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { CloudAnswer } from './cloudStorage.js';

/** Whether a provider has a Picker — the contract's list, so the offer and the channel name the same providers. */
function hasPicker(provider: CloudProviderId): provider is CloudPickerProviderId {
  return (CLOUD_PICKER_PROVIDER_IDS as readonly CloudProviderId[]).includes(provider);
}

const NOTE_TEXT: Readonly<Record<'signed-in' | 'signed-out' | 'uploaded', MessageKey>> = {
  'signed-in': CLOUD_NOTE_SIGNED_IN,
  'signed-out': CLOUD_NOTE_SIGNED_OUT,
  uploaded: CLOUD_NOTE_UPLOADED,
};

/**
 * Cloud storage's body (ADR-0091): each provider with where it stands, and what can be done from
 * there. A provider not configured in this build says so and offers nothing — a sign-in button that
 * could not work would be the wired-tools defect. Google's line says what its `drive.file` scope
 * means, because a list showing only files put there from Monstera would otherwise read as broken.
 *
 * ## In the dialog pattern, one section per provider (the owner, 2 October)
 *
 * The provider's name with its state at the right, one line saying what that state offers, and its actions in one row:
 * the main action first and filled, *Sign out* quieter and apart at the row's end. The PDFs listed under it are the
 * pattern's rows. The list scrolls between the title bar and the footer's Close.
 */
export default function CloudStorageBody({
  providers,
  listing,
  documentOpen,
  problem,
  note,
  resolve,
}: {
  readonly providers: readonly { readonly provider: CloudProviderId; readonly state: CloudState }[];
  readonly listing?: { readonly provider: CloudProviderId; readonly files: readonly CloudFile[] } | undefined;
  readonly documentOpen: boolean;
  readonly problem?: CloudRefusal | undefined;
  readonly note?: 'signed-in' | 'signed-out' | 'uploaded' | undefined;
} & DialogAnswering<CloudAnswer>): ReactElement {
  const { _, i18n } = useLingui();

  /** The provider's one line: Google's scope wherever it can be reached, else what its state offers. */
  const explanation = (provider: CloudProviderId, state: CloudState): string => {
    if (state === 'not-configured') return _(CLOUD_PROBLEMS['not-configured']);
    if (provider === 'google-drive') return _(CLOUD_GOOGLE_NOTE);
    const name = _(CLOUD_PROVIDER_NAMES[provider]);
    return _(state === 'signed-in' ? CLOUD_EXPLAIN_SIGNED_IN : CLOUD_EXPLAIN_SIGNED_OUT, { provider: name });
  };

  return (
    <>
      <DialogScroll>
        {problem === undefined ? null : (
          <p className="m-cloud__problem" data-cloud-problem={problem} role="status">
            {_(CLOUD_PROBLEMS[problem])}
          </p>
        )}
        {note === undefined ? null : (
          <p className="m-cloud__note" role="status">
            {_(NOTE_TEXT[note])}
          </p>
        )}
        {providers.map(({ provider, state }) => (
          <DialogSection
            data={{ 'data-cloud-provider': provider, 'data-cloud-state': state }}
            key={provider}
            note={explanation(provider, state)}
            state={
              <>
                {state === 'signed-in' ? <Icon name="CircleCheck" size="dense" /> : null}
                <span className="m-cloud__state">{_(CLOUD_STATE_NAMES[state])}</span>
              </>
            }
            title={CLOUD_PROVIDER_NAMES[provider]}
          >
            {state === 'not-configured' ? null : (
              <DialogActions
                apart={
                  state === 'signed-in' ? (
                    <Button
                      label={CLOUD_SIGN_OUT}
                      onClick={() => {
                        resolve({ kind: 'sign-out', provider });
                      }}
                      variant="quiet"
                    />
                  ) : undefined
                }
              >
                {state === 'signed-out' ? (
                  <Button
                    label={CLOUD_SIGN_IN}
                    onClick={() => {
                      resolve({ kind: 'sign-in', provider });
                    }}
                    variant="primary"
                  />
                ) : (
                  <>
                    <Button
                      label={CLOUD_LIST}
                      onClick={() => {
                        resolve({ kind: 'list', provider });
                      }}
                      variant="primary"
                    />
                    {documentOpen ? (
                      <Button
                        label={CLOUD_UPLOAD}
                        onClick={() => {
                          resolve({ kind: 'upload', provider });
                        }}
                      />
                    ) : null}
                  </>
                )}
                {/* THE PICKER, signed in or out: choosing signs in as it goes (ADR-0091, corrected 2026-09-29). */}
                {hasPicker(provider) ? (
                  <Button
                    label={CLOUD_PICK}
                    onClick={() => {
                      resolve({ kind: 'pick', provider });
                    }}
                  />
                ) : null}
              </DialogActions>
            )}
            {listing?.provider === provider ? (
              listing.files.length === 0 ? (
                <p className="m-dialog-section__note">{_(CLOUD_FILES_EMPTY)}</p>
              ) : (
                <ul aria-label={_(CLOUD_FILES_LABEL)} className="m-cloud__files">
                  {listing.files.map((file) => {
                    const line = cloudFileLine(
                      file,
                      file.size === null ? null : byteSize(i18n, file.size),
                      new Date(),
                      i18n.locale,
                      (key, values) => _(key, values),
                    );
                    return (
                      <li className="m-dialog-row m-cloud__file" key={file.id}>
                        <span className="m-dialog-row__text">
                          <span className="m-dialog-row__label m-cloud__file-name">{file.name}</span>
                          {line === null ? null : <span className="m-dialog-row__note">{line}</span>}
                        </span>
                        <Button
                          label={CLOUD_OPEN}
                          values={{ name: file.name }}
                          onClick={() => {
                            resolve({ kind: 'open', provider, fileId: file.id });
                          }}
                        />
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
          </DialogSection>
        ))}
      </DialogScroll>
      <DialogFooter dismissal="close" />
    </>
  );
}
