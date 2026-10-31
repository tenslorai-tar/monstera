import { type ContractClient, MAX_CHAT_TURNS, MAX_MODEL_ID, type SavedTurn } from '@monstera/contract';
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
 * ## A new conversation is saved as a NEW one
 *
 * A file keeps several conversations (ADR-0277 Decision 6). Each save names the saved conversation it continues, by the
 * key `main` gave it, so *New chat* (the store's `startConversation`, which moves its serial) begins one beside the old
 * rather than replacing it, and an emptied conversation never deletes one. A file already at its bound refuses a new
 * one, and that refusal is recorded on the store for the panel to say.
 *
 * ## What is saved is what the contract allows, the NEWEST of it
 *
 * The last {@link MAX_CHAT_TURNS} turns, each WHOLE: a saved turn is bounded at `MAX_ANSWER_TEXT`, the bound `main`
 * already holds every answer to, so nothing is cut on the way to the store (ADR-0277 Decision 4). A reply target and a
 * *posted* mark belong to one session's document version and are not saved (ADR-0093 Decision 5).
 */

export const SETTLE_MS = 800;

/** The saved form of a conversation: newest turns, bounded, session-only fields dropped. */
export function savedTurns(turns: readonly ConversationTurn[]): SavedTurn[] {
  return turns.slice(-MAX_CHAT_TURNS).map((turn) => ({
    role: turn.role,
    text: turn.text,
    ...(turn.sent === undefined || turn.sent === null ? {} : { sent: turn.sent }),
    ...(turn.model === undefined ? {} : { model: turn.model.slice(0, MAX_MODEL_ID) }),
    ...(turn.attached === undefined ? {} : { attached: [...turn.attached] }),
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
  // WHICH SAVED CONVERSATION each one is (ADR-0277 Decision 6): its key once `main` has one, BY THE SERIAL that names it
  // in the store. A new serial is a new conversation, saved as a new one, so the old one is kept, never replaced — and a
  // key answered after New chat still lands on the conversation it was asked for.
  const keys = new Map<number, string>();
  // A NEW CONVERSATION'S FIRST SAVE IS WAITED FOR: its key arrives with the answer, and a second save sent before it would
  // add the same conversation twice. The save waiting is that conversation's own latest state, never whichever one the
  // store holds by then. Every other save goes AT ONCE, in the same call, so the flush on close reaches `main` while it
  // still holds the document.
  const firstSaves = new Map<number, Promise<void>>();
  const waiting = new Map<number, readonly ConversationTurn[]>();

  if (enabled()) {
    const serial = store.getState().conversationSerial;
    void client['ai.history.load']({ docId }).then((answer) => {
      if (stopped || !answer.ok || answer.value.turns.length === 0) return;
      if (store.getState().conversation.length > 0 || store.getState().conversationSerial !== serial) return;
      const turns: ConversationTurn[] = answer.value.turns.map((turn) => ({
        role: turn.role,
        text: turn.text,
        ...(turn.sent === undefined ? {} : { sent: turn.sent }),
        ...(turn.model === undefined ? {} : { model: turn.model }),
        ...(turn.attached === undefined ? {} : { attached: turn.attached }),
      }));
      loaded = turns;
      if (answer.value.conversation !== null) keys.set(serial, answer.value.conversation);
      store.getState().converse(turns);
    });
  }

  /** Saves conversation `serial` as `turns`, under its key where it has one. */
  const saveNow = async (serial: number, turns: readonly ConversationTurn[]): Promise<void> => {
    if (!enabled()) return;
    const answer = await client['ai.history.save']({ docId, conversation: keys.get(serial) ?? null, turns: savedTurns(turns) });
    if (answer.ok && answer.value.conversation !== null) keys.set(serial, answer.value.conversation);
    // WHAT THE PANEL SAYS is about the conversation on show; an older one's answer changes nothing it says.
    if (store.getState().conversationSerial !== serial) return;
    if (answer.ok) {
      if (answer.value.saved) store.getState().historyRefusedAs(null);
    } else if (answer.error.code === 'file-full') {
      // SAID, NOT DROPPED: the file keeps its twenty and this conversation is not saved until one is removed.
      store.getState().historyRefusedAs('file-full');
    }
  };
  const save = (serial: number, turns: readonly ConversationTurn[]): void => {
    const first = firstSaves.get(serial);
    if (first !== undefined) {
      waiting.set(serial, turns);
      return;
    }
    const keyless = !keys.has(serial);
    const sent = saveNow(serial, turns);
    if (!keyless) return;
    firstSaves.set(
      serial,
      sent.finally(() => {
        firstSaves.delete(serial);
        const next = waiting.get(serial);
        if (next !== undefined) {
          waiting.delete(serial);
          save(serial, next);
        }
      }),
    );
  };

  /** The save settling, made now: for a close, and for a conversation New chat is leaving. */
  let settling: (() => void) | undefined;
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.conversation === previous.conversation || state.conversation === loaded) return;
    // A NEW CONVERSATION BEGUN while the old one's last change was still settling: that change is saved now, as the old
    // one's, rather than cancelled by the new one's first change — which lost an answer that landed just before New chat.
    if (state.conversationSerial !== previous.conversationSerial) settling?.();
    cancelPending?.();
    const serial = state.conversationSerial;
    const turns = state.conversation;
    settling = () => {
      cancelPending?.();
      cancelPending = undefined;
      settling = undefined;
      save(serial, turns);
    };
    cancelPending = schedule(() => {
      cancelPending = undefined;
      settling = undefined;
      if (!stopped) save(serial, turns);
    }, SETTLE_MS);
  });

  // STOPPING FLUSHES: a save still settling when the document closes is made now, while `main`
  // still holds the document — otherwise the last answer before a close would be the one lost.
  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    settling?.();
  };
}
