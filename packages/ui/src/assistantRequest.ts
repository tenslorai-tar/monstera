import type { AskAbout } from '@monstera/contract';
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
export interface AssistantRequest {
  readonly serial: number;
  readonly about: AskAbout;
  /**
   * Asked at once when present, as a key the panel resolves — the question a person reads in
   * their own conversation is in their language. Absent, the panel is pointed and waits.
   */
  readonly prompt?: MessageKey;
  /** The note an answer may be posted to as a reply — *Draft a reply* only. */
  readonly replyTo?: ReplyTarget;
}

/** A note, by the walk identity `replyToAnnotation` names it with (ADR-0041). */
export interface ReplyTarget {
  readonly page: number;
  readonly index: number;
  readonly version: DocVersion;
}

/** How a command asks — `App`'s one entry point, which also reveals the panel. */
export type AskAssistant = (about: AskAbout, prompt?: MessageKey, replyTo?: ReplyTarget) => void;
