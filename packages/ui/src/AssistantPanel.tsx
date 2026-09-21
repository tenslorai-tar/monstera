import { AI_PROVIDERS, AI_PROVIDER_IDS, type AiProviderId, type ContractClient } from '@monstera/contract';
import { useLingui } from '@lingui/react';
import { type ReactElement, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import type { EventSubscriber } from './bridge.js';
import {
  ASSISTANT_ASK,
  ASSISTANT_COMPOSER_LABEL,
  ASSISTANT_CONVERSATION_LABEL,
  ASSISTANT_EMPTY,
  ASSISTANT_MODEL_LABEL,
  ASSISTANT_NO_KEY,
  ASSISTANT_NO_MODELS,
  ASSISTANT_PROBLEM_REJECTED,
  ANTHROPIC_OUT_OF_CREDIT,
  ASSISTANT_PROBLEM_UNAUTHORISED,
  ASSISTANT_PROBLEM_UNREACHABLE,
  ASSISTANT_PROBLEM_UNREADABLE,
  ASSISTANT_PROVIDER_LABEL,
  ASSISTANT_SEND,
  ASSISTANT_STOP,
  ASSISTANT_YOU,
  ASSISTANT_ASSISTANT,
} from './messages/en.js';
import { Button } from './primitives/Button.js';

/**
 * The assistant, as a tab of the right contextual panel
 * ([ADR-0083](../../../docs/DECISIONS/0083-the-contextual-panel-holds-tabs-and-the-assistant-is-one.md),
 * [ADR-0081](../../../docs/DECISIONS/0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md),
 * [ADR-0082](../../../docs/DECISIONS/0082-main-may-push-on-declared-event-channels.md)).
 *
 * ## What is here, and what is owed
 *
 * The owner's design (2026-09-15) asks for more than this: page references that click
 * through, an *Asking about* line, a selection menu, quick starts, Left · Right · Both with
 * two documents, and history. **This is the conversation itself** — provider, model,
 * composer, streaming and Stop — and the row says which parts are still owed rather than
 * this comment claiming them.
 *
 * ## The no-key state is the one a person meets first
 *
 * §10.5 requires every surface to design it. A provider with no stored key says so and
 * names where the key goes; nothing here is disabled with no explanation, and no model
 * list is invented (ADR-0081).
 *
 * ## Send becomes STOP, and the text a person typed survives a failure
 *
 * Stop is an `invoke` that reaches the provider, not an unsubscribe. A refusal leaves what
 * streamed in place and says what happened in plain words.
 */

export interface AssistantPanelProps {
  readonly client: ContractClient;
  readonly subscribe: EventSubscriber;
  /** Which provider keys this machine has stored, from `settings.loadSecrets`. */
  readonly storedSecrets: readonly string[];
}

interface Turn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/** A subscription id: short, unique per ask, and inside the event schema's alphabet. */
function newSubscription(): string {
  return `s${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
}

const PROBLEMS = {
  unauthorised: ASSISTANT_PROBLEM_UNAUTHORISED,
  unreachable: ASSISTANT_PROBLEM_UNREACHABLE,
  rejected: ASSISTANT_PROBLEM_REJECTED,
  'out-of-credit': ANTHROPIC_OUT_OF_CREDIT,
  unreadable: ASSISTANT_PROBLEM_UNREADABLE,
  'no-key': ASSISTANT_NO_KEY,
} as const;

export function AssistantPanel({ client, subscribe, storedSecrets }: AssistantPanelProps): ReactElement {
  const { i18n } = useLingui();
  const providerId = useId();
  const modelId = useId();
  const [provider, setProvider] = useState<AiProviderId>('anthropic');
  const [models, setModels] = useState<readonly { id: string; label: string }[]>([]);
  const [model, setModel] = useState('');
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [problem, setProblem] = useState<keyof typeof PROBLEMS | null>(null);
  /** The answer being assembled, kept out of state so each delta is one render. */
  const answer = useRef('');

  const hasKey = storedSecrets.includes(AI_PROVIDERS[provider].keySetting);

  useEffect(() => {
    let cancelled = false;
    void client['ai.models']({ provider }).then((result) => {
      if (cancelled || !result.ok) return;
      setModels(result.value.models.map((entry) => ({ id: entry.id, label: entry.label })));
      setModel(result.value.models[0]?.id ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [client, provider]);

  useEffect(() => {
    const stopDelta = subscribe('ai.delta', (payload) => {
      setStreaming((live) => {
        if (live !== payload.subscription) return live;
        answer.current += payload.text;
        setTurns((existing) => {
          const last = existing.at(-1);
          // THE STREAMING TURN IS THE LAST ONE, replaced rather than appended to: a person
          // reads one answer growing, not a paragraph per delta.
          if (last?.role !== 'assistant') return [...existing, { role: 'assistant', text: answer.current }];
          return [...existing.slice(0, -1), { role: 'assistant', text: answer.current }];
        });
        return live;
      });
    });
    const stopDone = subscribe('ai.done', (payload) => {
      setStreaming((live) => {
        if (live !== payload.subscription) return live;
        if (payload.refusal !== undefined) setProblem(payload.refusal);
        answer.current = '';
        return null;
      });
    });
    return () => {
      stopDelta();
      stopDone();
    };
  }, [subscribe]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (text === '' || model === '' || streaming !== null) return;
    const subscription = newSubscription();
    const asked: readonly Turn[] = [...turns, { role: 'user', text }];
    setTurns(asked);
    setProblem(null);
    answer.current = '';
    setStreaming(subscription);
    void client['ai.ask']({ subscription, provider, model, messages: [...asked] }).then((result) => {
      if (result.ok && result.value.started) {
        // THE DRAFT IS CLEARED ONLY ONCE THE ASK STARTED. A request that never began must
        // leave a person's words where they typed them.
        setDraft('');
        return;
      }
      setStreaming(null);
      setProblem('rejected');
    });
  }, [client, draft, model, provider, streaming, turns]);

  const stop = useCallback(() => {
    if (streaming === null) return;
    void client['ai.stop']({ subscription: streaming });
  }, [client, streaming]);

  const providers = useMemo(
    () => AI_PROVIDER_IDS.filter((id) => storedSecrets.includes(AI_PROVIDERS[id].keySetting)),
    [storedSecrets],
  );

  return (
    <div className="m-assistant">
      <div className="m-assistant__choices">
        <label className="m-document-choice" htmlFor={providerId}>
          {i18n._(ASSISTANT_PROVIDER_LABEL)}
          <select
            data-assistant-provider=""
            id={providerId}
            onChange={(event) => {
              setProvider(event.target.value as AiProviderId);
            }}
            value={provider}
          >
            {/* EVERY PROVIDER IS LISTED, with or without a key: a person choosing where to
                put a key must be able to see the choice. The no-key line below says what
                the chosen one needs. */}
            {AI_PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>

        <label className="m-document-choice" htmlFor={modelId}>
          {i18n._(ASSISTANT_MODEL_LABEL)}
          <select
            data-assistant-model=""
            disabled={models.length === 0}
            id={modelId}
            onChange={(event) => {
              setModel(event.target.value);
            }}
            value={model}
          >
            {models.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!hasKey && <p className="m-assistant__state">{i18n._(ASSISTANT_NO_KEY)}</p>}
      {hasKey && models.length === 0 && <p className="m-assistant__state">{i18n._(ASSISTANT_NO_MODELS)}</p>}
      {providers.length === 0 && turns.length === 0 && <p className="m-assistant__state">{i18n._(ASSISTANT_EMPTY)}</p>}
      {problem !== null && <p className="m-assistant__problem">{i18n._(PROBLEMS[problem])}</p>}

      <ol aria-label={i18n._(ASSISTANT_CONVERSATION_LABEL)} className="m-assistant__turns">
        {turns.map((turn, at) => (
          <li className="m-assistant__turn" data-assistant-role={turn.role} key={`${String(at)}-${turn.role}`}>
            <span className="m-assistant__who">
              {i18n._(turn.role === 'user' ? ASSISTANT_YOU : ASSISTANT_ASSISTANT)}
            </span>
            <p className="m-assistant__text">{turn.text}</p>
          </li>
        ))}
      </ol>

      <div className="m-assistant__composer">
        <textarea
          aria-label={i18n._(ASSISTANT_COMPOSER_LABEL)}
          className="m-assistant__draft"
          data-assistant-draft=""
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            // ENTER SENDS, SHIFT+ENTER STARTS A LINE — the owner's design.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={2}
          value={draft}
        />
        {streaming === null ? (
          <Button label={ASSISTANT_SEND} onClick={send} variant="primary" />
        ) : (
          <Button label={ASSISTANT_STOP} onClick={stop} />
        )}
      </div>
      <p className="m-assistant__hint">{i18n._(ASSISTANT_ASK)}</p>
    </div>
  );
}
