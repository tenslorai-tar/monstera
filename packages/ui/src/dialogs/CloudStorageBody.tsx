import { useLingui } from '@lingui/react';
import type { CloudFile, CloudProviderId, CloudRefusal, CloudState } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  CLOUD_FILES_EMPTY,
  CLOUD_FILES_LABEL,
  CLOUD_GOOGLE_NOTE,
  CLOUD_LIST,
  CLOUD_NOTE_SIGNED_IN,
  CLOUD_NOTE_SIGNED_OUT,
  CLOUD_NOTE_UPLOADED,
  CLOUD_OPEN,
  CLOUD_PROBLEMS,
  CLOUD_PROVIDER_NAMES,
  CLOUD_SIGN_IN,
  CLOUD_SIGN_OUT,
  CLOUD_STATE_NAMES,
  CLOUD_UPLOAD,
} from '../messages/en.js';
import { byteSize } from '../byteSize.js';
import { Button } from '../primitives/Button.js';
import { cloudFileLine } from '../recentLine.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { CloudAnswer } from './cloudStorage.js';

const NOTE_TEXT: Readonly<Record<'signed-in' | 'signed-out' | 'uploaded', MessageKey>> = {
  'signed-in': CLOUD_NOTE_SIGNED_IN,
  'signed-out': CLOUD_NOTE_SIGNED_OUT,
  uploaded: CLOUD_NOTE_UPLOADED,
};

/**
 * Cloud storage's body (ADR-0091): each provider with where it stands, and what can be done from
 * there. A provider not configured in this build says so and offers nothing — a sign-in button that
 * could not work would be the wired-tools defect. Google's row says what its `drive.file` scope
 * means, because a list showing only files put there from Monstera would otherwise read as broken.
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

  return (
    <div className="m-cloud">
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
      <ul className="m-cloud__providers">
        {providers.map(({ provider, state }) => (
          <li className="m-cloud__provider" data-cloud-provider={provider} data-cloud-state={state} key={provider}>
            <div className="m-cloud__heading">
              <strong>{_(CLOUD_PROVIDER_NAMES[provider])}</strong>
              <span className="m-cloud__state">{_(CLOUD_STATE_NAMES[state])}</span>
            </div>
            {provider === 'google-drive' && state !== 'not-configured' ? (
              <p className="m-cloud__hint">{_(CLOUD_GOOGLE_NOTE)}</p>
            ) : null}
            {state === 'not-configured' ? null : (
              <div className="m-cloud__actions">
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
                    <Button
                      label={CLOUD_SIGN_OUT}
                      onClick={() => {
                        resolve({ kind: 'sign-out', provider });
                      }}
                    />
                  </>
                )}
              </div>
            )}
            {listing?.provider === provider ? (
              listing.files.length === 0 ? (
                <p className="m-cloud__hint">{_(CLOUD_FILES_EMPTY)}</p>
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
                    <li className="m-cloud__file" key={file.id}>
                      <span className="m-cloud__file-name">
                        {file.name}
                        {line === null ? null : <span className="m-cloud__file-meta">{line}</span>}
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
          </li>
        ))}
      </ul>
    </div>
  );
}
