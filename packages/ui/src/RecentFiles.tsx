import { useLingui } from '@lingui/react';
import type { ChannelResult, ContractClient } from '@monstera/contract';
import type { FileHandle } from '@monstera/shared';
import { type ReactElement, useEffect, useId, useState } from 'react';

import type { RecentOpenOutcome } from './commands/openDocument.js';
import { type Translate, recentLine, recentWhere } from './recentLine.js';
import { Button } from './primitives/Button.js';
import {
  RECENT_CLEAR,
  RECENT_EMPTY,
  RECENT_HEADING,
  RECENT_LABEL,
  RECENT_MISSING,
  RECENT_PLACEHOLDER,
  RECENT_UNAVAILABLE,
  RECENT_UNAVAILABLE_AT,
  RECOVER_LABEL,
  RECOVER_OFFER,
} from './messages/en.js';

/**
 * How many recent files the START SCREEN shows: the first four of the list main keeps (the owner, 2026-10-02, item
 * N3: *"the start screen still shows 4"*). The start screen's own number, not the list's — main keeps ten
 * (`MAX_RECENT_ENTRIES`), and File › Recent shows them all
 * ([ADR-0143](../../../docs/DECISIONS/0143-file-recent-is-the-menu-rows-own-value-control-and-main-keeps-ten.md)).
 */
export const START_SCREEN_RECENT = 4;

/**
 * The documents this reader opened before, and the offer after a run that did
 * not finish.
 *
 * ## Not a projection of the command registry, and that is not an exception
 *
 * §7 makes the start screen a projection so that *a feature is registered, not
 * wired* — the rule is about commands, and this list holds none. Each row is
 * one datum from main with a button beside it; registering a command per recent
 * file would mean mutating the registry every time the list changed, which is
 * the second wiring place wearing the first one's clothes.
 *
 * `check:secondwiring` reports a literal array of command ids under
 * `surfaces/`. This module names no command id, which is the property that rule
 * is about rather than a technicality it happens not to catch — and it lives
 * beside the panels rather than in `surfaces/` because it projects nothing.
 *
 * ## A HANDLE, never a path
 *
 * Each entry carries the capability main minted and the file's name. The
 * renderer can name a file it cannot read, and cannot name one main never
 * recorded — which is what makes `document.openRecent` safe where a path
 * parameter on `document.open` would not be (invariant L2).
 *
 * ## The recovery offer is this list plus ONE BOOLEAN
 *
 * `lastExitClean` is false when the previous run did not reach its shutdown.
 * With one document open at a time, the newest entry IS what was open when it
 * stopped, so the offer names it. **That correspondence expires with
 * multi-document tabs** — when several documents can be open, the newest recent
 * entry is one of them and this must become a recorded session rather than an
 * inference.
 */
export function RecentFiles({
  client,
  openRecent,
  onClear,
}: {
  readonly client: ContractClient;
  /**
   * Opens an entry through the ONE recent-open route, `openRecentDocument` (ADR-0143), which File › Recent and the
   * restore at start take too — so a card settles an open exactly as they do.
   */
  readonly openRecent: (handle: FileHandle) => Promise<RecentOpenOutcome>;
  /** *Clear list*: the registered `document.clear-recent`'s own `run`, so the button and the menu item are one thing. */
  readonly onClear: () => Promise<void>;
}): ReactElement | null {
  const { _ } = useLingui();
  const [state, setState] = useState<RecentState>({ kind: 'idle' });
  // HOW MANY TIMES THIS VIEW HAS ASKED MAIN AGAIN: an open that did not show a document reads the list once more, so a
  // file found missing is drawn as unavailable rather than offered as though it would open.
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void client['document.recent']({}).then(
      (answer) => {
        if (cancelled || !answer.ok) return;
        setState((current) => ({
          kind: 'listed',
          entries: answer.value.entries,
          lastExitClean: answer.value.lastExitClean,
          session: answer.value.lastSession,
          // A SENTENCE ALREADY SHOWN STAYS through the read it caused: it answers what the reader just did.
          missing: current.kind === 'listed' && current.missing,
        }));
      },
      () => {
        // Nothing. A recent list that cannot be read is a convenience that is
        // not available, and an error where a reader expects a list of files is
        // worse than an absent list — the open command beside it still works.
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [client, reads]);

  if (state.kind === 'idle') return null;

  const open = async (handle: FileHandle): Promise<void> => {
    const outcome = await openRecent(handle);
    if (outcome === 'shown') return;
    // A STALE HANDLE is said here: the registry is per-run, so a list held across a reload names handles this run never
    // minted. A file that has gone is said by the start screen's own problem line, which the shared route fills.
    if (outcome === 'refused') {
      setState((current) => (current.kind === 'listed' ? { ...current, missing: true } : current));
    }
    // EITHER WAY THE LIST IS READ AGAIN, and the row stays (ADR-0143): main keeps a file that has gone and now says it
    // is unavailable, which is what this view draws next.
    setReads((count) => count + 1);
  };

  return (
    <section className="m-recent" aria-label={_(RECENT_LABEL)}>
      {/* THE OFFER, above the list, and only when both halves are true: a
          previous run that did not finish AND something to reopen. Either
          alone is an offer with nothing behind it.

          THE SECOND HALF IS THE RECORDED SESSION, not the head of the list.
          It named `entries[0]` while one document could be open, where the
          newest recent entry WAS what was on screen; multi-document tabs ended
          that correspondence, and a reader with three documents open would
          have been offered the last one they touched and told nothing about
          the other two. `lastSession` is what main recorded, and it is empty
          after a clean exit — so this condition is *the run died* AND *there
          was something on screen when it did*. */}
      {!state.lastExitClean && state.session.length > 0 ? (
        <div className="m-recent-recover">
          <p>{_(RECOVER_OFFER)}</p>
          <ul className="m-recover-list">
            {state.session.map((entry) => (
              <li key={entry.handle}>
                <Button
                  label={RECOVER_LABEL}
                  values={{ name: entry.name }}
                  variant="primary"
                  onClick={() => {
                    void open(entry.handle);
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {state.missing ? <p className="m-recent-problem">{_(RECENT_MISSING)}</p> : null}
      {state.entries.length === 0 ? null : (
        // v5-01's HEADER: the list's name and its one action. The cards are the list's own content (ADR-0068);
        // *Clear list* runs the registered `document.clear-recent`, the item File › Recent carries (ADR-0143).
        <div className="m-recent-header">
          <h2 className="m-recent-heading">{_(RECENT_HEADING)}</h2>
          <button
            type="button"
            className="m-recent-action"
            onClick={() => {
              // THE COMMAND EMPTIES ON MAIN'S ANSWER and then has every view read the list again, this one included.
              void onClear().then(
                () => undefined,
                () => {
                  // Nothing is cleared on the page unless main cleared it, so a failed ask leaves the list on
                  // screen — which is the true state, and says it did not happen.
                },
              );
            }}
          >
            {_(RECENT_CLEAR)}
          </button>
        </div>
      )}
      {state.entries.length === 0 ? (
        <p className="m-recent-empty">{_(RECENT_EMPTY)}</p>
      ) : (
        <ul className="m-recent-list">
          {/* THE FIRST FOUR of the list main keeps (`START_SCREEN_RECENT`): this view's own number. Main keeps ten
              and File › Recent shows them all — one list, two views (ADR-0143). */}
          {state.entries.slice(0, START_SCREEN_RECENT).map((entry) => (
            // THE HANDLE IS THE KEY. It is minted per path and idempotent, so
            // it is the one value here that identifies a row — two files may
            // share a name, and a name key would make React reuse one row's
            // state for the other.
            <li key={entry.handle}>
              <RecentCard
                entry={entry}
                client={client}
                onOpen={() => {
                  void open(entry.handle);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One row, as the contract carries it. */
interface RecentRow {
  readonly handle: FileHandle;
  readonly name: string;
}

/** An entry of the list, as `document.recent` answers it. */
type ListedRow = ChannelResult<'document.recent'>['entries'][number];

/**
 * One recent file as v5-01 draws it: its name, and a second line saying when it was opened here and where it
 * is, both from main (ADR-0100).
 *
 * **The name NAMES the button and the line DESCRIBES it.** Read from content, the accessible name would be
 * both run together — *annual.pdf Today · Documents › Leases* — which is not what the control is called.
 */
function RecentCard({
  entry,
  client,
  onOpen,
}: {
  readonly entry: ListedRow;
  readonly client: ContractClient;
  readonly onOpen: () => void;
}): ReactElement {
  const { _, i18n } = useLingui();
  const nameId = useId();
  const lineId = useId();
  const translate: Translate = (key, values) => _(key, values);
  // A FILE THAT IS NOT THERE NOW says so in place of when it was opened, beside where it was (ADR-0143) — listed, and
  // never offered as one that opens.
  const where = entry.available ? null : recentWhere(entry.location, translate);
  const line = entry.available
    ? recentLine(entry, new Date(), i18n.locale, translate)
    : where === null
      ? _(RECENT_UNAVAILABLE)
      : _(RECENT_UNAVAILABLE_AT, { where });
  const picture = usePicture(client, entry.handle);
  return (
    <button
      type="button"
      className="m-recent-item"
      aria-labelledby={nameId}
      aria-describedby={line === null ? undefined : lineId}
      // DISABLED AND STILL FOCUSABLE: `aria-disabled` rather than `disabled`, so a keyboard reaches the card and hears
      // its state rather than skipping a file it was never told about.
      aria-disabled={entry.available ? undefined : true}
      data-unavailable={entry.available ? undefined : 'true'}
      onClick={entry.available ? onOpen : undefined}
    >
      {/* THE PICTURE IS DECORATIVE: the card is named by the file, and a picture of a page says nothing a
          screen reader should read out. With none, the page's shape and its type, as a file icon shows. */}
      {picture === null ? (
        <span aria-hidden="true" className="m-recent-item__picture m-recent-item__picture--none">
          {_(RECENT_PLACEHOLDER)}
        </span>
      ) : (
        <img alt="" className="m-recent-item__picture" src={picture} />
      )}
      <span className="m-recent-item__name" id={nameId}>
        {entry.name}
      </span>
      {line === null ? null : (
        <span className="m-recent-item__line" id={lineId}>
          {line}
        </span>
      )}
    </button>
  );
}

/**
 * A listed file's picture as an object URL, or `null` while none has arrived or main has none (ADR-0100).
 *
 * **The URL is revoked** when the card goes or its handle changes, so a list redrawn a hundred times holds
 * one picture per card and not a hundred. A refused or failed ask is a card with the placeholder, which is
 * what *no picture* means on this screen; nothing else waits on it.
 */
function usePicture(client: ContractClient, handle: FileHandle): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    let current = true;
    void client['document.recentPreview']({ handle }).then(
      (answer) => {
        if (!current || !answer.ok || answer.value.kind !== 'picture') return;
        made = URL.createObjectURL(new Blob([answer.value.jpeg], { type: 'image/jpeg' }));
        setUrl(made);
      },
      () => {
        // The list's own rule for an unreadable convenience (the `document.recent` ask above): the card keeps
        // its placeholder, which is what *no picture* already looks like.
      },
    );
    return (): void => {
      current = false;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [client, handle]);
  return url;
}

/**
 * What the surface is showing.
 *
 * `idle` until the first answer, so nothing renders an empty list before it is
 * known to be empty — *this reader has opened nothing* and *the answer has not
 * arrived* are different sentences and only one is worth showing.
 */
type RecentState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'listed';
      readonly entries: readonly ListedRow[];
      readonly lastExitClean: boolean;
      /**
       * What was open when the previous run ended — main's record, not a guess.
       *
       * A separate list from `entries` because it is a different question, and
       * one the recent list stopped being able to answer when several
       * documents could be open at once.
       */
      readonly session: readonly RecentRow[];
      /** Set when a row's handle was refused, and cleared by nothing: the list is read again and the row stays. */
      readonly missing: boolean;
    };
