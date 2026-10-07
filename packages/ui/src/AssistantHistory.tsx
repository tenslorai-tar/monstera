import { useLingui } from '@lingui/react';
import type { ContractClient, SavedConversation, SavedTurn } from '@monstera/contract';
import { type ReactElement, useCallback, useEffect, useState } from 'react';

import {
  ASSISTANT_ASSISTANT,
  ASSISTANT_HISTORY,
  ASSISTANT_YOU,
  HISTORY_BACK,
  HISTORY_BACK_TO_LIST,
  HISTORY_DELETE,
  HISTORY_DELETE_ASK,
  HISTORY_DELETE_KEEP,
  HISTORY_DELETE_SHOWN,
  HISTORY_DELETE_YES,
  HISTORY_EMPTY,
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

/** What the History is showing. */
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

/**
 * The Assistant's History (ADR-0192): every saved conversation, newest saved first, each with the name of the file it was
 * about, when it was saved and its first question — and **Open** to read it and **Delete** to remove it, which asks first.
 *
 * ## Open reads the conversation here; it does not open the file
 *
 * The store keeps no path (ADR-0093) and the renderer can name none, so a conversation is shown where it is, read-only, with
 * a way back to the list. A conversation whose file has moved or gone is therefore still readable, which is what a History
 * is for. Reopening the file still brings its own conversation back into the Assistant, as before.
 *
 * ## The list is read each time it is shown
 *
 * It is main's store, changed by saves from any document, so a copy kept here would go stale; one read per opening, bounded
 * by the store's own two hundred.
 */
export function AssistantHistory({
  client,
  onBack,
}: {
  readonly client: ContractClient;
  /** Leaves the History for the conversation the Assistant was showing. */
  readonly onBack: () => void;
}): ReactElement {
  const { i18n } = useLingui();
  const [view, setView] = useState<View>({ kind: 'loading' });
  /** The key whose Delete is waiting for its answer, if any. */
  const [asking, setAsking] = useState<string | undefined>(undefined);

  const load = useCallback((): void => {
    void client['ai.history.list']({}).then(
      (answer) => {
        setView(answer.ok ? { kind: 'list', conversations: answer.value.conversations } : { kind: 'failed' });
      },
      () => {
        setView({ kind: 'failed' });
      },
    );
  }, [client]);

  // READ ONCE ON SHOWING (and again after a delete or a return from a conversation): the store is main's, changed by saves
  // from any document, so a copy kept here would go stale.
  useEffect(() => {
    load();
  }, [load]);

  const nameOf = (entry: SavedConversation): string => entry.name ?? i18n._(HISTORY_UNNAMED);
  const when = (entry: SavedConversation): string | null =>
    entry.savedAt === null
      ? null
      : new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.savedAt));

  const open = (entry: SavedConversation): void => {
    void client['ai.history.read']({ key: entry.key }).then(
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
    void client['ai.history.remove']({ key: entry.key }).then(load, load);
  };

  if (view.kind === 'conversation') {
    return (
      <section aria-label={i18n._(HISTORY_READ_ONLY)} className="m-assistant-history" data-assistant-history="conversation">
        <div className="m-assistant-history__bar">
          <IconButton icon={ICONS.ChevronLeft} label={HISTORY_BACK_TO_LIST} onClick={load} size="dense" />
          <h2 className="m-assistant-history__heading">{nameOf(view.entry)}</h2>
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
        <p className="m-assistant-history__note">{i18n._(HISTORY_EMPTY)}</p>
      ) : (
        <ul className="m-assistant-history__list">
          {view.conversations.map((entry) => (
            <li className="m-assistant-history__item" key={entry.key}>
              <span className="m-assistant-history__name">{nameOf(entry)}</span>
              <span className="m-assistant-history__meta">
                {[when(entry), i18n._(HISTORY_MESSAGES, { count: entry.turns })].filter((part) => part !== null).join(' · ')}
              </span>
              {entry.preview === '' ? null : <span className="m-assistant-history__preview">{entry.preview}</span>}
              <span className="m-assistant-history__actions">
                {asking === entry.key ? (
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
                      values={{ name: nameOf(entry) }}
                    />
                    <Button
                      label={HISTORY_DELETE}
                      onClick={() => {
                        setAsking(entry.key);
                      }}
                      shown={HISTORY_DELETE_SHOWN}
                      values={{ name: nameOf(entry) }}
                    />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
