import type { AskAboutOne } from '@monstera/contract';
import type { DocVersion, MessageKey } from '@monstera/shared';

/**
 * What a command asks the assistant panel to do: point it at something, and perhaps ask
 * ([ADR-0088](../../../docs/DECISIONS/0088-an-ask-about-a-document-carries-a-bounded-window-read-in-main.md)).
 *
 * The right-click *Ask AI · Explain · Summarise · Translate* and *Draft a reply* are commands,
 * and the conversation is the panel's own (ADR-0083 Decision 3). This is the one shape that
 * crosses between them, so a command never reaches into the panel's state.
 *
 * `serial` is what makes a second identical request a new one: *Explain* twice on the same
 * words is two asks, and a value compared by content would be one.
 */
export type AssistantRequest = {
  readonly serial: number;
  /** ONE document: a command points the panel at what it was invoked on, never at every open document (ADR-0134). */
  readonly about: AskAboutOne;
  /** The note an answer may be posted to as a reply — *Draft a reply* only. */
  readonly replyTo?: ReplyTarget;
} & (
  | {
      /**
       * Asked at once when present, as a key the panel resolves — the question a person reads in
       * their own conversation is in their language. Absent, the panel is pointed and waits.
       */
      readonly prompt?: MessageKey;
      readonly quote?: never;
    }
  | {
      /**
       * Words the panel QUOTES in the message box, followed by a space and the cursor, so the person types their
       * question after them (*Ask AI* on a selection, the owner's design of 2 October). Nothing is sent. Never beside a
       * prompt: one request either asks or drafts, and the type cannot carry both.
       */
      readonly quote: string;
      readonly prompt?: never;
    }
);

/** A note, by the walk identity `replyToAnnotation` names it with (ADR-0041). */
export interface ReplyTarget {
  readonly page: number;
  readonly index: number;
  readonly version: DocVersion;
}

/** What follows the pointing: a question asked at once, or words quoted in the box for the person to finish. */
export type AssistantNext = MessageKey | { readonly quote: string };

/** How a command asks — `App`'s one entry point, which also reveals the panel. */
export type AskAssistant = (about: AskAboutOne, next?: AssistantNext, replyTo?: ReplyTarget) => void;
