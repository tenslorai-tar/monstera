import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import { type KeyboardEvent, type ReactElement, useMemo, useState } from 'react';

import {
  SHORTCUTS_ACTIONS_HEADER,
  SHORTCUTS_CHANGE,
  SHORTCUTS_CHORD_HEADER,
  SHORTCUTS_COMMAND_HEADER,
  SHORTCUTS_CONFLICT,
  SHORTCUTS_DROPPED,
  SHORTCUTS_INCOMPLETE,
  SHORTCUTS_NONE,
  SHORTCUTS_PRESS,
  SHORTCUTS_REMOVE,
  SHORTCUTS_RESERVED,
  SHORTCUTS_RESET,
  SHORTCUTS_RESET_ALL,
  SHORTCUTS_TYPING,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { normaliseChord } from '../surfaces/projections.js';
import { type ChordRefusal, displayChord, validateChord } from '../surfaces/shortcutChoice.js';
import { chordOf } from '../surfaces/shortcuts.js';
import type { KeyboardShortcutsAnswer } from './keyboardShortcuts.js';

interface Row {
  readonly id: string;
  readonly title: MessageKey;
  readonly chord: string | null;
  readonly fallback: string | null;
  readonly also: readonly string[];
}

/** Each refusal's sentence, exhaustive over the rules' own list, so a new refusal arrives owing its words. */
const REFUSALS: Readonly<Record<ChordRefusal['kind'], MessageKey>> = {
  conflict: SHORTCUTS_CONFLICT,
  reserved: SHORTCUTS_RESERVED,
  typing: SHORTCUTS_TYPING,
  incomplete: SHORTCUTS_INCOMPLETE,
};

/**
 * The keyboard shortcuts dialog's body: every command against its key, and a way to change any of them
 * ([ADR-0111](../../../../docs/DECISIONS/0111-a-key-a-person-chose-is-a-setting-applied-before-the-registry-is-built.md)).
 *
 * ## A key is checked against the list AS IT STANDS
 *
 * The body keeps its own copy of every command's key, so a key given to one command a moment ago is already taken for
 * the next: the rules ask *which command answers this chord now*, and that is this copy. A refusal names why — the
 * command that has it, or that Windows, an input method or a text field keeps it — and nothing is reported.
 *
 * ## Each change is reported and applied at once
 *
 * `update`, never `resolve`: the command writes each choice to the setting as it is made, as Settings does, so there is
 * no *Save* and closing the dialog loses nothing.
 *
 * ## Capturing takes the whole key press
 *
 * While a row waits for a key, its button owns the key press: the default is prevented, so Ctrl+S saves nothing, and
 * the application's own shortcuts do not run behind an open dialog (ADR-0111 Decision 5). Modifiers alone keep it
 * waiting; Escape stops waiting.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function KeyboardShortcutsBody({
  rows,
  dropped,
  update,
}: { readonly rows: readonly Row[]; readonly dropped: readonly string[] } & DialogAnswering<KeyboardShortcutsAnswer>): ReactElement {
  const { _ } = useLingui();
  const [chords, setChords] = useState<Readonly<Record<string, string | null>>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, row.chord])),
  );
  const [waiting, setWaiting] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<{ readonly id: string; readonly text: string } | undefined>(undefined);

  // EVERY CHORD ANSWERED NOW, normalised, and by whom: the first key of each command as this copy holds it, and each
  // further key, which a person cannot move but can collide with.
  const taken = useMemo(() => {
    const holders = new Map<string, string>();
    for (const row of rows) {
      const chord = chords[row.id];
      if (chord !== null && chord !== undefined) holders.set(normaliseChord(chord), row.id);
      for (const further of row.also) holders.set(normaliseChord(further), row.id);
    }
    return holders;
  }, [chords, rows]);
  const titleOf = (id: string): string => {
    const title = rows.find((row) => row.id === id)?.title;
    return title === undefined ? id : _(title);
  };

  const choose = (id: string, chord: string | null): void => {
    setChords((current) => ({ ...current, [id]: chord }));
    setWaiting(undefined);
    setRefused(undefined);
    update({ kind: 'choose', id, chord });
  };

  const capture = (row: Row, event: KeyboardEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setWaiting(undefined);
      return;
    }
    const chord = chordOf(event);
    const own = row.fallback === null ? undefined : normaliseChord(row.fallback);
    const refusal = validateChord(chord, row.id, taken, own);
    // MODIFIERS ALONE are the start of a chord, not a refusal: keep waiting for the key.
    if (refusal?.kind === 'incomplete') return;
    if (refusal === null) {
      choose(row.id, displayChord(chord));
      return;
    }
    setRefused({
      id: row.id,
      text: _(REFUSALS[refusal.kind], {
        chord: displayChord(chord),
        command: refusal.kind === 'conflict' ? titleOf(refusal.with) : '',
      }),
    });
  };

  return (
    <div className="m-shortcuts-editor">
      {dropped.length === 0 ? null : (
        <p className="m-shortcuts-editor__note">{_(SHORTCUTS_DROPPED, { commands: dropped.map(titleOf).join(', ') })}</p>
      )}
      <table className="m-shortcuts">
        <thead>
          <tr>
            <th scope="col">{_(SHORTCUTS_COMMAND_HEADER)}</th>
            <th scope="col">{_(SHORTCUTS_CHORD_HEADER)}</th>
            <th scope="col">{_(SHORTCUTS_ACTIONS_HEADER)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const chord = chords[row.id] ?? null;
            return (
              <tr key={row.id}>
                <th scope="row">{_(row.title)}</th>
                <td>
                  {/* THE KEYS IN THEIR OWN FLEX BOX, so the cell stays a table cell: a `td` made `display: flex`
                      leaves the table's row alignment and drew every key above its command's name. */}
                  <div className="m-shortcuts__keys">
                  {waiting === row.id ? (
                    <button
                      // THE ONE PLACE A KEY PRESS IS TAKEN WHOLE: focused as it appears, so the next key is its.
                      autoFocus
                      className="m-shortcuts__capture"
                      type="button"
                      onBlur={() => {
                        setWaiting(undefined);
                      }}
                      onKeyDown={(event) => {
                        capture(row, event);
                      }}
                    >
                      {_(SHORTCUTS_PRESS)}
                    </button>
                  ) : (
                    [chord, ...row.also]
                      .filter((each): each is string => each !== null)
                      .map((each) => <kbd key={each}>{each}</kbd>)
                  )}
                  {chord === null && row.also.length === 0 && waiting !== row.id ? (
                    <span className="m-shortcuts__none">{_(SHORTCUTS_NONE)}</span>
                  ) : null}
                  {refused?.id === row.id ? (
                    <p className="m-shortcuts__refused" role="alert">
                      {refused.text}
                    </p>
                  ) : null}
                  </div>
                </td>
                <td className="m-shortcuts__actions">
                  <Button
                    label={SHORTCUTS_CHANGE}
                    variant="quiet"
                    onClick={() => {
                      setRefused(undefined);
                      setWaiting(row.id);
                    }}
                  />
                  {chord === row.fallback ? null : (
                    <Button
                      label={SHORTCUTS_RESET}
                        variant="quiet"
                      onClick={() => {
                        choose(row.id, row.fallback);
                      }}
                    />
                  )}
                  {chord === null ? null : (
                    <Button
                      label={SHORTCUTS_REMOVE}
                        variant="quiet"
                      onClick={() => {
                        choose(row.id, null);
                      }}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="m-shortcuts-editor__actions">
        <Button
          label={SHORTCUTS_RESET_ALL}
          onClick={() => {
            setChords(Object.fromEntries(rows.map((row) => [row.id, row.fallback])));
            setWaiting(undefined);
            setRefused(undefined);
            update({ kind: 'reset' });
          }}
        />
      </div>
    </div>
  );
}
