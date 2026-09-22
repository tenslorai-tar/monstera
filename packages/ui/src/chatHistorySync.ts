import { type ContractClient, MAX_CHAT_TEXT, MAX_CHAT_TURNS, MAX_MODEL_ID, type SavedTurn } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import type { ConversationTurn, DocumentStore } from './documentStores.js';

/**
 * Keeps one document's conversation in step with its saved copy
 * ([ADR-0093](../../../docs/DECISIONS/0093-chat-history-is-off-by-default-encrypted-in-main-and-keyed-by-the-file.md)).
 *
 * ## Loaded once, into an EMPTY conversation only
 *
 * A saved conversation arrives while a person may already have asked something; replacing what
 * they are reading with the older one would lose it. So the load lands only if the conversation is
 * still empty when it answers.
 *
 * ## Saved when an answer is WHOLE, not per delta
 *
 * A streamed answer changes the conversation dozens of times a second. The save waits until the
 * conversation has been still for {@link SETTLE_MS}, so one answer is one write — and a conversation
 * saved mid-answer would restore half of one.
 *
 * ## What is saved is what the contract allows, the NEWEST of it
 *
 * The last {@link MAX_CHAT_TURNS} turns, each within {@link MAX_CHAT_TEXT}; a reply target and a
 * *posted* mark belong to one session's document version and are not saved (ADR-0093 Decision 5).
 */

export const SETTLE_MS = 800;

/** The saved form of a conversation: newest turns, bounded, session-only fields dropped. */
export function savedTurns(turns: readonly ConversationTurn[]): SavedTurn[] {
  return turns.slice(-MAX_CHAT_TURNS).map((turn) => ({
    role: turn.role,
    text: turn.text.slice(0, MAX_CHAT_TEXT),
    ...(turn.sent === undefined || turn.sent === null ? {} : { sent: turn.sent }),
    ...(turn.model === undefined ? {} : { model: turn.model.slice(0, MAX_MODEL_ID) }),
  }));
}

/**
 * Starts keeping `store`'s conversation saved while `enabled`, and returns what stops it.
 *
 * @param enabled read at each save rather than captured, so turning the setting off stops the
 *   next save without restarting anything — and `main` refuses a save while it is off regardless.
 */
export function syncConversation(
  client: ContractClient,
  docId: DocId,
  store: DocumentStore,
  enabled: () => boolean,
  schedule: (run: () => void, ms: number) => () => void = (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => {
      clearTimeout(timer);
    };
  },
): () => void {
  let stopped = false;
  let cancelPending: (() => void) | undefined;
  // THE LOADED TURNS are not saved back: nothing changed, and the first save would otherwise be a
  // rewrite of what was just read.
  let loaded: readonly ConversationTurn[] | undefined;

  if (enabled()) {
    void client['ai.history.load']({ docId }).then((answer) => {
      if (stopped || !answer.ok || answer.value.turns.length === 0) return;
      if (store.getState().conversation.length > 0) return;
      const turns: ConversationTurn[] = answer.value.turns.map((turn) => ({
        role: turn.role,
        text: turn.text,
        ...(turn.sent === undefined ? {} : { sent: turn.sent }),
        ...(turn.model === undefined ? {} : { model: turn.model }),
      }));
      loaded = turns;
      store.getState().converse(turns);
    });
  }

  const save = (): void => {
    if (!enabled()) return;
    void client['ai.history.save']({ docId, turns: savedTurns(store.getState().conversation) });
  };

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.conversation === previous.conversation || state.conversation === loaded) return;
    cancelPending?.();
    cancelPending = schedule(() => {
      cancelPending = undefined;
      if (!stopped) save();
    }, SETTLE_MS);
  });

  // STOPPING FLUSHES: a save still settling when the document closes is made now, while `main`
  // still holds the document — otherwise the last answer before a close would be the one lost.
  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    if (cancelPending !== undefined) {
      cancelPending();
      cancelPending = undefined;
      save();
    }
  };
}
