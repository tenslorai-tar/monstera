import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  type AiProviderId,
  type AskAbout,
  type AskSent,
  type AskSide,
  type AskSides,
  type ContractClient,
  MAX_ANNOTATION_TEXT,
  MAX_ASK_CONTEXT,
  MAX_CHAT_TEXT,
  type DispatchableCommand,
  citationsIn,
} from '@monstera/contract';
import type { DocId, MessageKey } from '@monstera/shared';
import { useLingui } from '@lingui/react';
import { Copy, Pencil, RefreshCw, StickyNote } from 'lucide-react';
import {
  Fragment,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { answerElements } from './answerMarkdown.js';
import type { AssistantRequest, ReplyTarget } from './assistantRequest.js';
import type { EventSubscriber } from './bridge.js';
import type { ConversationTurn, DocumentStore } from './documentStores.js';
import {
  AI_PROVIDER_NAMES,
  ANTHROPIC_OUT_OF_CREDIT,
  ASSISTANT_ABOUT_COMMENT,
  ASSISTANT_ABOUT_COMMENTS,
  ASSISTANT_ABOUT_DOCUMENT,
  ASSISTANT_ABOUT_LABEL,
  ASSISTANT_ABOUT_NOTHING,
  ASSISTANT_ABOUT_PAGE,
  ASSISTANT_ABOUT_PICTURE,
  ASSISTANT_ABOUT_SELECTION,
  ASSISTANT_ABOUT_SENDS,
  ASSISTANT_ASK,
  ASSISTANT_ASSISTANT,
  ASSISTANT_CITATION,
  ASSISTANT_CITATION_RIGHT,
  ASSISTANT_COMPOSER_LABEL,
  ASSISTANT_CONVERSATION_LABEL,
  ASSISTANT_EMPTY,
  ASSISTANT_MODEL_LABEL,
  ASSISTANT_NO_KEY,
  ASSISTANT_NO_MODELS,
  ASSISTANT_NO_VISION,
  ASSISTANT_PROBLEM_PAGE_TOO_LARGE,
  ASSISTANT_POST_REPLY,
  ASSISTANT_PROBLEM_REJECTED,
  ASSISTANT_PROBLEM_UNAUTHORISED,
  ASSISTANT_PROBLEM_UNREACHABLE,
  ASSISTANT_PROBLEM_UNREADABLE,
  ASSISTANT_PROVIDER_LABEL,
  ASSISTANT_QUICK_DATES,
  ASSISTANT_QUICK_EXPLAIN_PAGE,
  ASSISTANT_QUICK_LABEL,
  ASSISTANT_QUICK_READ_TABLE,
  ASSISTANT_QUICK_SUMMARISE,
  ASSISTANT_SEND,
  ASSISTANT_SENT_CUT,
  ASSISTANT_SENT_LEFT,
  ASSISTANT_SENT_NOTHING,
  ASSISTANT_SENT_PAGE,
  ASSISTANT_SENT_PAGES,
  ASSISTANT_SENT_PICTURE,
  ASSISTANT_SENT_COMMENTS,
  ASSISTANT_SENT_COMMENTS_CUT,
  ASSISTANT_SENT_RIGHT,
  ASSISTANT_SIDE_BOTH,
  ASSISTANT_SIDE_LEFT,
  ASSISTANT_SIDE_RIGHT,
  ASSISTANT_SIDES_LABEL,
  ASSISTANT_SIDES_NEEDED,
  ASSISTANT_STOP,
  ASSISTANT_YOU,
  ASSISTANT_ADD_NOTE,
  ASSISTANT_CAPTION,
  ASSISTANT_COPIED,
  ASSISTANT_COPY,
  ASSISTANT_EDIT,
  ASSISTANT_EDIT_CANCEL,
  ASSISTANT_EDITING,
  ASSISTANT_NEW_CHAT,
  ASSISTANT_NOTED,
  ASSISTANT_REGENERATE,
  ASSISTANT_SCOPE_BOTH,
  ASSISTANT_SCOPE_COMMENT,
  ASSISTANT_SCOPE_COMMENTS,
  ASSISTANT_SCOPE_DOCUMENT,
  ASSISTANT_SCOPE_LEFT,
  ASSISTANT_SCOPE_NOTHING,
  ASSISTANT_SCOPE_PAGE,
  ASSISTANT_SCOPE_PICTURE,
  ASSISTANT_SCOPE_RIGHT,
  ASSISTANT_SCOPE_SELECTION,
} from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { Button } from './primitives/Button.js';
import { IconButton } from './primitives/IconButton.js';

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

/** The document compared on the right, and the page its pane is on (zero-based). */
export interface BesideDocument {
  readonly docId: DocId;
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
  readonly onReply?: ((command: Extract<DispatchableCommand, { kind: 'replyToAnnotation' }>) => void) | undefined;
  /**
   * Places an answer on the page the reader is on as a sticky note, and says whether it could — the
   * page's box is known only once it has been drawn. Absent, *Add as note* is not offered.
   */
  readonly onNote?: ((text: string) => boolean) | undefined;
  /**
   * The document on the right when two are side by side, or `undefined` with one — which is
   * what decides whether *Left · Right · Both* is offered at all (ADR-0089).
   */
  readonly beside?: BesideDocument | undefined;
  /** Goes to a page of the document on the right, zero-based. */
  readonly onGoToBeside?: ((page: number) => void) | undefined;
}

/** What one ask sends: its document or documents, and the side it went to with two. */
/** How long *Copied* shows beside an answer, in milliseconds — long enough to read, then gone. */
const COPIED_MS = 2000;

/** Which document a two-document answer was about, for its caption. */
const SIDE_WORDS = {
  left: ASSISTANT_SCOPE_LEFT,
  right: ASSISTANT_SCOPE_RIGHT,
  both: ASSISTANT_SCOPE_BOTH,
} as const;

/** What one ask is about — the same shape a turn records, so Regenerate can ask it again. */
type AskRequest = NonNullable<ConversationTurn['request']>;

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
  'page-too-large': ASSISTANT_PROBLEM_PAGE_TOO_LARGE,
} as const;

/**
 * Whether the assistant can answer, as ONE value, so the panel says one sentence about it.
 *
 * Three booleans rendered as three conditions said two sentences when nothing was stored at all —
 * *this provider has no key* and *no provider has a key* are both true then — and a reader was told
 * the same thing twice. The states are ordered: no key anywhere explains itself before the chosen
 * provider does, and a missing model list only matters once there is a key to fetch it with.
 */
export type AssistantReadiness = 'no-keys' | 'no-key' | 'no-models' | 'ready';

export function assistantReadiness(anyKey: boolean, chosenHasKey: boolean, modelCount: number): AssistantReadiness {
  if (!anyKey) return 'no-keys';
  if (!chosenHasKey) return 'no-key';
  if (modelCount === 0) return 'no-models';
  return 'ready';
}

const READINESS = {
  'no-keys': ASSISTANT_EMPTY,
  'no-key': ASSISTANT_NO_KEY,
  'no-models': ASSISTANT_NO_MODELS,
} as const;

/**
 * What the *Asking about* choice can be. A selection or a comment exists only when a command
 * gave one, and is offered under its own name — the line and the instruction both say which.
 */
type Scope = 'page' | 'page-image' | 'document' | 'comments' | 'selection' | 'comment' | 'nothing';

const NO_SUBSCRIBE = (): (() => void) => () => undefined;
const NO_TURNS: readonly ConversationTurn[] = [];

/** The conversation's turns: the document's, or this panel's own on the start screen. */
function useConversation(store: DocumentStore | undefined): readonly ConversationTurn[] {
  return useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, () => store?.getState().conversation ?? NO_TURNS);
}

/** The conversation's Left · Right · Both choice, or `undefined` until one is made. */
function useSides(store: DocumentStore | undefined): AskSides | undefined {
  return useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, () => store?.getState().sides);
}

const SIDE_CHOICES = [
  { sides: 'left', label: ASSISTANT_SIDE_LEFT },
  { sides: 'right', label: ASSISTANT_SIDE_RIGHT },
  { sides: 'both', label: ASSISTANT_SIDE_BOTH },
] as const satisfies readonly { sides: AskSides; label: MessageKey }[];

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
  onNote,
  beside,
  onGoToBeside,
}: AssistantPanelProps): ReactElement {
  const { i18n } = useLingui();
  const providerId = useId();
  const modelId = useId();
  const aboutId = useId();
  const sidesName = useId();
  const [provider, setProvider] = useState<AiProviderId>('anthropic');
  // WITH THE VISION FLAG, because a model that cannot see is not offered a picture (ADR-0090):
  // `false` where the provider says so, `null` where it does not say.
  const [models, setModels] = useState<readonly { id: string; label: string; vision: boolean | null }[]>([]);
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
      setModels(
        result.value.models.map((entry) => ({ id: entry.id, label: entry.label, vision: entry.capabilities.vision })),
      );
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
    (request?.about.scope === 'selection' || request?.about.scope === 'comment') && request.about.docId === docId
      ? request.about
      : null;
  // THE PERSON'S CHOICE, stamped with the newest request it was made after: a request that
  // arrives later points the line, and a choice made after that request wins again.
  const requestedScope =
    request !== undefined && request.serial > chosen.after ? request.about.scope : undefined;
  const wanted = requestedScope ?? chosen.scope;
  // A CARRIED SCOPE WITH NOTHING CARRYING IT falls back to the page — the request was about
  // another document, or none arrived.
  const scope: Scope = (wanted === 'selection' || wanted === 'comment') && selection?.scope !== wanted ? 'page' : wanted;
  const choose = (next: Scope): void => {
    setChosen({ scope: next, after: request?.serial ?? 0 });
  };

  // LEFT · RIGHT · BOTH, offered only when it can mean something (ADR-0089): a second document
  // on the right, and a scope that names a page or the document. A selection or a comment belongs
  // to the document it was made in, and one document shown has nothing to choose between.
  const sides = useSides(focused?.store);
  const pairable = beside !== undefined && beside.docId !== focused?.docId && (scope === 'page' || scope === 'document');
  // NO DEFAULT: with two documents and no choice, an ask waits rather than sending a document
  // nobody picked.
  const waitingForSides = pairable && sides === undefined;
  // A MODEL THAT SAYS IT CANNOT SEE is not offered a picture; one that does not say is, and a
  // provider's refusal is then worded like any other (ADR-0090 Decision 5).
  const canSee = models.find((entry) => entry.id === model)?.vision !== false;
  const blindForPicture = scope === 'page-image' && !canSee;

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

  /**
   * What the chosen scope sends, or `null` while two documents are side by side and nobody has
   * said which (ADR-0089 Decision 5). *Left* is the tab's own document and *Right* the compared
   * one, each at the page its own pane is on.
   */
  const requestFor = useCallback(
    (chosen: Scope): AskRequest | null => {
      if (focused === undefined || chosen === 'nothing') return { about: undefined };
      if (chosen === 'selection' || chosen === 'comment') return { about: selection ?? undefined };
      // THE DOCUMENT'S COMMENTS belong to the tab's document alone; they do not pair.
      if (chosen === 'comments') return { about: { scope: 'comments', docId: focused.docId } };
      // A PICTURE OF THE PAGE ON SCREEN, for a model that can see; one that says it cannot waits.
      if (chosen === 'page-image') {
        return canSee ? { about: { scope: 'page-image', docId: focused.docId, page: focused.page } } : null;
      }
      const on = (docId: DocId, page: number): AskAbout =>
        chosen === 'page' ? { scope: 'page', docId, page } : { scope: 'document', docId };
      const left = on(focused.docId, focused.page);
      if (beside === undefined || beside.docId === focused.docId) return { about: left };
      if (sides === undefined) return null;
      const right = on(beside.docId, beside.page);
      const record = { asked: sides, right: beside.docId };
      if (sides === 'left') return { about: left, sides: record };
      if (sides === 'right') return { about: right, sides: record };
      return { about: left, alongside: right, sides: record };
    },
    [beside, canSee, focused, selection, sides],
  );

  const ask = useCallback(
    /** @returns whether the ask began; a request not begun is kept for when it can be. */
    (text: string, { about, alongside, sides: asked }: AskRequest, replyTo?: ReplyTarget): boolean => {
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
      const turn: ConversationTurn = {
        role: 'user',
        text,
        ...(replyTo === undefined ? {} : { replyTo }),
        ...(asked === undefined ? {} : { sides: asked }),
        request: {
          about,
          ...(alongside === undefined ? {} : { alongside }),
          ...(asked === undefined ? {} : { sides: asked }),
        },
        model: models.find((entry) => entry.id === model)?.label ?? model,
      };
      write([...before, turn]);
      setProblem(null);
      answer.current = '';
      live.current = { subscription, write, read };
      setStreaming(subscription);
      void client['ai.ask']({
        subscription,
        provider,
        model,
        messages: [...before, turn].map((each) => ({ role: each.role, text: each.text })),
        ...(about === undefined ? {} : { about }),
        ...(alongside === undefined ? {} : { alongside }),
      }).then((result) => {
        if (result.ok && result.value.started) {
          // THE DRAFT IS CLEARED ONLY ONCE THE ASK STARTED. A request that never began must
          // leave a person's words where they typed them.
          setDraft((current) => (current.trim() === text ? '' : current));
          // WHAT WENT is recorded on the turn that asked, so the line under it is main's answer
          // rather than the scope the panel meant.
          const now = read();
          const at = now.lastIndexOf(turn);
          const { sent, alongside: second } = result.value;
          if (at !== -1) {
            write(
              now.map((each, index) =>
                index === at ? { ...each, sent, ...(second === undefined ? {} : { alongside: second }) } : each,
              ),
            );
          }
          return;
        }
        live.current = null;
        setStreaming(null);
        // A PAGE TOO LARGE TO PICTURE is its own sentence: the person can ask about its text.
        setProblem(!result.ok && result.error.code === 'page-too-large' ? 'page-too-large' : 'rejected');
      });
      return true;
    },
    [client, focused, model, models, provider],
  );

  /** The conversation the panel shows, and a way to replace it — the document's, or the loose one. */
  const writeTurns = useCallback(
    (next: readonly ConversationTurn[]): void => {
      if (focused === undefined) {
        looseRef.current = next;
        setLooseTurns(next);
      } else focused.store.getState().converse(next);
    },
    [focused],
  );

  /**
   * *Edit* on the last question: its words go back into the composer, and the next Send replaces
   * that question and its answer rather than adding a turn after them. `null` when not editing.
   */
  // AN EDIT BELONGS TO ONE DOCUMENT'S CONVERSATION: held with that document's id, and read as no
  // edit anywhere else — so a tab switch cannot point its index into another document's turns.
  const [editingIn, setEditingIn] = useState<{ readonly docId: DocId | undefined; readonly at: number } | null>(null);
  const editing = editingIn !== null && editingIn.docId === focused?.docId ? editingIn.at : null;
  const setEditing = useCallback(
    (at: number | null): void => {
      setEditingIn(at === null ? null : { docId: focused?.docId, at });
    },
    [focused?.docId],
  );

  const send = useCallback(() => {
    const wanted = requestFor(scope);
    if (wanted === null) return;
    // EDIT AND RESEND: the edited question and everything after it go before the new one is asked.
    // Only when the ask can begin, so a Send that cannot start leaves the conversation as it was.
    if (editing !== null && live.current === null && model !== '' && draft.trim() !== '') {
      writeTurns(turns.slice(0, editing));
      setEditing(null);
    }
    ask(draft.trim(), wanted);
  }, [ask, draft, editing, model, requestFor, scope, setEditing, turns, writeTurns]);

  /** *Regenerate* the last answer: the same question, about the same thing, asked again. */
  const regenerate = useCallback(() => {
    const at = turns.findLastIndex((turn) => turn.role === 'user');
    const question = turns[at];
    if (question === undefined || live.current !== null || model === '') return;
    writeTurns(turns.slice(0, at));
    if (!ask(question.text, question.request ?? { about: undefined }, question.replyTo)) writeTurns(turns);
  }, [ask, model, turns, writeTurns]);

  /** A short-lived *Copied* beside the answer that was copied, by its index. */
  const [copied, setCopied] = useState<number | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => {
      setCopied(null);
    }, COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

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
    if (request.prompt === undefined || ask(i18n._(request.prompt), { about: request.about }, request.replyTo)) {
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

  const readiness = assistantReadiness(providers.length > 0, hasKey, models.length);

  const number = new Intl.NumberFormat(i18n.locale);

  /** The line under an asked turn: which pages went, as `main` answered. */
  const sentLine = (sent: AskSent): string => {
    // A PICTURE carries no characters, and saying *no text was found* of one would be false.
    if (sent.picture === true && sent.firstPage !== null) {
      return i18n._(ASSISTANT_SENT_PICTURE, { page: pdfjsPageOf(sent.firstPage), count: sent.pageCount });
    }
    if (sent.firstPage === null || sent.lastPage === null || sent.characters === 0) return i18n._(ASSISTANT_SENT_NOTHING);
    // COMMENTS are counted, not paged: their pages are only the ones carrying a comment, so *page 1
    // of 3* would read as two pages left out when every comment went.
    if (sent.comments !== undefined) {
      return i18n._(sent.truncated ? ASSISTANT_SENT_COMMENTS_CUT : ASSISTANT_SENT_COMMENTS, { comments: sent.comments });
    }
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

  /**
   * The caption under an answer, *Claude Haiku 4.5 · whole document*: which model answered and what
   * it was asked about, from the question's own record rather than from what the panel shows now.
   */
  const captionFor = (question: ConversationTurn | undefined): string => {
    const about = question?.request?.about;
    const page = about !== undefined && 'page' in about ? pdfjsPageOf(about.page) : 0;
    const scope =
      about === undefined
        ? i18n._(ASSISTANT_SCOPE_NOTHING)
        : {
            page: () => i18n._(ASSISTANT_SCOPE_PAGE, { page }),
            document: () => i18n._(ASSISTANT_SCOPE_DOCUMENT),
            comments: () => i18n._(ASSISTANT_SCOPE_COMMENTS),
            'page-image': () => i18n._(ASSISTANT_SCOPE_PICTURE, { page }),
            selection: () => i18n._(ASSISTANT_SCOPE_SELECTION),
            comment: () => i18n._(ASSISTANT_SCOPE_COMMENT),
          }[about.scope]();
    const side = question?.request?.sides?.asked;
    const which = side === undefined ? '' : ` · ${i18n._(SIDE_WORDS[side])}`;
    return i18n._(ASSISTANT_CAPTION, { model: question?.model ?? '', scope: `${scope}${which}` });
  };

  /** The lines under an asked turn: one, or one per side for a turn asked of both. */
  const sentLines = (turn: ConversationTurn): readonly string[] => {
    if (turn.sent === undefined || turn.sent === null) return [];
    if (turn.alongside === undefined) return [sentLine(turn.sent)];
    return [
      i18n._(ASSISTANT_SENT_LEFT, { sent: sentLine(turn.sent) }),
      i18n._(ASSISTANT_SENT_RIGHT, { sent: sentLine(turn.alongside) }),
    ];
  };

  /**
   * Where a citation goes, given the turn that asked (ADR-0089): a side it names, or the side the
   * turn went to. A page on the RIGHT is a link only while the document it was asked of is still
   * the one on the right; a side-less citation from an ask of both names no document, so it is
   * text.
   */
  const citationTarget = (
    side: AskSide | undefined,
    asked: ConversationTurn['sides'],
  ): { readonly go: (page: number) => void; readonly label: MessageKey } | undefined => {
    const toSide = side ?? (asked === undefined || asked.asked === 'left' ? 'left' : asked.asked === 'right' ? 'right' : undefined);
    if (toSide === 'left') return onGoTo === undefined ? undefined : { go: onGoTo, label: ASSISTANT_CITATION };
    if (toSide === 'right' && asked !== undefined && beside?.docId === asked.right && onGoToBeside !== undefined) {
      return { go: onGoToBeside, label: ASSISTANT_CITATION_RIGHT };
    }
    return undefined;
  };

  /**
   * A run of an answer's plain text, with each `[p. N]` citation a link to that page. The
   * Markdown around it is {@link answerElements}'; this is only ever handed text, never code.
   */
  const answerTextFor =
    (asked: ConversationTurn['sides']) =>
    (text: string, key: string): ReactElement => (
      <Fragment key={key}>
        {citationsIn(text).map((piece, at) => {
          if (!('cited' in piece)) return <span key={at}>{piece.text}</span>;
          const target = citationTarget(piece.side, asked);
          if (target === undefined) return <span key={at}>{piece.label}</span>;
          return (
            <button
              aria-label={i18n._(target.label, { page: pdfjsPageOf(piece.cited) })}
              className="m-assistant__citation"
              data-assistant-citation={piece.cited}
              data-assistant-citation-side={piece.side ?? asked?.asked ?? 'left'}
              key={at}
              onClick={() => {
                target.go(piece.cited);
              }}
              type="button"
            >
              {piece.label}
            </button>
          );
        })}
      </Fragment>
    );

  const quickStarts = [
    { key: ASSISTANT_QUICK_SUMMARISE, scope: 'document' },
    { key: ASSISTANT_QUICK_DATES, scope: 'document' },
    { key: ASSISTANT_QUICK_EXPLAIN_PAGE, scope: 'page' },
    // VISION ANALYSIS' OWN START (D11's *table reading assist*): a picture of the page on screen.
    { key: ASSISTANT_QUICK_READ_TABLE, scope: 'page-image' },
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
                <option value={selection.scope}>
                  {i18n._(selection.scope === 'comment' ? ASSISTANT_ABOUT_COMMENT : ASSISTANT_ABOUT_SELECTION, {
                    page: pdfjsPageOf(selection.page),
                  })}
                </option>
              )}
              <option value="page">
                {i18n._(ASSISTANT_ABOUT_PAGE, {
                  // THE PAGE THAT WILL GO: the right pane's when the conversation asks the right.
                  page: pdfjsPageOf(beside !== undefined && sides === 'right' ? beside.page : focused.page),
                })}
              </option>
              <option value="document">{i18n._(ASSISTANT_ABOUT_DOCUMENT, { characters: number.format(MAX_ASK_CONTEXT) })}</option>
              <option value="comments">{i18n._(ASSISTANT_ABOUT_COMMENTS)}</option>
              {/* DISABLED, NOT DROPPED, for a model that says it cannot see (ADR-0081's rule). */}
              <option disabled={!canSee} value="page-image">
                {i18n._(ASSISTANT_ABOUT_PICTURE, { page: pdfjsPageOf(focused.page) })}
              </option>
              <option value="nothing">{i18n._(ASSISTANT_ABOUT_NOTHING)}</option>
            </select>
          </label>
          {pairable && (
            // NATIVE RADIOS with nothing checked until a person chooses — a segmented control
            // always holds one, and holding one here would be the default ADR-0089 refuses.
            <fieldset className="m-assistant__sides" data-assistant-sides="">
              <legend>{i18n._(ASSISTANT_SIDES_LABEL)}</legend>
              {SIDE_CHOICES.map((choice) => (
                <label className="m-assistant__side" key={choice.sides}>
                  <input
                    checked={sides === choice.sides}
                    name={sidesName}
                    onChange={() => {
                      focused.store.getState().choseSides(choice.sides);
                    }}
                    type="radio"
                    value={choice.sides}
                  />
                  {i18n._(choice.label)}
                </label>
              ))}
            </fieldset>
          )}
          {blindForPicture && (
            <p className="m-assistant__state" data-assistant-no-vision="">
              {i18n._(ASSISTANT_NO_VISION)}
            </p>
          )}
          {waitingForSides && (
            <p className="m-assistant__state" data-assistant-sides-needed="">
              {i18n._(ASSISTANT_SIDES_NEEDED)}
            </p>
          )}
          {scope !== 'nothing' && (
            <p className="m-assistant__consent" data-assistant-consent="">
              {i18n._(ASSISTANT_ABOUT_SENDS, { provider: i18n._(AI_PROVIDER_NAMES[provider]) })}
            </p>
          )}
        </div>
      )}

      {readiness !== 'ready' && (
        <p className="m-assistant__state" data-assistant-readiness={readiness}>
          {i18n._(READINESS[readiness])}
        </p>
      )}
      {problem !== null && <p className="m-assistant__problem">{i18n._(PROBLEMS[problem])}</p>}

      {focused !== undefined && hasKey && turns.length === 0 && (
        <div aria-label={i18n._(ASSISTANT_QUICK_LABEL)} className="m-assistant__quick" role="group">
          {quickStarts.map((quick) => {
            const wanted = requestFor(quick.scope);
            return (
              <Button
                disabled={wanted === null}
                key={quick.key}
                label={quick.key}
                onClick={() => {
                  choose(quick.scope);
                  if (wanted !== null) ask(i18n._(quick.key), wanted);
                }}
              />
            );
          })}
        </div>
      )}

      {turns.length > 0 && (
        <div className="m-assistant__conversation-bar">
          {/* NEW CHAT empties this document's conversation — and, with history on, its saved copy
              the next time it settles. Not while an answer is arriving: that answer has nowhere to go. */}
          <Button
            disabled={streaming !== null}
            label={ASSISTANT_NEW_CHAT}
            onClick={() => {
              writeTurns([]);
              setEditing(null);
              setProblem(null);
            }}
          />
        </div>
      )}

      <ol aria-label={i18n._(ASSISTANT_CONVERSATION_LABEL)} className="m-assistant__turns">
        {turns.map((turn, at) => (
          <li className="m-assistant__turn" data-assistant-role={turn.role} key={`${String(at)}-${turn.role}`}>
            <span className="m-assistant__who">
              {i18n._(turn.role === 'user' ? ASSISTANT_YOU : ASSISTANT_ASSISTANT)}
            </span>
            {turn.role === 'assistant' ? (
              // RENDERED MARKDOWN, the owner's specification: headings, lists, tables, code —
              // built as elements from the tokens, so no HTML from the answer reaches the page.
              <div className="m-assistant__text m-assistant__answer">
                {answerElements(turn.text, answerTextFor(turns[at - 1]?.sides))}
              </div>
            ) : (
              <p className="m-assistant__text">{turn.text}</p>
            )}
            {sentLines(turn).map((line) => (
              <p className="m-assistant__sent" data-assistant-sent="" key={line}>
                {line}
              </p>
            ))}
            {turn.role === 'assistant' && (streaming === null || at !== turns.length - 1) && turn.text.trim() !== '' && (
              // THE ANSWER'S OWN ACTIONS, the owner's design: under a whole answer, never a streaming
              // one. Regenerate and Edit belong to the LAST exchange, because a conversation replays
              // from the question they change; Copy and Add as note are for any answer.
              <div className="m-assistant__actions" data-assistant-actions="">
                {at === turns.length - 1 && (
                  <>
                    <IconButton icon={RefreshCw} label={ASSISTANT_REGENERATE} onClick={regenerate} size="dense" />
                    <IconButton
                      icon={Pencil}
                      label={ASSISTANT_EDIT}
                      onClick={() => {
                        const question = turns.findLastIndex((each) => each.role === 'user');
                        const asked = turns[question];
                        if (asked === undefined) return;
                        setDraft(asked.text);
                        setEditing(question);
                      }}
                      size="dense"
                    />
                  </>
                )}
                <IconButton
                  icon={Copy}
                  label={ASSISTANT_COPY}
                  onClick={() => {
                    // THROUGH MAIN: the renderer holds no clipboard permission (§2). *Copied* shows only
                    // when main says the text went, never as a hope.
                    void client['window.copyText']({ text: turn.text.slice(0, MAX_CHAT_TEXT) }).then((answer) => {
                      if (answer.ok && answer.value.copied) setCopied(at);
                    });
                  }}
                  size="dense"
                />
                {onNote !== undefined && focused !== undefined && (
                  <IconButton
                    disabled={turn.noted === true}
                    icon={StickyNote}
                    label={turn.noted === true ? ASSISTANT_NOTED : ASSISTANT_ADD_NOTE}
                    onClick={() => {
                      if (!onNote(turn.text.trim().slice(0, MAX_ANNOTATION_TEXT))) return;
                      focused.store
                        .getState()
                        .converse(turns.map((each, index) => (index === at ? { ...each, noted: true } : each)));
                    }}
                    size="dense"
                  />
                )}
                <span aria-live="polite" className="m-assistant__done">
                  {copied === at ? i18n._(ASSISTANT_COPIED) : ''}
                </span>
                {turns[at - 1]?.model !== undefined && (
                  <span className="m-assistant__caption">{captionFor(turns[at - 1])}</span>
                )}
              </div>
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

      {editing !== null && (
        <div className="m-assistant__editing" data-assistant-editing="">
          <span>{i18n._(ASSISTANT_EDITING)}</span>
          <Button
            label={ASSISTANT_EDIT_CANCEL}
            onClick={() => {
              setEditing(null);
              setDraft('');
            }}
          />
        </div>
      )}
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
          // NOT A DEAD CONTROL (§10.5): with no key, or no model to ask, Send is disabled and the
          // lines above say which — pressing it would otherwise do nothing and say nothing.
          <Button
            disabled={!hasKey || model === '' || waitingForSides || blindForPicture}
            label={ASSISTANT_SEND}
            onClick={send}
            variant="primary"
          />
        ) : (
          <Button label={ASSISTANT_STOP} onClick={stop} />
        )}
      </div>
      <p className="m-assistant__hint">{i18n._(ASSISTANT_ASK)}</p>
    </div>
  );
}
