import { useLingui } from '@lingui/react';
import { AI_PROVIDER_IDS, type AiProviderId } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, useId, useState } from 'react';

import {
  AI_PROVIDER_NAMES,
  AI_SETUP_CHECK,
  AI_SETUP_ENDPOINT,
  AI_SETUP_INTRO,
  AI_SETUP_KEY,
  AI_SETUP_NOT_STORED,
  AI_SETUP_PROVIDER,
  AI_SETUP_REJECTED,
  AI_SETUP_SKIP,
  AI_SETUP_STORAGE_UNAVAILABLE,
  AI_SETUP_UNAUTHORISED,
  AI_SETUP_UNREACHABLE,
  AI_SETUP_UNREADABLE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { AiSetupAnswer, AiSetupProblem } from './aiSetup.js';

/** What the previous attempt's problem is called, in the person's words. */
const PROBLEM_TEXT: Readonly<Record<AiSetupProblem, MessageKey>> = {
  unauthorised: AI_SETUP_UNAUTHORISED,
  unreachable: AI_SETUP_UNREACHABLE,
  rejected: AI_SETUP_REJECTED,
  unreadable: AI_SETUP_UNREADABLE,
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
}: {
  readonly secretsAvailable: boolean;
  readonly problem?: AiSetupProblem | undefined;
  readonly provider?: AiProviderId | undefined;
} & DialogAnswering<AiSetupAnswer>): ReactElement {
  const { _ } = useLingui();
  const providerId = useId();
  const [provider, setProvider] = useState<AiProviderId>(previous ?? 'anthropic');
  const [key, setKey] = useState('');
  const [endpoint, setEndpoint] = useState('');

  // AZURE OPENAI NEEDS ITS RESOURCE'S ADDRESS as well as a key; the others need nothing else.
  const needsEndpoint = provider === 'azure-openai';
  const usable = secretsAvailable && key.trim() !== '' && (!needsEndpoint || endpoint.trim() !== '');

  return (
    <div className="m-ai-setup">
      <p className="m-ai-setup__intro">{_(AI_SETUP_INTRO)}</p>
      <label className="m-document-choice" htmlFor={providerId}>
        {_(AI_SETUP_PROVIDER)}
        <select
          data-ai-setup-provider=""
          id={providerId}
          onChange={(event) => {
            setProvider(event.target.value as AiProviderId);
          }}
          value={provider}
        >
          {AI_PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {_(AI_PROVIDER_NAMES[id])}
            </option>
          ))}
        </select>
      </label>
      {secretsAvailable ? (
        <Input label={AI_SETUP_KEY} onValueChange={setKey} secret value={key} />
      ) : (
        <p className="m-ai-setup__problem" role="status">
          {_(AI_SETUP_STORAGE_UNAVAILABLE)}
        </p>
      )}
      {needsEndpoint && secretsAvailable ? (
        <Input label={AI_SETUP_ENDPOINT} onValueChange={setEndpoint} value={endpoint} />
      ) : null}
      {problem === undefined ? null : (
        <p className="m-ai-setup__problem" data-ai-setup-problem={problem} role="status">
          {_(PROBLEM_TEXT[problem])}
        </p>
      )}
      <div className="m-ai-setup__actions">
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
      </div>
    </div>
  );
}
