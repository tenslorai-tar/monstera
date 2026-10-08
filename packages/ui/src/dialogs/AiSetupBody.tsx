import { useLingui } from '@lingui/react';
import { AI_PROVIDER_IDS, type AiProviderId } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, useState } from 'react';

import {
  AI_PROVIDER_NAMES,
  AI_SETUP_AZURE_NOTE,
  AI_SETUP_CHECK,
  AI_SETUP_CHOOSE_PROVIDER,
  AI_SETUP_GET_KEY,
  AI_SETUP_KEY_NEEDED,
  AI_SETUP_ENDPOINT,
  AI_SETUP_INTRO,
  AI_SETUP_KEY,
  AI_SETUP_NOT_STORED,
  AI_SETUP_NOT_THE_SERVICE,
  AI_SETUP_PROVIDER,
  AI_SETUP_REJECTED,
  AI_SETUP_SKIP,
  AI_SETUP_STORAGE_UNAVAILABLE,
  AI_SETUP_UNAUTHORISED,
  AI_SETUP_UNREACHABLE,
  AI_SETUP_UNREADABLE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { Problem } from '../primitives/Problem.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { AiSetupAnswer, AiSetupProblem } from './aiSetup.js';

/** What the previous attempt's problem is called, in the person's words. */
const PROBLEM_TEXT: Readonly<Record<AiSetupProblem, MessageKey>> = {
  unauthorised: AI_SETUP_UNAUTHORISED,
  unreachable: AI_SETUP_UNREACHABLE,
  rejected: AI_SETUP_REJECTED,
  unreadable: AI_SETUP_UNREADABLE,
  'not-the-service': AI_SETUP_NOT_THE_SERVICE,
  'not-stored': AI_SETUP_NOT_STORED,
};

/**
 * The first-run AI setup's body: a provider, a key, *Check and save* and *Skip*.
 *
 * ## Skip is as prominent as the check
 *
 * BUILD-PROMPT E5 says *prominent, no dark patterns*, so the two are the same kind of button side
 * by side, and Skip is never disabled. The primary style marks the check only because it is the
 * one that needs the fields filled.
 *
 * ## The key field is write-only, as Settings' is
 *
 * It starts empty and is never filled from anything: there is no stored key on this side to show
 * (ADR-0056 Decision 5). Where this machine cannot store a secret the field is not offered and the
 * sentence says why — a field that looks saved and is not is the defect E5 bans.
 */
export default function AiSetupBody({
  secretsAvailable,
  problem,
  provider: previous,
  resolve,
  update,
}: {
  readonly secretsAvailable: boolean;
  readonly problem?: AiSetupProblem | undefined;
  readonly provider?: AiProviderId | undefined;
} & DialogAnswering<AiSetupAnswer>): ReactElement {
  const { _ } = useLingui();
  // NOTHING IS CHOSEN UNTIL THE PERSON CHOOSES (ADR-0184), except where a previous attempt named a provider, so a retry
  // starts where they were. The empty value is the placeholder option, which is not a provider.
  const [provider, setProvider] = useState<AiProviderId | ''>(previous ?? '');
  const [key, setKey] = useState('');
  const [endpoint, setEndpoint] = useState('');

  // AZURE OPENAI NEEDS ITS RESOURCE'S ADDRESS as well as a key; the others need nothing else.
  const needsEndpoint = provider === 'azure-openai';
  const usable =
    provider !== '' && secretsAvailable && key.trim() !== '' && (!needsEndpoint || endpoint.trim() !== '');

  return (
    <div className="m-ai-setup">
      <p className="m-ai-setup__intro">{_(AI_SETUP_INTRO)}</p>
      <DialogRow label={AI_SETUP_PROVIDER}>
        <select
          aria-label={_(AI_SETUP_PROVIDER)}
          className="m-ai-setup__provider"
          data-ai-setup-provider=""
          onChange={(event) => {
            setProvider(event.target.value === '' ? '' : (event.target.value as AiProviderId));
          }}
          value={provider}
        >
          <option value="">{_(AI_SETUP_CHOOSE_PROVIDER)}</option>
          {AI_PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {_(AI_PROVIDER_NAMES[id])}
            </option>
          ))}
        </select>
      </DialogRow>
      {provider === '' ? null : (
        // WHICH KEY, AND WHERE IT COMES FROM: the provider chosen needs its own, and the link opens that provider's page by
        // name — this window composes no address (ADR-0184).
        <div className="m-ai-setup__key-help" data-ai-setup-key-help={provider}>
          <p className="m-ai-setup__intro">{_(AI_SETUP_KEY_NEEDED, { provider: _(AI_PROVIDER_NAMES[provider]) })}</p>
          {provider === 'azure-openai' ? <p className="m-ai-setup__intro">{_(AI_SETUP_AZURE_NOTE)}</p> : null}
          <Button
            label={AI_SETUP_GET_KEY}
            values={{ provider: _(AI_PROVIDER_NAMES[provider]) }}
            onClick={() => {
              update({ kind: 'key-page', provider });
            }}
            variant="quiet"
          />
        </div>
      )}
      {secretsAvailable ? (
        <DialogRow label={AI_SETUP_KEY}>
          <Input label={AI_SETUP_KEY} labelShownBeside onValueChange={setKey} runsLong secret value={key} />
        </DialogRow>
      ) : (
        <Problem message={_(AI_SETUP_STORAGE_UNAVAILABLE)} />
      )}
      {needsEndpoint && secretsAvailable ? (
        <DialogRow label={AI_SETUP_ENDPOINT}>
          <Input label={AI_SETUP_ENDPOINT} labelShownBeside onValueChange={setEndpoint} runsLong value={endpoint} />
        </DialogRow>
      ) : null}
      <Problem message={problem === undefined ? undefined : _(PROBLEM_TEXT[problem])} />
      {/* THE PATTERN'S FOOTER: Cancel, which is *not now*; Skip, which also stops the first-run offer; and the check.
          Skip stays as large as the check (the owner's ruling, 2026-09-22). */}
      {/* SKIP IS THE DISMISSAL (the owner, 2026-10-02): it records the choice, so a Cancel beside it would be a second
          way to decline that records nothing. */}
      <DialogFooter dismissal="own">
        <Button
          label={AI_SETUP_SKIP}
          onClick={() => {
            resolve({ kind: 'skip' });
          }}
        />
        <Button
          disabled={!usable}
          label={AI_SETUP_CHECK}
          onClick={() => {
            if (!usable) return;
            resolve({ kind: 'check', provider, key: key.trim(), endpoint: endpoint.trim() });
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
