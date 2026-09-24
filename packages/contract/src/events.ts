import { z } from 'zod';

/**
 * What `main` may PUSH to the renderer
 * ([ADR-0082](../../../docs/DECISIONS/0082-main-may-push-on-declared-event-channels.md)).
 *
 * §5's second direction, declared exactly as a channel is: an id and a zod schema per
 * payload, bounded, validated where it is sent and again where it arrives. `main` cannot
 * send an event this registry does not declare, and the renderer acts on none it did not
 * subscribe to.
 *
 * ## Addressed to a subscription the renderer opened
 *
 * Every payload carries the `subscription` the renderer minted and passed on the `invoke`
 * that started the work. An arriving event whose id nothing is listening for is dropped —
 * so a late piece of an answer a person already stopped cannot type itself into a new
 * conversation.
 *
 * ## Stopping is an `invoke`, never an unsubscribe
 *
 * Unsubscribing stops the renderer listening and leaves `main` asking the provider. The
 * Stop button calls a channel; this direction carries answers, not intentions.
 */

/** A subscription id: the renderer mints one per streamed answer. */
export const subscriptionIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/u);

/**
 * How much text one delta may carry.
 *
 * **8 KiB, and the reason is the frame rather than the language**: a delta is a piece of a
 * sentence, and a provider that sent a megabyte in one event would be answering something
 * this build did not ask for. The renderer assembles the answer; `main` holds none of it.
 */
export const MAX_EVENT_TEXT = 8192;

/**
 * Why a provider gave no answer, or no more of one — ONE list, for a streamed answer's end and for
 * a translation's (ADR-0097), because both are the kernel's `ChatRefusal` crossing the wire.
 *
 * `out-of-credit` is Anthropic's account refusal, told apart from `rejected` because it is the one
 * the person fixes by paying (anthropicCredit.ts).
 */
export const AI_ANSWER_REFUSALS = ['no-key', 'unauthorised', 'out-of-credit', 'rejected', 'unreachable', 'unreadable'] as const;

export const EVENTS = {
  /**
   * A piece of an assistant answer, as it arrives. Many per answer, in order.
   */
  'ai.delta': z
    .object({ subscription: subscriptionIdSchema, text: z.string().min(1).max(MAX_EVENT_TEXT) })
    .strict(),

  /**
   * The end of one answer, however it ended.
   *
   * **`stopped` is not a failure** and carries no refusal: a person pressing Stop has the
   * text they have. A `refusal` names why a provider gave nothing more, and the renderer
   * keeps what already arrived either way.
   */
  'ai.done': z
    .object({
      subscription: subscriptionIdSchema,
      stopped: z.boolean(),
      refusal: z.enum(AI_ANSWER_REFUSALS).optional(),
    })
    .strict(),

  /**
   * The platform asked the window to close, and main is holding it until the renderer has asked
   * about every document with unsaved changes. The answer is `window.close`, or nothing — a
   * Cancel leaves the window open. Empty: the renderer knows which documents it holds.
   */
  'window.close-requested': z.object({}).strict(),
} as const;

export type EventMap = typeof EVENTS;
export type EventId = keyof EventMap;
export type EventPayload<K extends EventId> = z.infer<EventMap[K]>;

/** Every declared event id — for a surface that must cover them all. */
export const EVENT_IDS = Object.keys(EVENTS) as readonly EventId[];

/**
 * Validates one event where it is SENT, so `main` cannot push a shape the renderer would
 * have to refuse.
 *
 * @throws when the payload is not the declared shape — a defect in `main`, never a
 *   person's situation, so it is loud here rather than silent on the wire.
 */
export function checkEvent<K extends EventId>(id: K, payload: EventPayload<K>): EventPayload<K> {
  const parsed = EVENTS[id].safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Refusing to send a malformed "${id}" event: ${parsed.error.message}`, { cause: parsed.error });
  }
  return parsed.data as EventPayload<K>;
}

/** What a subscriber is handed, after the payload has been validated on arrival. */
export type EventHandler<K extends EventId> = (payload: EventPayload<K>) => void;

/**
 * Subscribes to one event through the bridge, validating each payload on arrival.
 *
 * **A malformed event is dropped, not thrown**: it arrives on a callback with no caller to
 * answer, and a renderer that threw there would take down whatever happened to be running.
 * It is reported through `onMalformed` so a surface can say the connection misbehaved.
 *
 * @returns the unsubscribe function the bridge answered.
 */
export function subscribeToEvent<K extends EventId>(
  subscribe: (channel: string, handler: (payload: unknown) => void) => () => void,
  id: K,
  handler: EventHandler<K>,
  onMalformed?: (id: K, error: unknown) => void,
): () => void {
  return subscribe(id, (raw) => {
    const parsed = EVENTS[id].safeParse(raw);
    if (!parsed.success) {
      onMalformed?.(id, parsed.error);
      return;
    }
    handler(parsed.data as EventPayload<K>);
  });
}
