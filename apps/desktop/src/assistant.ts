import {
  AI_PROVIDERS,
  AZURE_OPENAI_ENDPOINT_SETTING_ID,
  type AiProviderId,
  type EventId,
  type EventPayload,
  MAX_EVENT_TEXT,
  checkEvent,
} from '@monstera/contract';
import {
  type ChatAnswer,
  type ChatImage,
  type ChatMessage,
  type ChatRefusal,
  listModels,
  streamChat,
  type WebSource,
} from '@monstera/kernel';
import { randomUUID } from 'node:crypto';

/**
 * The assistant, in `main`
 * ([ADR-0081](../../../docs/DECISIONS/0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md),
 * [ADR-0082](../../../docs/DECISIONS/0082-main-may-push-on-declared-event-channels.md)).
 *
 * Keys never leave this process and the renderer has no network, so `main` makes the
 * request and pushes the answer as it arrives.
 *
 * ## One live answer per subscription
 *
 * A second ask on a subscription that is streaming is **refused**, not interleaved: two
 * answers typing into one conversation is not a state a person can read, and dropping the
 * first silently would lose text somebody was in the middle of.
 *
 * ## A delta is split to the event's bound, never truncated
 *
 * A provider may hand over more than `MAX_EVENT_TEXT` at once. Cutting it would lose a
 * person's answer; the pieces are sent in order instead, which is what the event channel
 * is for.
 *
 * ## Stop reaches the provider
 *
 * `stop` aborts the request rather than merely closing the stream, so a person who presses
 * it stops paying for the rest of the answer (ADR-0082 Decision 4).
 */

/** What the assistant needs from the shell, named with no Electron in it. */
export interface AssistantParts {
  /** The stored secrets, by setting id — `main`'s own copy, never the renderer's. */
  readonly secret: (id: string) => string | undefined;
  /** A non-secret setting's value, for Azure OpenAI's resource address. */
  readonly setting: (id: string) => string | undefined;
  /** Pushes one declared event to the renderer. */
  readonly send: <K extends EventId>(id: K, payload: EventPayload<K>) => void;
  /** Injected so a case drives the provider. The application passes the real one. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Opens an HTTPS address in the person's browser — the composition root's one route, which refuses anything else.
   * Only ever handed an address a provider's search returned and `main` kept (ADR-0108).
   */
  readonly openInBrowser: (url: string) => Promise<void>;
  /** Mints an answer's id. Injected so a case names it; the application passes `randomUUID`. */
  readonly answerId?: () => string;
}

export interface AskRequest {
  readonly subscription: string;
  readonly provider: AiProviderId;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  /** The document window's instruction, built by the handler that read it (ADR-0088). */
  readonly system?: string;
  /** A picture of a page, sent with the last turn (ADR-0090). */
  readonly image?: ChatImage;
  /** *Document + web* or *Document only* — the person's switch, required for `ai.ask`'s reason (ADR-0108). */
  readonly web: boolean;
}

/**
 * How many finished answers keep their sources' addresses for `ai.openSource`. Older ones answer `opened: false`,
 * which a conversation reaching back that far meets — bounded so a long session does not hold every address it saw.
 */
export const KEPT_ANSWERS = 50;

export interface Assistant {
  readonly models: (provider: AiProviderId) => Promise<Awaited<ReturnType<typeof listModels>>>;
  /** The model list asked with a CANDIDATE key and address, never the stored ones — `ai.checkKey`'s check. */
  readonly check: (provider: AiProviderId, key: string, endpoint: string) => Promise<Awaited<ReturnType<typeof listModels>>>;
  /** `started: false` means the subscription is already streaming. */
  readonly ask: (request: AskRequest) => { readonly started: boolean };
  /** `stopped: false` means nothing was streaming to that subscription. */
  readonly stop: (subscription: string) => { readonly stopped: boolean };
  /**
   * Opens source `index` of answer `answer` — by place, from the addresses `main` kept (ADR-0108). `opened: false`
   * for an answer no longer kept or a place past its list.
   */
  readonly openSource: (answer: string, index: number) => Promise<{ readonly opened: boolean }>;
  /**
   * One whole answer, gathered rather than streamed — a translation's (ADR-0097), which is read
   * as one array and written, so no piece of it is shown as it arrives. The same `streamChat`
   * every ask goes through: one resolver of how each provider is asked (B3a). Never with the web: a translation is
   * of the page's own words.
   */
  readonly complete: (request: Omit<AskRequest, 'subscription' | 'image' | 'web'>) => Promise<ChatAnswer>;
}

/** The pieces one delta becomes, each within the event's bound. */
export function splitDelta(text: string, bound = MAX_EVENT_TEXT): readonly string[] {
  if (text.length <= bound) return [text];
  const pieces: string[] = [];
  for (let at = 0; at < text.length; at += bound) pieces.push(text.slice(at, at + bound));
  return pieces;
}

export function createAssistant(parts: AssistantParts): Assistant {
  /** Every answer this process is streaming, by the subscription it streams to. */
  const live = new Map<string, AbortController>();

  const keyFor = (provider: AiProviderId): string => parts.secret(AI_PROVIDERS[provider].keySetting) ?? '';
  const endpointFor = (provider: AiProviderId): string =>
    provider === 'azure-openai' ? (parts.setting(AZURE_OPENAI_ENDPOINT_SETTING_ID) ?? '') : '';

  /** Each kept answer's source addresses, oldest first — `ai.openSource`'s only source of an address. */
  const kept = new Map<string, readonly WebSource[]>();
  const mint = parts.answerId ?? randomUUID;

  const finish = (
    subscription: string,
    stopped: boolean,
    refusal: ChatRefusal | undefined,
    web: Pick<ChatAnswer, 'searched' | 'sources'>,
  ): void => {
    live.delete(subscription);
    const answer = mint();
    kept.set(answer, web.sources);
    // THE OLDEST GOES FIRST: a Map iterates in insertion order.
    for (const old of kept.keys()) {
      if (kept.size <= KEPT_ANSWERS) break;
      kept.delete(old);
    }
    parts.send(
      'ai.done',
      checkEvent('ai.done', {
        subscription,
        stopped,
        ...(refusal === undefined ? {} : { refusal }),
        web: {
          answer,
          searched: web.searched,
          // A TITLE AND A HOST, never the address (ADR-0108). `streamChat` kept HTTPS sources only, so each parses.
          sources: web.sources.map((source) => ({ title: source.title.slice(0, 300), host: new URL(source.url).host })),
        },
      }),
    );
  };

  return {
    models: (provider) =>
      listModels({
        provider,
        key: keyFor(provider),
        endpoint: endpointFor(provider),
        ...(parts.fetchImpl === undefined ? {} : { fetchImpl: parts.fetchImpl }),
      }),

    check: (provider, key, endpoint) =>
      listModels({
        provider,
        key,
        endpoint,
        ...(parts.fetchImpl === undefined ? {} : { fetchImpl: parts.fetchImpl }),
      }),

    ask: ({ subscription, provider, model, messages, system, image, web }) => {
      if (live.has(subscription)) return { started: false };
      const controller = new AbortController();
      live.set(subscription, controller);

      // NOT AWAITED, and that is the channel's shape: `ai.ask` answers that the request
      // started, and the answer itself arrives on the events.
      void streamChat({
        provider,
        model,
        key: keyFor(provider),
        endpoint: endpointFor(provider),
        messages,
        ...(system === undefined ? {} : { system }),
        ...(image === undefined ? {} : { image }),
        web,
        signal: controller.signal,
        onDelta: (text) => {
          // A SUBSCRIPTION THAT WAS STOPPED GETS NOTHING MORE. The abort reaches the
          // provider, and a delta already in flight must not arrive after `ai.done`.
          if (!live.has(subscription)) return;
          for (const piece of splitDelta(text)) {
            parts.send('ai.delta', checkEvent('ai.delta', { subscription, text: piece }));
          }
        },
        ...(parts.fetchImpl === undefined ? {} : { fetchImpl: parts.fetchImpl }),
      }).then(
        (answer) => {
          finish(subscription, answer.stopped, answer.refusal, answer);
        },
        () => {
          // `streamChat` does not throw; this is the belt for a defect in it, and it must
          // still end the conversation's turn rather than leaving a spinner running.
          finish(subscription, false, 'unreadable', { searched: false, sources: [] });
        },
      );

      return { started: true };
    },

    stop: (subscription) => {
      const controller = live.get(subscription);
      if (controller === undefined) return { stopped: false };
      controller.abort();
      return { stopped: true };
    },

    openSource: async (answer, index) => {
      const source = kept.get(answer)?.[index];
      if (source === undefined) return { opened: false };
      await parts.openInBrowser(source.url);
      return { opened: true };
    },

    complete: ({ provider, model, messages, system }) =>
      streamChat({
        provider,
        model,
        key: keyFor(provider),
        endpoint: endpointFor(provider),
        messages,
        ...(system === undefined ? {} : { system }),
        web: false,
        ...(parts.fetchImpl === undefined ? {} : { fetchImpl: parts.fetchImpl }),
      }),
  };
}
