import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion, FileHandle } from '@monstera/shared';
import { type ReactElement, useEffect, useState } from 'react';

import { Button } from './primitives/Button.js';
import {
  RECENT_EMPTY,
  RECENT_LABEL,
  RECENT_MISSING,
  RECOVER_LABEL,
  RECOVER_OFFER,
} from './messages/en.js';

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
  onOpened,
}: {
  readonly client: ContractClient;
  /** Called with what was opened, exactly as `document.open`'s command reports. */
  readonly onOpened: (opened: {
    readonly docId: DocId;
    readonly version: DocVersion;
    readonly byteLength: number;
    readonly name: string;
  }) => void;
}): ReactElement | null {
  const { _ } = useLingui();
  const [state, setState] = useState<RecentState>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    void client['document.recent']({}).then(
      (answer) => {
        if (cancelled || !answer.ok) return;
        setState({
          kind: 'listed',
          entries: answer.value.entries,
          lastExitClean: answer.value.lastExitClean,
          missing: false,
        });
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
  }, [client]);

  if (state.kind === 'idle') return null;

  const open = async (handle: FileHandle): Promise<void> => {
    const answer = await client['document.openRecent']({ handle });
    if (!answer.ok) {
      // A STALE HANDLE IS A DEAD ROW, and it is reported rather than retried:
      // the registry is per-run, so a list held across a reload names handles
      // this run never minted.
      setState((current) => (current.kind === 'listed' ? { ...current, missing: true } : current));
      return;
    }
    if (answer.value.kind === 'absent') {
      // MAIN HAS ALREADY FORGOTTEN IT, so the row is gone from the list this
      // surface would fetch next — what is left is to say so.
      setState((current) =>
        current.kind === 'listed'
          ? {
              ...current,
              missing: true,
              entries: current.entries.filter((entry) => entry.handle !== handle),
            }
          : current,
      );
      return;
    }
    if (answer.value.kind !== 'opened') return;
    onOpened(answer.value);
  };

  const newest = state.entries[0];

  return (
    <section className="m-recent" aria-label={_(RECENT_LABEL)}>
      {/* THE OFFER, above the list, and only when both halves are true: a
          previous run that did not finish AND something to reopen. Either
          alone is an offer with nothing behind it. */}
      {!state.lastExitClean && newest !== undefined ? (
        <p className="m-recent-recover">
          {_(RECOVER_OFFER, { name: newest.name })}
          <Button
            label={RECOVER_LABEL}
            variant="primary"
            onClick={() => {
              void open(newest.handle);
            }}
          />
        </p>
      ) : null}
      {state.missing ? <p className="m-recent-problem">{_(RECENT_MISSING)}</p> : null}
      {state.entries.length === 0 ? (
        <p className="m-recent-empty">{_(RECENT_EMPTY)}</p>
      ) : (
        <ul className="m-recent-list">
          {state.entries.map((entry) => (
            // THE HANDLE IS THE KEY. It is minted per path and idempotent, so
            // it is the one value here that identifies a row — two files may
            // share a name, and a name key would make React reuse one row's
            // state for the other.
            <li key={entry.handle}>
              <button
                type="button"
                className="m-recent-item"
                onClick={() => {
                  void open(entry.handle);
                }}
              >
                {entry.name}
              </button>
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
      readonly entries: readonly RecentRow[];
      readonly lastExitClean: boolean;
      /** Set when a row could not be opened, and cleared by nothing: the row goes. */
      readonly missing: boolean;
    };
