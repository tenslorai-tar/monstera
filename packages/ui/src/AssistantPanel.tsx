import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  type AiModel,
  type AiProviderId,
  type AskAbout,
  type AskSent,
  type AskSide,
  type AskSides,
  type ASK_UNREAD_REASONS,
  type AskFileUnread,
  type ContractClient,
  MAX_ANNOTATION_TEXT,
  MAX_ASK_ATTACHMENTS,
  MAX_ASK_DOCUMENTS,
  MAX_CHAT_TEXT,
  askShareOf,
  type DispatchableCommand,
  type WebSearchAbsence,
  choiceReadsImages,
  citationsIn,
  defaultModel,
  servesVision,
  webSearchOf,
} from '@monstera/contract';
import type { DocId, MessageKey } from '@monstera/shared';
import { useLingui } from '@lingui/react';
import { ArrowUp, Copy, Paperclip, Pencil, Plus, RefreshCw, Square, StickyNote, X } from 'lucide-react';
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { AnswerGrounding } from './AnswerGrounding.js';
import { answerElements } from './answerMarkdown.js';
import type { AssistantRequest, ReplyTarget } from './assistantRequest.js';
import type { EventSubscriber } from './bridge.js';
import { confirmCopied } from './commands/confirmWritten.js';
import type { AskedDocuments, AttachedFile, ConversationTurn, DocumentStore } from './documentStores.js';
import {
  AI_PROVIDER_NAMES,
  ANTHROPIC_OUT_OF_CREDIT,
  ASSISTANT_ABOUT_LABEL,
  ASSISTANT_ASK,
  ASSISTANT_ASSISTANT,
  ASSISTANT_CHIP_COMMENT,
  ASSISTANT_CHIP_COMMENTS,
  ASSISTANT_CHOOSE,
  ASSISTANT_CHIP_DOCUMENT,
  ASSISTANT_CHIP_NOTHING,
  ASSISTANT_CHIP_PAGE,
  ASSISTANT_CHIP_PICTURE,
  ASSISTANT_CHIP_SELECTION,
  ASSISTANT_CITATION,
  ASSISTANT_CITATION_RIGHT,
  ASSISTANT_CHIP_ALL,
  ASSISTANT_SCOPE_ALL,
  ASSISTANT_SENT_SHARE,
  ASSISTANT_SENT_DOCUMENT,
  ASSISTANT_SENT_UNREAD,
  ASSISTANT_SENT_NOT_SENT,
  ASSISTANT_UNREAD_CLOSED,
  ASSISTANT_UNREAD_BUSY,
  ASSISTANT_UNREAD_DAMAGED,
  ASSISTANT_UNREAD_PAGE,
  ASSISTANT_CITATION_DOCUMENT,
  ASSISTANT_ATTACH,
  ASSISTANT_ATTACHED_DROPPED,
  ASSISTANT_ATTACHED_LIST,
  ASSISTANT_ATTACHED_REMOVE,
  ASSISTANT_FILE_CANNOT_READ_HERE,
  ASSISTANT_FILE_CANNOT_SEE,
  ASSISTANT_FILE_NOT_FOUND,
  ASSISTANT_FILE_NOT_SUPPORTED,
  ASSISTANT_FILE_TOO_LARGE,
  ASSISTANT_FILE_UNREADABLE,
  ASSISTANT_SENT_FILE_PICTURE,
  ASSISTANT_SENT_SHARE_EACH,
  ASSISTANT_SIZE_KB,
  ASSISTANT_SIZE_MB,
  ASSISTANT_COMPOSER_LABEL,
  ASSISTANT_CONVERSATION_LABEL,
  ASSISTANT_EMPTY,
  AI_MODELS_NONE,
  ASSISTANT_MODEL_LABEL,
  ASSISTANT_MODEL_NOT_OFFERED,
  ASSISTANT_MODEL_NO_VISION,
  ASSISTANT_NO_KEY,
  ASSISTANT_SEARCHES_THE_WEB,
  ASSISTANT_WEB_ALWAYS,
  ASSISTANT_WEB_DOCUMENT,
  ASSISTANT_WEB_LABEL,
  ASSISTANT_WEB_NONE_MODEL,
  ASSISTANT_WEB_NONE_NO_SEARCH,
  ASSISTANT_WEB_NONE_TERMS,
  ASSISTANT_WEB_ON,
  ASSISTANT_NO_MODELS,
  ASSISTANT_NO_VISION,
  ASSISTANT_PROBLEM_PAGE_TOO_LARGE,
  ASSISTANT_PLACEHOLDER,
  ASSISTANT_QUOTED,
  ASSISTANT_POST_REPLY,
  ASSISTANT_PROBLEM_REJECTED,
  ASSISTANT_PROBLEM_UNAUTHORISED,
  ASSISTANT_PROBLEM_UNREACHABLE,
  ASSISTANT_PROBLEM_UNREADABLE,
  ASSISTANT_PROVIDER_LABEL,
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
import type { ShowToast } from './toasts.js';
import { Button } from './primitives/Button.js';
import { ChoiceMenu } from './primitives/ChoiceMenu.js';
import { IconButton } from './primitives/IconButton.js';
import { useOnColor } from './primitives/useOnColor.js';
import { AI_MODELS_SETTING, AI_PROVIDER_SETTING } from './settings/ai.js';
import type { SettingsStore } from './settingsStore.js';
import { useSetting } from './useSetting.js';

/**
 * The assistant, as a tab of the right contextual panel
 * ([ADR-0083](../../../docs/DECISIONS/0083-the-contextual-panel-holds-tabs-and-the-assistant-is-one.md),
 * [ADR-0081](../../../docs/DECISIONS/0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md),
 * [ADR-0082](../../../docs/DECISIONS/0082-main-may-push-on-declared-event-channels.md),
 * [ADR-0088](../../../docs/DECISIONS/0088-an-ask-about-a-document-carries-a-bounded-window-read-in-main.md)).
 *
 * ## The provider is named before anything is sent; what went is named after
 *
 * The provider picker under the message box shows who receives the next ask, and Send is the explicit
 * action (ARCHITECTURE §8, *What reaches an AI provider*). The Context menu chooses which part
 * of the document goes. Nothing about the document is read until Send, and each asked turn then
 * says which pages actually went, so a whole-document question about a long file says that it
 * covered the first twelve pages.
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
  /** Where a copied answer is confirmed: the window's toast, every copy's one confirmation (`confirmCopied`). */
  readonly toast: ShowToast;
  /** Which provider keys this machine has stored, from `settings.loadSecrets`. */
  readonly storedSecrets: readonly string[];
  /** Where the provider and each provider's model are kept (ADR-0117) — the picker below writes them. */
  readonly settings: SettingsStore;
  /**
   * The focused document, REQUIRED: the panel is mounted in an open document's page area only, so the start-screen
   * conversation it once kept in its own state was a branch no build reached. The conversation lives in this store.
   */
  readonly focused: AssistantDocument;
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
  /**
   * The tabs open now, in their order, by id and the name each shows — what *All Open Docs* sends at Send, and what
   * decides whether it is offered at all: with fewer than two it is not (ADR-0134).
   */
  readonly openDocuments?: readonly { readonly docId: DocId; readonly name: string }[] | undefined;
  /** Goes to a page of another open document, zero-based — an *All Open Docs* answer's citation (ADR-0134). */
  readonly onGoToDocument?: ((docId: DocId, page: number) => void) | undefined;
}

/** Which document a two-document answer was about, for its caption. */
const SIDE_WORDS = {
  left: ASSISTANT_SCOPE_LEFT,
  right: ASSISTANT_SCOPE_RIGHT,
  both: ASSISTANT_SCOPE_BOTH,
} as const;

/** What one ask is about — the same shape a turn records, so Regenerate can ask it again. */
type AskRequest = NonNullable<ConversationTurn['request']>;

/** No tabs passed: a stable empty list, so the default does not change identity every render. */
const NO_DOCUMENTS: readonly { readonly docId: DocId; readonly name: string }[] = [];

/** Why a document was not read, in words (ADR-0134): the contract's reason for each. */
const UNREAD_WORDS: Readonly<Record<(typeof ASK_UNREAD_REASONS)[number], MessageKey>> = {
  'document-not-open': ASSISTANT_UNREAD_CLOSED,
  'document-busy': ASSISTANT_UNREAD_BUSY,
  'document-poisoned': ASSISTANT_UNREAD_DAMAGED,
  'page-too-large': ASSISTANT_UNREAD_PAGE,
};

/** Why an attached file was not read, in words (ADR-0135): the contract's reason for each. */
const FILE_UNREAD_WORDS: Readonly<Record<AskFileUnread, MessageKey>> = {
  'not-found': ASSISTANT_FILE_NOT_FOUND,
  'too-large': ASSISTANT_FILE_TOO_LARGE,
  'not-supported': ASSISTANT_FILE_NOT_SUPPORTED,
  unreadable: ASSISTANT_FILE_UNREADABLE,
  'cannot-see': ASSISTANT_FILE_CANNOT_SEE,
  'cannot-read-here': ASSISTANT_FILE_CANNOT_READ_HERE,
};

/** Nothing attached: one stable value, so the default does not change identity every render. */
const NOTHING_ATTACHED: { readonly files: readonly AttachedFile[]; readonly dropped: number } = { files: [], dropped: 0 };

/**
 * What *All Open Docs* sends when Send is pressed (ADR-0134 Decision 5): the focused document first, then the other
 * tabs in their order, the first {@link MAX_ASK_DOCUMENTS} of them — and the names of the ones past that, said rather
 * than refused. `undefined` with fewer than two, when the choice is not offered.
 */
function allOpen(
  focused: DocId,
  open: readonly { readonly docId: DocId; readonly name: string }[],
): AskedDocuments | undefined {
  const own = open.find((each) => each.docId === focused);
  if (own === undefined || open.length < 2) return undefined;
  const ordered = [own, ...open.filter((each) => each.docId !== focused)];
  return {
    asked: ordered.slice(0, MAX_ASK_DOCUMENTS),
    notSent: ordered.slice(MAX_ASK_DOCUMENTS).map((each) => each.name),
  };
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
  'page-too-large': ASSISTANT_PROBLEM_PAGE_TOO_LARGE,
  'searches-the-web': ASSISTANT_SEARCHES_THE_WEB,
} as const;

/** Why *Document + web* is off, as the sentence beside the disabled choice (ADR-0108). */
const WEB_ABSENT: Readonly<Record<WebSearchAbsence, MessageKey>> = {
  'no-hosted-search': ASSISTANT_WEB_NONE_NO_SEARCH,
  'display-terms': ASSISTANT_WEB_NONE_TERMS,
  'model-cannot': ASSISTANT_WEB_NONE_MODEL,
};

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
 * What the Context choice can be. A selection or a comment exists only when a command gave one,
 * and is offered under its own name — the menu and the instruction both say which.
 */
type Scope = 'page' | 'page-image' | 'document' | 'comments' | 'selection' | 'comment' | 'all' | 'nothing';

const NO_SUBSCRIBE = (): (() => void) => () => undefined;
const NO_TURNS: readonly ConversationTurn[] = [];

/** The conversation's turns: the document's, or this panel's own on the start screen. */
function useConversation(store: DocumentStore | undefined): readonly ConversationTurn[] {
  return useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, () => store?.getState().conversation ?? NO_TURNS);
}

/**
 * One turn of the conversation. A person's sits in a bubble filled with the ACCENT (the owner, 2 October), so its text
 * is solved against the accent in effect where it is drawn, never stored: the accent is the person's choice and the
 * theme the window's, and a fixed text colour is right for one pair of them (ADR-0003, `useOnColor`).
 */
function Turn({ role, children }: { readonly role: ConversationTurn['role']; readonly children: ReactNode }): ReactElement {
  const element = useRef<HTMLLIElement>(null);
  useOnColor(element, 'color', '--text', role === 'user' ? ['--accent'] : [], 'text');
  return (
    <li ref={element} className="m-assistant__turn" data-assistant-role={role}>
      {children}
    </li>
  );
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
  toast,
  storedSecrets,
  settings,
  focused,
  onGoTo,
  request,
  handled,
  onHandled,
  onReply,
  onNote,
  beside,
  onGoToBeside,
  openDocuments = NO_DOCUMENTS,
  onGoToDocument,
}: AssistantPanelProps): ReactElement {
  const { i18n } = useLingui();
  const providerId = useId();
  const modelId = useId();
  const hintId = useId();
  const sidesName = useId();
  const chooseId = useId();
  // THE PROVIDER AND EACH PROVIDER'S MODEL ARE SETTINGS (ADR-0117): this picker writes them, `main` reads Anthropic's for
  // the recogniser, and a choice survives the panel closing. The list itself is fetched here, per provider.
  const provider = useSetting(settings, AI_PROVIDER_SETTING);
  const chosenModels = useSetting(settings, AI_MODELS_SETTING);
  // WITH THE CAPABILITIES, because a model that cannot see is not offered a picture (ADR-0090):
  // `false` where the provider says so, `null` where it does not say.
  const [models, setModels] = useState<readonly AiModel[]>([]);
  // WHERE THE CHOICE READS IMAGES: the contract's rule, which the Settings row takes too (ADR-0117 Decision 4).
  const readsImages = choiceReadsImages(provider);
  const stored = chosenModels[provider];
  // THE PERSON'S CHOICE, or the contract's one default for this use — the rule `main` takes for the recogniser.
  const model = stored ?? defaultModel(models, { vision: readsImages })?.id ?? '';
  const setProvider = (next: AiProviderId): void => {
    settings.set(AI_PROVIDER_SETTING.id, next);
  };
  const setModel = (next: string): void => {
    settings.set(AI_MODELS_SETTING.id, { ...chosenModels, [provider]: next });
  };
  const [draft, setDraft] = useState('');
  // THE FILES FOR THE NEXT QUESTION (ADR-0135): handles `main` minted, a name and a size each. They go with the next
  // ask that starts, and are cleared then, as the draft is.
  const [attached, setAttached] = useState(NOTHING_ATTACHED);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [problem, setProblem] = useState<keyof typeof PROBLEMS | null>(null);
  const [chosen, setChosen] = useState<{ readonly scope: Scope; readonly after: number }>({
    scope: 'page',
    after: 0,
  });
  /**
   * *Document + web*, chosen for ONE document's conversation (ADR-0108). Every new chat starts *Document only*: the
   * choice is held with the document it was made in and dropped by *New chat*, so another tab — or the same one after
   * a new chat — reads it as off.
   */
  const [webChosen, setWebChosen] = useState<{ readonly docId: DocId } | null>(null);

  const turns = useConversation(focused.store);

  /**
   * The live ask: its subscription, and WHERE its answer goes — the conversation it was asked
   * from, captured at Send, never the one focused when a delta arrives.
   */
  const live = useRef<{
    subscription: string;
    write: (turns: readonly ConversationTurn[]) => void;
    read: () => readonly ConversationTurn[];
    /** Asked with *Document + web* — the answer then carries what the web gave (ADR-0108). */
    web: boolean;
  } | null>(null);
  /** The answer being assembled, kept out of state so each delta is one write. */
  const answer = useRef('');

  const hasKey = storedSecrets.includes(AI_PROVIDERS[provider].keySetting);

  useEffect(() => {
    let cancelled = false;
    void client['ai.models']({ provider }).then((result) => {
      if (cancelled || !result.ok) return;
      // NO MODEL IS WRITTEN HERE: a choice is stored only when a person makes one, so the default follows the list.
      setModels(result.value.models);
    });
    return () => {
      cancelled = true;
    };
  }, [client, provider]);

  // A SELECTION BELONGS TO THE DOCUMENT IT WAS MADE IN, and it is DERIVED from the request that
  // carried it rather than copied into state: switching tabs makes it vanish by construction, so
  // the Context menu can never offer words from a file that is not in front of the reader.
  const docId = focused.docId;
  const selection =
    (request?.about.scope === 'selection' || request?.about.scope === 'comment') && request.about.docId === docId
      ? request.about
      : null;
  // THE PERSON'S CHOICE, stamped with the newest request it was made after: a request that
  // arrives later points the menu, and a choice made after that request wins again.
  const requestedScope =
    request !== undefined && request.serial > chosen.after ? request.about.scope : undefined;
  const wanted = requestedScope ?? chosen.scope;
  // A CARRIED SCOPE WITH NOTHING CARRYING IT falls back to the page — the request was about
  // another document, or none arrived.
  const scope: Scope = (wanted === 'selection' || wanted === 'comment') && selection?.scope !== wanted ? 'page' : wanted;
  const choose = (next: Scope): void => {
    setChosen({ scope: next, after: request?.serial ?? 0 });
  };

  // *ASK AI* QUOTES THE SELECTION in the box, a space after it, for the person to finish (the owner, 2 October). Set
  // while rendering, from the request, so it lands in the same frame as the panel that shows it; `quotedFrom` makes it
  // once per request, and `handled` keeps a remount from writing it over what the person has typed since. The quote
  // marks are a message, because they are a language's own. Nothing is sent, and the Context menu stays on Selection
  // because the request is what points it (`requestedScope` above).
  const composer = useRef<HTMLTextAreaElement>(null);
  const [quotedFrom, setQuotedFrom] = useState<number | undefined>(undefined);
  if (request?.quote !== undefined && request.serial !== handled && request.serial !== quotedFrom && request.about.docId === docId) {
    setQuotedFrom(request.serial);
    setDraft(`${i18n._(ASSISTANT_QUOTED, { text: request.quote })} `);
  }
  // THE CURSOR AFTER THE QUOTE, once the box holds it: focus alone puts it wherever the last edit left it.
  useEffect(() => {
    const box = composer.current;
    if (quotedFrom === undefined || box === null) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [quotedFrom]);

  // LEFT · RIGHT · BOTH, offered only when it can mean something (ADR-0089): a second document
  // on the right, and a scope that names a page or the document. A selection or a comment belongs
  // to the document it was made in, and one document shown has nothing to choose between.
  const sides = useSides(focused.store);
  const pairable = beside !== undefined && beside.docId !== focused.docId && (scope === 'page' || scope === 'document');
  // NO DEFAULT: with two documents and no choice, an ask waits rather than sending a document
  // nobody picked.
  const waitingForSides = pairable && sides === undefined;
  // A MODEL THAT SAYS IT CANNOT SEE is not offered a picture; one that does not say is, and a
  // provider's refusal is then worded like any other (ADR-0090 Decision 5).
  const chosenEntry = models.find((entry) => entry.id === model);
  const canSee = chosenEntry === undefined || servesVision(chosenEntry);
  const blindForPicture = scope === 'page-image' && !canSee;

  // WHETHER THIS PROVIDER AND MODEL CAN SEARCH — `webSearchOf`, the one reading `main` also takes (ADR-0108).
  const webSupport = webSearchOf(provider, model);
  const webPicked = webChosen !== null && webChosen.docId === focused.docId;
  // WHAT AN ASK SENDS: the person's choice, where this model can search at all.
  const webAsked = webPicked && webSupport.kind !== 'none';
  // A MODEL THAT ALWAYS SEARCHES is not asked *Document only* — `main` would refuse it; Send says so first.
  const searchesAnyway = webSupport.kind === 'always' && !webAsked;

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
      const asking = live.current;
      if (asking?.subscription !== payload.subscription) return;
      if (payload.refusal !== undefined) setProblem(payload.refusal);
      // WHAT THE WEB GAVE lands on the answer it belongs to — only for an ask made with the web on, so a *Document
      // only* answer never carries the *No web search was used* line (ADR-0108).
      const existing = asking.read();
      const last = existing.at(-1);
      if (asking.web && last?.role === 'assistant') {
        asking.write([...existing.slice(0, -1), { ...last, web: payload.web }]);
      }
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
      if (chosen === 'nothing') return { about: undefined };
      if (chosen === 'selection' || chosen === 'comment') return { about: selection ?? undefined };
      // THE DOCUMENT'S COMMENTS belong to the tab's document alone; they do not pair.
      if (chosen === 'comments') return { about: { scope: 'comments', docId: focused.docId } };
      // A PICTURE OF THE PAGE ON SCREEN, for a model that can see; one that says it cannot waits.
      if (chosen === 'page-image') {
        return canSee ? { about: { scope: 'page-image', docId: focused.docId, page: focused.page } } : null;
      }
      // EVERY OPEN DOCUMENT, as the tabs stand at Send (ADR-0134). With fewer than two left — a tab closed since the
      // choice — it is this document, which is what *all* of one document is.
      if (chosen === 'all') {
        const documents = allOpen(focused.docId, openDocuments);
        return documents === undefined
          ? { about: { scope: 'document', docId: focused.docId } }
          : { about: { scope: 'documents', docIds: documents.asked.map((each) => each.docId) }, documents };
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
    [beside, canSee, focused, openDocuments, selection, sides],
  );

  /** A NEW ask's request: the scope's, with the switch as it stands now (ADR-0108). *Regenerate* keeps its own. */
  const newRequest = useCallback(
    (chosen: Scope): AskRequest | null => {
      const request = requestFor(chosen);
      return request === null ? null : { ...request, web: webAsked };
    },
    [requestFor, webAsked],
  );

  const ask = useCallback(
    /** @returns whether the ask began; a request not begun is kept for when it can be. */
    (
      text: string,
      { about, alongside, sides: asked, documents, attachments, web = false }: AskRequest,
      replyTo?: ReplyTarget,
    ): boolean => {
      if (text === '' || model === '' || live.current !== null) return false;
      const store = focused.store;
      const read = (): readonly ConversationTurn[] => store.getState().conversation;
      const write = (next: readonly ConversationTurn[]): void => {
        store.getState().converse(next);
      };
      const subscription = newSubscription();
      const before = read();
      const turn: ConversationTurn = {
        role: 'user',
        text,
        ...(replyTo === undefined ? {} : { replyTo }),
        ...(asked === undefined ? {} : { sides: asked }),
        ...(documents === undefined ? {} : { documents }),
        ...(attachments === undefined ? {} : { attached: attachments.map((file) => file.name) }),
        request: {
          about,
          ...(alongside === undefined ? {} : { alongside }),
          ...(asked === undefined ? {} : { sides: asked }),
          ...(documents === undefined ? {} : { documents }),
          ...(attachments === undefined ? {} : { attachments }),
          web,
        },
        model: models.find((entry) => entry.id === model)?.label ?? model,
      };
      write([...before, turn]);
      setProblem(null);
      answer.current = '';
      live.current = { subscription, write, read, web };
      setStreaming(subscription);
      void client['ai.ask']({
        subscription,
        provider,
        model,
        messages: [...before, turn].map((each) => ({ role: each.role, text: each.text })),
        ...(about === undefined ? {} : { about }),
        ...(alongside === undefined ? {} : { alongside }),
        ...(attachments === undefined ? {} : { attachments: attachments.map((file) => file.handle) }),
        web,
      }).then((result) => {
        if (result.ok && result.value.started) {
          // THE DRAFT IS CLEARED ONLY ONCE THE ASK STARTED. A request that never began must
          // leave a person's words where they typed them.
          setDraft((current) => (current.trim() === text ? '' : current));
          // AND THE FILES THAT WENT WITH IT, by handle: a file attached while this ask was starting stays for the next.
          if (attachments !== undefined) {
            const went = new Set(attachments.map((file) => file.handle));
            setAttached((current) => ({ files: current.files.filter((file) => !went.has(file.handle)), dropped: 0 }));
          }
          // WHAT WENT is recorded on the turn that asked, so the line under it is main's answer
          // rather than the scope the panel meant.
          const now = read();
          const at = now.lastIndexOf(turn);
          const { sent, alongside: second, among, files, share } = result.value;
          if (at !== -1) {
            write(
              now.map((each, index) =>
                index === at
                  ? {
                      ...each,
                      sent,
                      ...(second === undefined ? {} : { alongside: second }),
                      ...(among === undefined ? {} : { among }),
                      ...(files === undefined ? {} : { files }),
                      ...(share === undefined ? {} : { share }),
                    }
                  : each,
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

  /** Replaces the conversation the panel shows, the focused document's. */
  const writeTurns = useCallback(
    (next: readonly ConversationTurn[]): void => {
      focused.store.getState().converse(next);
    },
    [focused],
  );

  /**
   * *Edit* on the last question: its words go back into the composer, and the next Send replaces
   * that question and its answer rather than adding a turn after them. `null` when not editing.
   */
  // AN EDIT BELONGS TO ONE DOCUMENT'S CONVERSATION: held with that document's id, and read as no
  // edit anywhere else — so a tab switch cannot point its index into another document's turns.
  const [editingIn, setEditingIn] = useState<{ readonly docId: DocId; readonly at: number } | null>(null);
  const editing = editingIn !== null && editingIn.docId === focused.docId ? editingIn.at : null;
  const setEditing = useCallback(
    (at: number | null): void => {
      setEditingIn(at === null ? null : { docId: focused.docId, at });
    },
    [focused.docId],
  );

  /**
   * The paperclip: `main` runs the picker and answers handles. Files already attached stay; past eight, the rest are
   * counted and said rather than kept, `main`'s rule applied to the whole row.
   */
  const attach = useCallback(() => {
    void client['ai.attach']({}).then((result) => {
      if (!result.ok) return;
      setAttached((current) => {
        const together = [...current.files, ...result.value.files];
        const kept = together.slice(0, MAX_ASK_ATTACHMENTS);
        return { files: kept, dropped: result.value.dropped + together.length - kept.length };
      });
    });
  }, [client]);

  const send = useCallback(() => {
    const asked = newRequest(scope);
    if (asked === null) return;
    const wanted = attached.files.length === 0 ? asked : { ...asked, attachments: attached.files };
    // EDIT AND RESEND: the edited question and everything after it go before the new one is asked.
    // Only when the ask can begin, so a Send that cannot start leaves the conversation as it was.
    if (editing !== null && live.current === null && model !== '' && draft.trim() !== '') {
      writeTurns(turns.slice(0, editing));
      setEditing(null);
    }
    ask(draft.trim(), wanted);
  }, [ask, attached.files, draft, editing, model, newRequest, scope, setEditing, turns, writeTurns]);

  /** *Regenerate* the last answer: the same question, about the same thing, asked again. */
  const regenerate = useCallback(() => {
    const at = turns.findLastIndex((turn) => turn.role === 'user');
    const question = turns[at];
    if (question === undefined || live.current !== null || model === '') return;
    writeTurns(turns.slice(0, at));
    if (!ask(question.text, question.request ?? { about: undefined }, question.replyTo)) writeTurns(turns);
  }, [ask, model, turns, writeTurns]);

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
    if (request.about.docId !== focused.docId) return;
    if (request.prompt === undefined || ask(i18n._(request.prompt), { about: request.about }, request.replyTo)) {
      onHandled(request.serial);
    }
  }, [ask, focused.docId, handled, i18n, onHandled, request, streaming]);

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
            documents: () => i18n._(ASSISTANT_SCOPE_ALL),
          }[about.scope]();
    const side = question?.request?.sides?.asked;
    const which = side === undefined ? '' : ` · ${i18n._(SIDE_WORDS[side])}`;
    return i18n._(ASSISTANT_CAPTION, { model: question?.model ?? '', scope: `${scope}${which}` });
  };

  /**
   * The lines under an asked turn: what its context sent, then one line per attached file (ADR-0135) — what went, that
   * it went as a picture, or why nothing did — each read from the turn's own record.
   */
  const sentLines = (turn: ConversationTurn): readonly string[] => {
    const names = turn.attached ?? [];
    const files = (turn.files ?? []).map((each, at) => {
      const name = names[at] ?? '';
      if ('sent' in each) return i18n._(ASSISTANT_SENT_DOCUMENT, { name, sent: sentLine(each.sent) });
      if ('pictured' in each) return i18n._(ASSISTANT_SENT_FILE_PICTURE, { name });
      return i18n._(ASSISTANT_SENT_UNREAD, { name, reason: i18n._(FILE_UNREAD_WORDS[each.unread]) });
    });
    // THE SHARE, said once, whenever main divided the bound and no document list already says it.
    const share =
      turn.share === undefined || turn.documents !== undefined
        ? []
        : [i18n._(ASSISTANT_SENT_SHARE_EACH, { characters: number.format(turn.share) })];
    return [...share, ...contextLines(turn), ...files];
  };

  /** What an asked turn's context sent: one line, one per side for a turn asked of both, or one per open document. */
  const contextLines = (turn: ConversationTurn): readonly string[] => {
    // EVERY OPEN DOCUMENT (ADR-0134): the share each had, then one line per document — what went, or why nothing did —
    // then the tabs past the bound, named. Read from the turn's own record, never from the tabs open now.
    if (turn.documents !== undefined && turn.among !== undefined) {
      const named = new Map(turn.documents.asked.map((each) => [each.docId, each.name]));
      return [
        i18n._(ASSISTANT_SENT_SHARE, {
          count: turn.documents.asked.length,
          // MAIN'S NUMBER where it answered one — with files beside the documents it is smaller than the documents'
          // count alone gives — and the same rule's answer otherwise.
          characters: number.format(turn.share ?? askShareOf(turn.documents.asked.length)),
        }),
        ...turn.among.map((each) =>
          'sent' in each
            ? i18n._(ASSISTANT_SENT_DOCUMENT, { name: named.get(each.docId) ?? '', sent: sentLine(each.sent) })
            : i18n._(ASSISTANT_SENT_UNREAD, { name: named.get(each.docId) ?? '', reason: i18n._(UNREAD_WORDS[each.unread]) }),
        ),
        ...(turn.documents.notSent.length === 0
          ? []
          : [i18n._(ASSISTANT_SENT_NOT_SENT, { limit: MAX_ASK_DOCUMENTS, names: turn.documents.notSent.join(', ') })]),
      ];
    }
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
    (asked: ConversationTurn['sides'], documents?: ConversationTurn['documents']) =>
    (text: string, key: string): ReactElement => (
      <Fragment key={key}>
        {citationsIn(text).map((piece, at) => {
          if (!('cited' in piece)) return <span key={at}>{piece.text}</span>;
          // A DOCUMENT BY ITS PLACE (ADR-0134): resolved against what the turn asked about, and a link only while that
          // document is still open — a citation of a document closed since is text, never a jump to the wrong file.
          if (piece.document !== undefined) {
            const cited = documents?.asked[piece.document];
            const open = cited !== undefined && openDocuments.some((each) => each.docId === cited.docId);
            if (cited === undefined || !open || onGoToDocument === undefined) return <span key={at}>{piece.label}</span>;
            return (
              <button
                aria-label={i18n._(ASSISTANT_CITATION_DOCUMENT, { page: pdfjsPageOf(piece.cited), name: cited.name })}
                className="m-assistant__citation"
                data-assistant-citation={piece.cited}
                data-assistant-citation-document={cited.docId}
                key={at}
                onClick={() => {
                  onGoToDocument(cited.docId, piece.cited);
                }}
                type="button"
              >
                {piece.label}
              </button>
            );
          }
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

  return (
    <div className="m-assistant">
      {turns.length > 0 && (
        <div className="m-assistant__conversation-bar">
          {/* NEW CHAT, a "+" at the top right (the owner's review of 0.1.6.0): it empties this document's
              conversation — and, with history on, its saved copy the next time it settles. Not while an answer is
              arriving: that answer has nowhere to go. Its name is still *New chat*, which is what a reader hears. */}
          <IconButton
            disabled={streaming !== null}
            icon={Plus}
            label={ASSISTANT_NEW_CHAT}
            onClick={() => {
              writeTurns([]);
              setEditing(null);
              setProblem(null);
              // A NEW CHAT STARTS *DOCUMENT ONLY* (ADR-0108), whatever the last one used.
              setWebChosen(null);
            }}
            size="dense"
          />
        </div>
      )}
      {readiness !== 'ready' && (
        <p className="m-assistant__state" data-assistant-readiness={readiness}>
          {i18n._(READINESS[readiness])}
        </p>
      )}
      {problem !== null && <p className="m-assistant__problem">{i18n._(PROBLEMS[problem])}</p>}

      <ol aria-label={i18n._(ASSISTANT_CONVERSATION_LABEL)} className="m-assistant__turns">
        {turns.map((turn, at) => (
          <Turn role={turn.role} key={`${String(at)}-${turn.role}`}>
            {/* WHO SAID IT, read and not drawn: the bubble's side says so to the eye (`app.css`). */}
            <span className="m-visually-hidden">
              {i18n._(turn.role === 'user' ? ASSISTANT_YOU : ASSISTANT_ASSISTANT)}
            </span>
            {turn.role === 'assistant' ? (
              // RENDERED MARKDOWN, the owner's specification: headings, lists, tables, code —
              // built as elements from the tokens, so no HTML from the answer reaches the page.
              <div className="m-assistant__text m-assistant__answer">
                {answerElements(turn.text, answerTextFor(turns[at - 1]?.sides, turns[at - 1]?.documents))}
              </div>
            ) : (
              <p className="m-assistant__text">{turn.text}</p>
            )}
            {sentLines(turn).map((line) => (
              <p className="m-assistant__sent" data-assistant-sent="" key={line}>
                {line}
              </p>
            ))}
            {turn.role === 'assistant' && (streaming === null || at !== turns.length - 1) && (
              <AnswerGrounding
                answer={turn}
                question={turns[at - 1]}
                open={(answer, index) => {
                  void client['ai.openSource']({ answer, index });
                }}
              />
            )}
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
                    // THROUGH MAIN: the renderer holds no clipboard permission (§2). *Copied* is every copy's one
                    // confirmation (`confirmCopied`), shown only when main says the text went, never as a hope.
                    void client['window.copyText']({ text: turn.text.slice(0, MAX_CHAT_TEXT) }).then((answer) => {
                      if (answer.ok && answer.value.copied) confirmCopied({ toast });
                    });
                  }}
                  size="dense"
                />
                {onNote !== undefined && (
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
                    focused.store
                      .getState()
                      .converse(turns.map((each, index) => (index === at ? { ...each, posted: true } : each)));
                  }}
                />
              );
            })()}
          </Turn>
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
      {/* THE FOOT: the word *Choose*, then the Context and Sources menus, ON ONE ROW across the pane over the message
          box (the owner's review of 0.1.9.0: each face reads its name, and the value is in the name and the open menu);
          then the box with the paperclip at its bottom-left and the send arrow at its bottom-right; then the provider
          and model under it. The word names the group, so a screen reader hears *Choose* once on entering it and each
          menu by its own name. */}
      <div className="m-assistant__about" data-assistant-about="">
        <div aria-labelledby={chooseId} className="m-assistant__choices" role="group">
          <span className="m-assistant__choose" id={chooseId}>
            {i18n._(ASSISTANT_CHOOSE)}
          </span>
          <ChoiceMenu<Scope>
            label={ASSISTANT_ABOUT_LABEL}
            onChange={choose}
            options={[
              ...(selection === null
                ? []
                : [
                    {
                      value: selection.scope,
                      label: selection.scope === 'comment' ? ASSISTANT_CHIP_COMMENT : ASSISTANT_CHIP_SELECTION,
                    },
                  ]),
              {
                value: 'page' as const,
                label: ASSISTANT_CHIP_PAGE,
                // THE PAGE THAT WILL GO: the right pane's when the conversation asks the right.
                values: { page: pdfjsPageOf(beside !== undefined && sides === 'right' ? beside.page : focused.page) },
              },
              { value: 'document' as const, label: ASSISTANT_CHIP_DOCUMENT },
              // EVERY OPEN DOCUMENT (ADR-0134), offered only when there is more than one to ask about.
              ...(openDocuments.length < 2 ? [] : [{ value: 'all' as const, label: ASSISTANT_CHIP_ALL }]),
              { value: 'comments' as const, label: ASSISTANT_CHIP_COMMENTS },
              // DISABLED, NOT DROPPED, for a model that says it cannot see (ADR-0081's rule).
              { value: 'page-image' as const, label: ASSISTANT_CHIP_PICTURE, disabled: !canSee },
              { value: 'nothing' as const, label: ASSISTANT_CHIP_NOTHING },
            ]}
            value={scope}
          />
          {/* DOCUMENT ONLY OR DOCUMENT + WEB (ADR-0108): each choice disabled, never dropped, where this provider
              and model cannot take it — with the sentence that says why beneath. */}
          <span className="m-assistant__choice" data-assistant-web="">
            <ChoiceMenu<'document' | 'web'>
              label={ASSISTANT_WEB_LABEL}
              onChange={(next) => {
                setWebChosen(next === 'web' ? { docId: focused.docId } : null);
              }}
              options={[
                { value: 'document', label: ASSISTANT_WEB_DOCUMENT, disabled: webSupport.kind === 'always' },
                { value: 'web', label: ASSISTANT_WEB_ON, disabled: webSupport.kind === 'none' },
              ]}
              value={webAsked ? 'web' : 'document'}
            />
          </span>
        </div>
        {webSupport.kind === 'none' && (
          <p className="m-assistant__state" data-assistant-web-absent={webSupport.reason}>
            {i18n._(WEB_ABSENT[webSupport.reason])}
          </p>
        )}
        {searchesAnyway && (
          <p className="m-assistant__state" data-assistant-web-always="">
            {i18n._(ASSISTANT_WEB_ALWAYS)}
          </p>
        )}
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
      </div>

      {/* NOT UNDER A TOAST: the strip sits at the window's bottom-right, where this ends (`ToastStrip`). */}
      <div className="m-assistant__composer" data-toast-avoid="">
        {/* THE FILES FOR THE NEXT QUESTION (ADR-0135), each a chip with its name, its size and a way to take it off.
            A name is all the renderer knows of a file; what is in it is read by main, contained, when it is asked. */}
        {attached.files.length === 0 ? null : (
          <ul aria-label={i18n._(ASSISTANT_ATTACHED_LIST)} className="m-assistant__chips" data-assistant-attached="">
            {attached.files.map((file) => (
              <li className="m-assistant__chip" key={file.handle}>
                <Paperclip aria-hidden className="m-assistant__chip-icon" />
                <span className="m-assistant__chip-name">{file.name}</span>
                <span className="m-assistant__chip-size">
                  {file.bytes < 1024 * 1024
                    ? i18n._(ASSISTANT_SIZE_KB, { size: number.format(Math.max(1, Math.round(file.bytes / 1024))) })
                    : i18n._(ASSISTANT_SIZE_MB, { size: number.format(Math.round(file.bytes / 104_857.6) / 10) })}
                </span>
                <IconButton
                  icon={X}
                  label={ASSISTANT_ATTACHED_REMOVE}
                  onClick={() => {
                    setAttached((current) => ({ files: current.files.filter((each) => each.handle !== file.handle), dropped: 0 }));
                  }}
                  size="dense"
                  values={{ name: file.name }}
                />
              </li>
            ))}
          </ul>
        )}
        {attached.dropped === 0 ? null : (
          <p className="m-assistant__state" data-assistant-attached-dropped="">
            {i18n._(ASSISTANT_ATTACHED_DROPPED, { count: attached.dropped, limit: MAX_ASK_ATTACHMENTS })}
          </p>
        )}
        <textarea
          ref={composer}
          aria-describedby={hintId}
          aria-label={i18n._(ASSISTANT_COMPOSER_LABEL)}
          className="m-assistant__draft"
          data-assistant-draft=""
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          // ONE FIXED LINE (the owner's decision, 2026-10-01): until then four suggestions took turns here, which was
          // content that moved by itself (WCAG 2.2.2) and needed a timer, a focus state and a reduced-motion test.
          placeholder={i18n._(ASSISTANT_PLACEHOLDER)}
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
        <div className="m-assistant__composer-foot">
          {/* THE PAPERCLIP (ADR-0135), first in the foot: any file, several at once, through main's picker. Disabled at
              eight, the most one question carries, so it is never a control that picks and keeps nothing. */}
          <IconButton
            disabled={attached.files.length >= MAX_ASK_ATTACHMENTS}
            icon={Paperclip}
            label={ASSISTANT_ATTACH}
            onClick={attach}
            size="control"
          />
          {/* THE SEND ARROW at the bottom-right, which becomes Stop while an answer arrives (v5-03). NOT A DEAD
              CONTROL (§10.5): with no key, or no model to ask, Send is disabled and the lines above say which. */}
          {streaming === null ? (
            <IconButton
              disabled={!hasKey || model === '' || waitingForSides || blindForPicture || searchesAnyway}
              icon={ArrowUp}
              label={ASSISTANT_SEND}
              onClick={send}
              size="control"
              variant="primary"
            />
          ) : (
            <IconButton icon={Square} label={ASSISTANT_STOP} onClick={stop} size="control" />
          )}
        </div>
      </div>
      {/* THE PROVIDER AND MODEL, on their own row UNDER the box (the owner's review of 0.1.9.0; inside it they pushed
          Send out of a narrow pane), each a labelled select taking half the row. EVERY PROVIDER IS LISTED, with or
          without a key: a person choosing where to put a key must be able to see the choice, and the no-key line above
          says what the chosen one needs. */}
      <div className="m-assistant__models" data-assistant-models="">
        <label className="m-assistant__picker" htmlFor={providerId}>
          <span className="m-visually-hidden">{i18n._(ASSISTANT_PROVIDER_LABEL)}</span>
          <select
            data-assistant-provider=""
            id={providerId}
            onChange={(event) => {
              setProvider(event.target.value as AiProviderId);
            }}
            value={provider}
          >
            {AI_PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {i18n._(AI_PROVIDER_NAMES[id])}
              </option>
            ))}
          </select>
        </label>
        <label className="m-assistant__picker" htmlFor={modelId}>
          <span className="m-visually-hidden">{i18n._(ASSISTANT_MODEL_LABEL)}</span>
          <select
            data-assistant-model=""
            disabled={models.length === 0}
            id={modelId}
            onChange={(event) => {
              setModel(event.target.value);
            }}
            value={model}
          >
            {/* A STORED CHOICE THE LIST NO LONGER NAMES stays shown and selected, marked, never silently swapped for
                another model (ADR-0117 Decision 3). */}
            {/* NOTHING TO LIST SAYS SO, as the Settings row does, rather than drawing an empty box. */}
            {models.length === 0 ? <option value="">{i18n._(AI_MODELS_NONE)}</option> : null}
            {stored !== undefined && models.length > 0 && chosenEntry === undefined ? (
              <option value={stored}>{i18n._(ASSISTANT_MODEL_NOT_OFFERED, { name: stored })}</option>
            ) : null}
            {/* DISABLED, NEVER DROPPED (ADR-0081, ADR-0117 Decision 4): where this choice reads images — Anthropic's,
                which the recogniser uses — a model that says it has no vision is listed and cannot be chosen. */}
            {models.map((entry) => {
              const blind = readsImages && !servesVision(entry);
              return (
                <option disabled={blind} key={entry.id} value={entry.id}>
                  {blind ? i18n._(ASSISTANT_MODEL_NO_VISION, { name: entry.label }) : entry.label}
                </option>
              );
            })}
          </select>
        </label>
      </div>
      {/* HOW THE BOX SENDS, for a screen reader through the box's description and drawn for nobody: the owner's
          review of 0.1.6.0 took every explanatory line out of the pane, and Enter sending is the platform's way. */}
      <span className="m-visually-hidden" id={hintId}>
        {i18n._(ASSISTANT_ASK)}
      </span>
    </div>
  );
}
