import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  type AiProviderId,
  type AskAbout,
  type AskSent,
  type ContractClient,
  MAX_ANNOTATION_TEXT,
  MAX_ASK_CONTEXT,
  type RenderableCommand,
  citationsIn,
} from '@monstera/contract';
import type { DocId } from '@monstera/shared';
import { useLingui } from '@lingui/react';
import {
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import type { AssistantRequest, ReplyTarget } from './assistantRequest.js';
import type { EventSubscriber } from './bridge.js';
import type { ConversationTurn, DocumentStore } from './documentStores.js';
import {
  AI_PROVIDER_NAMES,
  ANTHROPIC_OUT_OF_CREDIT,
  ASSISTANT_ABOUT_DOCUMENT,
  ASSISTANT_ABOUT_LABEL,
  ASSISTANT_ABOUT_NOTHING,
  ASSISTANT_ABOUT_PAGE,
  ASSISTANT_ABOUT_SELECTION,
  ASSISTANT_ABOUT_SENDS,
  ASSISTANT_ASK,
  ASSISTANT_ASSISTANT,
  ASSISTANT_CITATION,
  ASSISTANT_COMPOSER_LABEL,
  ASSISTANT_CONVERSATION_LABEL,
  ASSISTANT_EMPTY,
  ASSISTANT_MODEL_LABEL,
  ASSISTANT_NO_KEY,
  ASSISTANT_NO_MODELS,
  ASSISTANT_POST_REPLY,
  ASSISTANT_PROBLEM_REJECTED,
  ASSISTANT_PROBLEM_UNAUTHORISED,
  ASSISTANT_PROBLEM_UNREACHABLE,
  ASSISTANT_PROBLEM_UNREADABLE,
  ASSISTANT_PROVIDER_LABEL,
  ASSISTANT_QUICK_DATES,
  ASSISTANT_QUICK_EXPLAIN_PAGE,
  ASSISTANT_QUICK_LABEL,
  ASSISTANT_QUICK_SUMMARISE,
  ASSISTANT_SEND,
  ASSISTANT_SENT_CUT,
  ASSISTANT_SENT_NOTHING,
  ASSISTANT_SENT_PAGE,
  ASSISTANT_SENT_PAGES,
  ASSISTANT_STOP,
  ASSISTANT_YOU,
} from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { Button } from './primitives/Button.js';

/**
 * The assistant, as a tab of the right contextual panel
 * ([ADR-0083](../../../docs/DECISIONS/0083-the-contextual-panel-holds-tabs-and-the-assistant-is-one.md),
 * [ADR-0081](../../../docs/DECISIONS/0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md),
 * [ADR-0082](../../../docs/DECISIONS/0082-main-may-push-on-declared-event-channels.md),
 * [ADR-0088](../../../docs/DECISIONS/0088-an-ask-about-a-document-carries-a-bounded-window-read-in-main.md)).
 *
 * ## What is sent is named before it is sent
 *
 * The *Asking about* line is a choice and a sentence: which part of the document goes with the
 * next ask, and which provider receives it — BUILD-PROMPT's consent copy. Nothing about the
 * document is read until Send, and each asked turn then says which pages actually went, so a
 * whole-document question about a long file says that it covered the first twelve pages.
 *
 * ## One conversation per document, and an answer goes to the document that asked
 *
 * The turns live in the document's store (ADR-0083 Decision 4). An answer streaming when the
 * reader switches tabs keeps writing into the conversation it was asked from — the live ask
 * holds that store, not whichever one is focused when a delta lands.
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

/** The focused document, as the panel needs it. */
export interface AssistantDocument {
  readonly docId: DocId;
  readonly store: DocumentStore;
  /** The page the reader is on, zero-based. */
  readonly page: number;
}

export interface AssistantPanelProps {
  readonly client: ContractClient;
  readonly subscribe: EventSubscriber;
  /** Which provider keys this machine has stored, from `settings.loadSecrets`. */
  readonly storedSecrets: readonly string[];
  /** The focused document, or `undefined` on the start screen. */
  readonly focused?: AssistantDocument | undefined;
  /** Goes to a page an answer cited, zero-based. */
  readonly onGoTo?: ((page: number) => void) | undefined;
  /** The latest request a command made of the panel. */
  readonly request?: AssistantRequest | undefined;
  /** The newest request serial already acted on — held by `App`, so a remount cannot replay one. */
  readonly handled: number | undefined;
  /** Called once a request has been acted on. Required with it: without both, an answer ending
   * would let the same request be asked again. */
  readonly onHandled: (serial: number) => void;
  /** Posts a drafted reply to its note, through `App`'s one dispatcher. */
  readonly onReply?: ((command: Extract<RenderableCommand, { kind: 'replyToAnnotation' }>) => void) | undefined;
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

/** What the *Asking about* choice can be; a selection exists only when a command gave one. */
type Scope = 'page' | 'document' | 'selection' | 'nothing';

const NO_SUBSCRIBE = (): (() => void) => () => undefined;
const NO_TURNS: readonly ConversationTurn[] = [];

/** The conversation's turns: the document's, or this panel's own on the start screen. */
function useConversation(store: DocumentStore | undefined): readonly ConversationTurn[] {
  return useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, () => store?.getState().conversation ?? NO_TURNS);
}

export function AssistantPanel({
  client,
  subscribe,
  storedSecrets,
  focused,
  onGoTo,
  request,
  handled,
  onHandled,
  onReply,
}: AssistantPanelProps): ReactElement {
  const { i18n } = useLingui();
  const providerId = useId();
  const modelId = useId();
  const aboutId = useId();
  const [provider, setProvider] = useState<AiProviderId>('anthropic');
  const [models, setModels] = useState<readonly { id: string; label: string }[]>([]);
  const [model, setModel] = useState('');
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [problem, setProblem] = useState<keyof typeof PROBLEMS | null>(null);
  const [chosen, setChosen] = useState<{ readonly scope: Scope; readonly after: number }>({
    scope: 'page',
    after: 0,
  });

  /** Turns for the start screen, where there is no document store to hold them. */
  const [looseTurns, setLooseTurns] = useState<readonly ConversationTurn[]>([]);
  /** The start screen's turns as the ask's closures read them, without a render between. */
  const looseRef = useRef<readonly ConversationTurn[]>([]);
  const documentTurns = useConversation(focused?.store);
  const turns = focused === undefined ? looseTurns : documentTurns;

  /**
   * The live ask: its subscription, and WHERE its answer goes — the conversation it was asked
   * from, captured at Send, never the one focused when a delta arrives.
   */
  const live = useRef<{ subscription: string; write: (turns: readonly ConversationTurn[]) => void; read: () => readonly ConversationTurn[] } | null>(null);
  /** The answer being assembled, kept out of state so each delta is one write. */
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

  // A SELECTION BELONGS TO THE DOCUMENT IT WAS MADE IN, and it is DERIVED from the request that
  // carried it rather than copied into state: switching tabs makes it vanish by construction, so
  // the line can never name words from a file that is not in front of the reader.
  const docId = focused?.docId;
  const selection =
    request?.about.scope === 'selection' && request.about.docId === docId ? request.about : null;
  // THE PERSON'S CHOICE, stamped with the newest request it was made after: a request that
  // arrives later points the line, and a choice made after that request wins again.
  const requestedScope =
    request !== undefined && request.serial > chosen.after ? request.about.scope : undefined;
  const wanted = requestedScope ?? chosen.scope;
  const scope: Scope = wanted === 'selection' && selection === null ? 'page' : wanted;
  const choose = (next: Scope): void => {
    setChosen({ scope: next, after: request?.serial ?? 0 });
  };

  useEffect(() => {
    const stopDelta = subscribe('ai.delta', (payload) => {
      const asking = live.current;
      if (asking?.subscription !== payload.subscription) return;
      answer.current += payload.text;
      const existing = asking.read();
      const last = existing.at(-1);
      // THE STREAMING TURN IS THE LAST ONE, replaced rather than appended to: a person
      // reads one answer growing, not a paragraph per delta.
      asking.write(
        last?.role === 'assistant'
          ? [...existing.slice(0, -1), { role: 'assistant', text: answer.current }]
          : [...existing, { role: 'assistant', text: answer.current }],
      );
    });
    const stopDone = subscribe('ai.done', (payload) => {
      if (live.current?.subscription !== payload.subscription) return;
      if (payload.refusal !== undefined) setProblem(payload.refusal);
      answer.current = '';
      live.current = null;
      setStreaming(null);
    });
    return () => {
      stopDelta();
      stopDone();
    };
  }, [subscribe]);

  /** What the chosen scope names, or `undefined` for an ask about nothing. */
  const aboutFor = useCallback(
    (chosen: Scope): AskAbout | undefined => {
      if (focused === undefined || chosen === 'nothing') return undefined;
      if (chosen === 'selection') return selection ?? undefined;
      if (chosen === 'page') return { scope: 'page', docId: focused.docId, page: focused.page };
      return { scope: 'document', docId: focused.docId };
    },
    [focused, selection],
  );

  const ask = useCallback(
    /** @returns whether the ask began; a request not begun is kept for when it can be. */
    (text: string, about: AskAbout | undefined, replyTo?: ReplyTarget): boolean => {
      if (text === '' || model === '' || live.current !== null) return false;
      const store = focused?.store;
      const read = (): readonly ConversationTurn[] => (store === undefined ? looseRef.current : store.getState().conversation);
      const write = (next: readonly ConversationTurn[]): void => {
        if (store === undefined) {
          looseRef.current = next;
          setLooseTurns(next);
        } else store.getState().converse(next);
      };
      const subscription = newSubscription();
      const before = read();
      const asked: ConversationTurn = { role: 'user', text, ...(replyTo === undefined ? {} : { replyTo }) };
      write([...before, asked]);
      setProblem(null);
      answer.current = '';
      live.current = { subscription, write, read };
      setStreaming(subscription);
      void client['ai.ask']({
        subscription,
        provider,
        model,
        messages: [...before, asked].map((turn) => ({ role: turn.role, text: turn.text })),
        ...(about === undefined ? {} : { about }),
      }).then((result) => {
        if (result.ok && result.value.started) {
          // THE DRAFT IS CLEARED ONLY ONCE THE ASK STARTED. A request that never began must
          // leave a person's words where they typed them.
          setDraft((current) => (current.trim() === text ? '' : current));
          // WHAT WENT is recorded on the turn that asked, so the line under it is main's answer
          // rather than the scope the panel meant.
          const now = read();
          const at = now.lastIndexOf(asked);
          if (at !== -1) write(now.map((turn, index) => (index === at ? { ...turn, sent: result.value.sent } : turn)));
          return;
        }
        live.current = null;
        setStreaming(null);
        setProblem('rejected');
      });
      return true;
    },
    [client, focused, model, provider],
  );

  const send = useCallback(() => {
    ask(draft.trim(), aboutFor(scope));
  }, [aboutFor, ask, draft, scope]);

  // A COMMAND'S REQUEST points the panel and may ask at once. Keyed by `serial`, so the same
  // words asked twice are two asks.
  //
  // HANDLED ONLY ONCE IT BEGAN. A right-click that reveals a closed panel mounts it with the
  // request already set and the model list not yet fetched; marking it handled then dropped the
  // question in silence. `ask` changes when the model arrives and `streaming` when an earlier
  // answer ends, so the effect runs again at each moment the ask could begin.
  //
  // AND WHAT WAS HANDLED IS `App`'S TO REMEMBER, not this component's. The panel unmounts when no
  // document is open; a marker held here reset on the next mount while `App` still held the
  // request, so reopening a document re-sent a question about one that was closed — found in the
  // live run of 2026-09-21. A request naming another document is never asked here at all.
  useEffect(() => {
    if (request === undefined || request.serial === handled) return;
    if (request.about.docId !== focused?.docId) return;
    if (request.prompt === undefined || ask(i18n._(request.prompt), request.about, request.replyTo)) {
      onHandled(request.serial);
    }
  }, [ask, focused?.docId, handled, i18n, onHandled, request, streaming]);

  const stop = useCallback(() => {
    if (streaming === null) return;
    void client['ai.stop']({ subscription: streaming });
  }, [client, streaming]);

  const providers = useMemo(
    () => AI_PROVIDER_IDS.filter((id) => storedSecrets.includes(AI_PROVIDERS[id].keySetting)),
    [storedSecrets],
  );

  const number = new Intl.NumberFormat(i18n.locale);

  /** The line under an asked turn: which pages went, as `main` answered. */
  const sentLine = (sent: AskSent): string => {
    if (sent.firstPage === null || sent.lastPage === null || sent.characters === 0) return i18n._(ASSISTANT_SENT_NOTHING);
    const pages =
      sent.firstPage === sent.lastPage
        ? i18n._(ASSISTANT_SENT_PAGE, { page: pdfjsPageOf(sent.firstPage), count: sent.pageCount })
        : i18n._(ASSISTANT_SENT_PAGES, {
            first: pdfjsPageOf(sent.firstPage),
            last: pdfjsPageOf(sent.lastPage),
            count: sent.pageCount,
          });
    return sent.truncated
      ? `${pages} ${i18n._(ASSISTANT_SENT_CUT, { characters: number.format(sent.characters) })}`
      : pages;
  };

  /** An answer's text, with each `[p. N]` citation a link to that page. */
  const answerText = (text: string): ReactElement[] =>
    citationsIn(text).map((piece, at) =>
      'cited' in piece && onGoTo !== undefined ? (
        <button
          aria-label={i18n._(ASSISTANT_CITATION, { page: pdfjsPageOf(piece.cited) })}
          className="m-assistant__citation"
          data-assistant-citation={piece.cited}
          key={at}
          onClick={() => {
            onGoTo(piece.cited);
          }}
          type="button"
        >
          {piece.label}
        </button>
      ) : (
        <span key={at}>{'cited' in piece ? piece.label : piece.text}</span>
      ),
    );

  const quickStarts = [
    { key: ASSISTANT_QUICK_SUMMARISE, scope: 'document' },
    { key: ASSISTANT_QUICK_DATES, scope: 'document' },
    { key: ASSISTANT_QUICK_EXPLAIN_PAGE, scope: 'page' },
  ] as const;

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
                {i18n._(AI_PROVIDER_NAMES[id])}
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

      {focused !== undefined && (
        <div className="m-assistant__about">
          <label className="m-document-choice" htmlFor={aboutId}>
            {i18n._(ASSISTANT_ABOUT_LABEL)}
            <select
              data-assistant-about=""
              id={aboutId}
              onChange={(event) => {
                choose(event.target.value as Scope);
              }}
              value={scope}
            >
              {selection !== null && (
                <option value="selection">
                  {i18n._(ASSISTANT_ABOUT_SELECTION, { page: pdfjsPageOf(selection.page) })}
                </option>
              )}
              <option value="page">{i18n._(ASSISTANT_ABOUT_PAGE, { page: pdfjsPageOf(focused.page) })}</option>
              <option value="document">{i18n._(ASSISTANT_ABOUT_DOCUMENT, { characters: number.format(MAX_ASK_CONTEXT) })}</option>
              <option value="nothing">{i18n._(ASSISTANT_ABOUT_NOTHING)}</option>
            </select>
          </label>
          {scope !== 'nothing' && (
            <p className="m-assistant__consent" data-assistant-consent="">
              {i18n._(ASSISTANT_ABOUT_SENDS, { provider: i18n._(AI_PROVIDER_NAMES[provider]) })}
            </p>
          )}
        </div>
      )}

      {!hasKey && <p className="m-assistant__state">{i18n._(ASSISTANT_NO_KEY)}</p>}
      {hasKey && models.length === 0 && <p className="m-assistant__state">{i18n._(ASSISTANT_NO_MODELS)}</p>}
      {providers.length === 0 && turns.length === 0 && <p className="m-assistant__state">{i18n._(ASSISTANT_EMPTY)}</p>}
      {problem !== null && <p className="m-assistant__problem">{i18n._(PROBLEMS[problem])}</p>}

      {focused !== undefined && hasKey && turns.length === 0 && (
        <div aria-label={i18n._(ASSISTANT_QUICK_LABEL)} className="m-assistant__quick" role="group">
          {quickStarts.map((quick) => (
            <Button
              key={quick.key}
              label={quick.key}
              onClick={() => {
                choose(quick.scope);
                ask(i18n._(quick.key), aboutFor(quick.scope));
              }}
            />
          ))}
        </div>
      )}

      <ol aria-label={i18n._(ASSISTANT_CONVERSATION_LABEL)} className="m-assistant__turns">
        {turns.map((turn, at) => (
          <li className="m-assistant__turn" data-assistant-role={turn.role} key={`${String(at)}-${turn.role}`}>
            <span className="m-assistant__who">
              {i18n._(turn.role === 'user' ? ASSISTANT_YOU : ASSISTANT_ASSISTANT)}
            </span>
            <p className="m-assistant__text">{turn.role === 'assistant' ? answerText(turn.text) : turn.text}</p>
            {turn.sent !== undefined && turn.sent !== null && (
              <p className="m-assistant__sent" data-assistant-sent="">
                {sentLine(turn.sent)}
              </p>
            )}
            {(() => {
              // A DRAFTED REPLY IS POSTED BY A PERSON, once the answer is whole: the assistant
              // never writes into the document by itself, and a half-streamed draft is not one.
              const target = turns[at - 1]?.replyTo;
              const whole = streaming === null || at !== turns.length - 1;
              const text = turn.text.trim().slice(0, MAX_ANNOTATION_TEXT);
              if (
                turn.role !== 'assistant' ||
                target === undefined ||
                !whole ||
                text === '' ||
                turn.posted === true ||
                onReply === undefined
              ) {
                return null;
              }
              return (
                <Button
                  label={ASSISTANT_POST_REPLY}
                  onClick={() => {
                    onReply({ kind: 'replyToAnnotation', page: target.page, index: target.index, text, version: target.version });
                    // ONCE: a second press would post the same reply again, which the live run of
                    // 2026-09-21 showed the button offering.
                    focused?.store
                      .getState()
                      .converse(turns.map((each, index) => (index === at ? { ...each, posted: true } : each)));
                  }}
                />
              );
            })()}
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
