import {
  AI_PROVIDERS,
  AZURE_OPENAI_ENDPOINT_SETTING_ID,
  type AiProviderId,
  type EventId,
  type EventPayload,
  MAX_EVENT_TEXT,
  checkEvent,
} from '@monstera/contract';
import { type ChatImage, type ChatMessage, type ChatRefusal, listModels, streamChat } from '@monstera/kernel';

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
}

export interface Assistant {
  readonly models: (provider: AiProviderId) => Promise<Awaited<ReturnType<typeof listModels>>>;
  /** `started: false` means the subscription is already streaming. */
  readonly ask: (request: AskRequest) => { readonly started: boolean };
  /** `stopped: false` means nothing was streaming to that subscription. */
  readonly stop: (subscription: string) => { readonly stopped: boolean };
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

  const finish = (subscription: string, stopped: boolean, refusal?: ChatRefusal): void => {
    live.delete(subscription);
    parts.send(
      'ai.done',
      checkEvent('ai.done', { subscription, stopped, ...(refusal === undefined ? {} : { refusal }) }),
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

    ask: ({ subscription, provider, model, messages, system, image }) => {
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
          finish(subscription, answer.stopped, answer.refusal);
        },
        () => {
          // `streamChat` does not throw; this is the belt for a defect in it, and it must
          // still end the conversation's turn rather than leaving a spinner running.
          finish(subscription, false, 'unreadable');
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
  };
}
