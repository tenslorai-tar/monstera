import { useLingui } from '@lingui/react';
import type { ContractClient, SavedConversation, SavedTurn } from '@monstera/contract';
import type { DocId } from '@monstera/shared';
import { type ReactElement, useCallback, useEffect, useState } from 'react';

import {
  ASSISTANT_ASSISTANT,
  ASSISTANT_HISTORY,
  ASSISTANT_YOU,
  HISTORY_BACK,
  HISTORY_BACK_TO_LIST,
  HISTORY_BOUNDS,
  HISTORY_CLEAR_ALL,
  HISTORY_CLEAR_ALL_ASK,
  HISTORY_CLEAR_ALL_KEEP,
  HISTORY_CLEAR_ALL_YES,
  HISTORY_DELETE,
  HISTORY_DELETE_ASK,
  HISTORY_DELETE_KEEP,
  HISTORY_DELETE_SHOWN,
  HISTORY_DELETE_YES,
  HISTORY_EMPTY,
  HISTORY_EMPTY_OFF,
  HISTORY_FAILED,
  HISTORY_GONE,
  HISTORY_LOADING,
  HISTORY_MESSAGES,
  HISTORY_OPEN,
  HISTORY_OPEN_SHOWN,
  HISTORY_READ_ONLY,
  HISTORY_SHOWN,
  HISTORY_UNNAMED,
} from './messages/en.js';
import { Button } from './primitives/Button.js';
import { IconButton } from './primitives/IconButton.js';
import { ICONS } from './primitives/icons.js';

/** What History is showing. */
type View =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'list'; readonly conversations: readonly SavedConversation[] }
  | {
      /** One conversation, read-only. `turns` is `undefined` for one removed since the list was read. */
      readonly kind: 'conversation';
      readonly entry: SavedConversation;
      readonly turns: readonly SavedTurn[] | undefined;
    };

/** What is waiting for its answer: one conversation's Delete, or this file's Clear all. */
type Asking = { readonly kind: 'delete'; readonly key: string } | { readonly kind: 'clear-all' } | undefined;

/**
 * The Assistant's History
 * ([ADR-0279](../../../docs/DECISIONS/0279-saved-conversations-are-kept-without-caps-each-in-its-own-file-and-history-reads-one-log.md)
 * Decisions 2 and 3): the open PDF's saved conversations, newest saved first, each headed by when it was saved with its
 * first question — **Open** to read it, **Delete** to remove it, and **Clear all** for this file, both asking first.
 *
 * ## Only this file's, every page of them
 *
 * `main` reads only this PDF's file, and only the section of the PDF now at its place. With no cap, a file may hold more
 * than one answer carries, so the list is read page after page until `main` says there is no next one: every one is
 * listed, and no control is needed to reach the rest.
 *
 * ## Open reads the conversation here; it does not change the one on show
 *
 * A conversation is shown read-only, with a way back to the list. The Assistant's own conversation under it is untouched.
 *
 * ## The list is read each time it is shown
 *
 * It is main's store, changed by this document's saves, so a copy kept here would go stale.
 */
export function AssistantHistory({
  client,
  docId,
  name,
  saving,
  onBack,
}: {
  readonly client: ContractClient;
  /** The open document whose History this is. */
  readonly docId: DocId;
  /** Its name, which *Clear all* says it removes the conversations about. */
  readonly name: string;
  /** Whether *Save chat history* is on: the empty list says why nothing is kept when it is off. */
  readonly saving: boolean;
  /** Leaves History for the conversation the Assistant was showing. */
  readonly onBack: () => void;
}): ReactElement {
  const { i18n } = useLingui();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [asking, setAsking] = useState<Asking>(undefined);

  const load = useCallback((): void => {
    const pages = async (): Promise<readonly SavedConversation[] | null> => {
      const all: SavedConversation[] = [];
      for (let from: number | null = 0; from !== null; ) {
        const answer = await client['ai.history.list']({ docId, from });
        if (!answer.ok) return null;
        all.push(...answer.value.conversations);
        from = answer.value.next;
      }
      return all;
    };
    void pages().then(
      (conversations) => {
        setView(conversations === null ? { kind: 'failed' } : { kind: 'list', conversations });
      },
      () => {
        setView({ kind: 'failed' });
      },
    );
  }, [client, docId]);

  // READ ONCE ON SHOWING (and again after a delete, a clear, or a return from a conversation).
  useEffect(() => {
    load();
  }, [load]);

  /** An entry's heading: when it was saved, or *Earlier conversation* for one 1.1.2610.0 saved before times were kept. */
  const headingOf = (entry: SavedConversation): string =>
    entry.savedAt === null
      ? i18n._(HISTORY_UNNAMED)
      : new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.savedAt));

  const open = (entry: SavedConversation): void => {
    void client['ai.history.read']({ docId, key: entry.key }).then(
      (answer) => {
        setView({
          kind: 'conversation',
          entry,
          turns: answer.ok && answer.value.conversation !== null ? answer.value.conversation.turns : undefined,
        });
      },
      () => {
        setView({ kind: 'failed' });
      },
    );
  };

  const remove = (entry: SavedConversation): void => {
    setAsking(undefined);
    // THE LIST IS READ AGAIN rather than edited in place: main is the store, and what it still holds is the truth.
    void client['ai.history.remove']({ docId, key: entry.key }).then(load, load);
  };

  const clearAll = (): void => {
    setAsking(undefined);
    void client['ai.history.clearFile']({ docId }).then(load, load);
  };

  if (view.kind === 'conversation') {
    return (
      <section aria-label={i18n._(HISTORY_READ_ONLY)} className="m-assistant-history" data-assistant-history="conversation">
        <div className="m-assistant-history__bar">
          <IconButton icon={ICONS.ChevronLeft} label={HISTORY_BACK_TO_LIST} onClick={load} size="dense" />
          <h2 className="m-assistant-history__heading">{headingOf(view.entry)}</h2>
        </div>
        <p className="m-assistant-history__note">{i18n._(HISTORY_SHOWN)}</p>
        {view.turns === undefined ? (
          <p className="m-assistant-history__note">{i18n._(HISTORY_GONE)}</p>
        ) : (
          <ol className="m-assistant-history__turns">
            {view.turns.map((turn, at) => (
              <li className={`m-assistant-history__turn m-assistant-history__turn--${turn.role}`} key={`${String(at)}-${turn.role}`}>
                <span className="m-assistant-history__who">{i18n._(turn.role === 'user' ? ASSISTANT_YOU : ASSISTANT_ASSISTANT)}</span>
                <span className="m-assistant-history__text">{turn.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    );
  }

  return (
    <section aria-label={i18n._(ASSISTANT_HISTORY)} className="m-assistant-history" data-assistant-history="list">
      <div className="m-assistant-history__bar">
        <IconButton icon={ICONS.ChevronLeft} label={HISTORY_BACK} onClick={onBack} size="dense" />
        <h2 className="m-assistant-history__heading">{i18n._(ASSISTANT_HISTORY)}</h2>
      </div>
      {view.kind === 'loading' ? (
        <p className="m-assistant-history__note" role="status">
          {i18n._(HISTORY_LOADING)}
        </p>
      ) : view.kind === 'failed' ? (
        <p className="m-assistant-history__note" role="alert">
          {i18n._(HISTORY_FAILED)}
        </p>
      ) : view.conversations.length === 0 ? (
        <p className="m-assistant-history__note" data-assistant-history-empty={saving ? 'on' : 'off'}>
          {i18n._(saving ? HISTORY_EMPTY : HISTORY_EMPTY_OFF)}
        </p>
      ) : (
        <>
          {/* WHAT KEEPS THEM AND WHAT REMOVES THEM, said where they are listed (the owner's approval of 2026-11-01). */}
          <p className="m-assistant-history__note" data-assistant-history-bounds="">
            {i18n._(HISTORY_BOUNDS)}
          </p>
          <div className="m-assistant-history__actions" data-assistant-history-clear-all="">
            {asking?.kind === 'clear-all' ? (
              <span aria-label={i18n._(HISTORY_CLEAR_ALL_ASK, { name })} className="m-assistant-history__ask" role="group">
                <span>{i18n._(HISTORY_CLEAR_ALL_ASK, { name })}</span>
                <Button label={HISTORY_CLEAR_ALL_YES} onClick={clearAll} variant="danger" />
                <Button
                  label={HISTORY_CLEAR_ALL_KEEP}
                  onClick={() => {
                    setAsking(undefined);
                  }}
                />
              </span>
            ) : (
              <Button
                label={HISTORY_CLEAR_ALL}
                onClick={() => {
                  setAsking({ kind: 'clear-all' });
                }}
              />
            )}
          </div>
          <ul className="m-assistant-history__list">
            {view.conversations.map((entry) => (
              <li className="m-assistant-history__item" key={entry.key}>
                <span className="m-assistant-history__name">{headingOf(entry)}</span>
                <span className="m-assistant-history__meta">{i18n._(HISTORY_MESSAGES, { count: entry.turns })}</span>
                {entry.preview === '' ? null : <span className="m-assistant-history__preview">{entry.preview}</span>}
                <span className="m-assistant-history__actions">
                  {asking?.kind === 'delete' && asking.key === entry.key ? (
                    <span aria-label={i18n._(HISTORY_DELETE_ASK)} className="m-assistant-history__ask" role="group">
                      <span>{i18n._(HISTORY_DELETE_ASK)}</span>
                      <Button
                        label={HISTORY_DELETE_YES}
                        onClick={() => {
                          remove(entry);
                        }}
                        variant="danger"
                      />
                      <Button
                        label={HISTORY_DELETE_KEEP}
                        onClick={() => {
                          setAsking(undefined);
                        }}
                      />
                    </span>
                  ) : (
                    <>
                      <Button
                        label={HISTORY_OPEN}
                        onClick={() => {
                          open(entry);
                        }}
                        shown={HISTORY_OPEN_SHOWN}
                        values={{ time: headingOf(entry) }}
                      />
                      <Button
                        label={HISTORY_DELETE}
                        onClick={() => {
                          setAsking({ kind: 'delete', key: entry.key });
                        }}
                        shown={HISTORY_DELETE_SHOWN}
                        values={{ time: headingOf(entry) }}
                      />
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
