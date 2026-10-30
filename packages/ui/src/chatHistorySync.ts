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
  // WHICH SAVED CONVERSATION this one is (ADR-0277 Decision 6): its key once `main` has one, for the conversation the
  // store's serial names. A new serial is a new conversation, saved as a new one, so the old one is kept, never replaced.
  let saving: { readonly serial: number; readonly conversation: string | null } = {
    serial: store.getState().conversationSerial,
    conversation: null,
  };
  // A NEW CONVERSATION'S FIRST SAVE IS WAITED FOR: its key arrives with the answer, and a second save sent before it would
  // add the same conversation twice. Every other save goes AT ONCE, in the same call, so the flush on close reaches `main`
  // while it still holds the document.
  let firstSave: Promise<void> | null = null;
  let afterFirst = false;

  if (enabled()) {
    const serial = saving.serial;
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
      saving = { serial, conversation: answer.value.conversation };
      store.getState().converse(turns);
    });
  }

  const saveNow = async (): Promise<void> => {
    if (!enabled()) return;
    const state = store.getState();
    if (state.conversationSerial !== saving.serial) saving = { serial: state.conversationSerial, conversation: null };
    const asked = saving;
    const answer = await client['ai.history.save']({ docId, conversation: asked.conversation, turns: savedTurns(state.conversation) });
    // A CONVERSATION BEGUN SINCE is not this one: the key answered belongs to the conversation that was asked about.
    if (store.getState().conversationSerial !== asked.serial) return;
    if (answer.ok) {
      saving = { serial: asked.serial, conversation: answer.value.conversation ?? asked.conversation };
      if (answer.value.saved) store.getState().historyRefusedAs(null);
    } else if (answer.error.code === 'file-full') {
      // SAID, NOT DROPPED: the file keeps its twenty and this conversation is not saved until one is removed.
      store.getState().historyRefusedAs('file-full');
    }
  };
  const save = (): void => {
    if (firstSave !== null && store.getState().conversationSerial === saving.serial && saving.conversation === null) {
      afterFirst = true;
      return;
    }
    const keyless = saving.conversation === null || store.getState().conversationSerial !== saving.serial;
    const sent = saveNow();
    if (!keyless) return;
    firstSave = sent.finally(() => {
      firstSave = null;
      if (afterFirst) {
        afterFirst = false;
        save();
      }
    });
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
