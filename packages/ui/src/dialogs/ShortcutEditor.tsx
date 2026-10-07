import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import { type KeyboardEvent, type ReactElement, useMemo, useState } from 'react';

import {
  SHORTCUTS_CONFLICT,
  SHORTCUTS_DROPPED,
  SHORTCUTS_INCOMPLETE,
  SHORTCUTS_RESERVED,
  SHORTCUTS_RESET_ALL,
  SHORTCUTS_TYPING,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { normaliseChord } from '../surfaces/projections.js';
import { type ChordRefusal, displayChord, validateChord } from '../surfaces/shortcutChoice.js';
import { chordOf } from '../surfaces/shortcuts.js';
import type { KeyboardShortcutsAnswer } from './keyboardShortcuts.js';
import { ShortcutList, type ShortcutListRow } from './ShortcutList.js';

/** Each refusal's sentence, exhaustive over the rules' own list, so a new refusal arrives owing its words. */
const REFUSALS: Readonly<Record<ChordRefusal['kind'], MessageKey>> = {
  conflict: SHORTCUTS_CONFLICT,
  reserved: SHORTCUTS_RESERVED,
  typing: SHORTCUTS_TYPING,
  incomplete: SHORTCUTS_INCOMPLETE,
};

/**
 * Where a key is changed: the list of every command against its key with *Change*, *Reset* and *Remove*, and *Reset all
 * shortcuts* under it ([ADR-0191](../../../../docs/DECISIONS/0191-keys-are-changed-in-settings-keyboard-and-help-lists-them-without-the-editing.md);
 * the rules are [ADR-0111](../../../../docs/DECISIONS/0111-a-key-a-person-chose-is-a-setting-applied-before-the-registry-is-built.md)'s).
 *
 * ## A key is checked against the list AS IT STANDS
 *
 * The editor keeps its own copy of every command's key, so a key given to one command a moment ago is already taken for
 * the next: the rules ask *which command answers this chord now*, and that is this copy. A refusal names why — the
 * command that has it, or that Windows, an input method or a text field keeps it — and nothing is reported.
 *
 * ## Each change is reported and applied at once
 *
 * `report`, never an answer: the opener writes each choice to the setting as it is made, so there is no *Save* and
 * closing the dialog loses nothing.
 *
 * ## Capturing takes the whole key press
 *
 * While a row waits for a key, its button owns the key press: the default is prevented, so Ctrl+S saves nothing, and
 * the application's own shortcuts do not run behind an open dialog (ADR-0111 Decision 5). Modifiers alone keep it
 * waiting; Escape stops waiting.
 */
export function ShortcutEditor({
  rows,
  dropped,
  chords,
  setChords,
  report,
}: {
  readonly rows: readonly ShortcutListRow[];
  readonly dropped: readonly string[];
  /**
   * Each command's key as it stands, held by the CALLER: Settings shows one page at a time, so an editor that held them
   * itself would start again from the keys the dialog opened with each time the page was left and returned to.
   */
  readonly chords: Readonly<Record<string, string | null>>;
  readonly setChords: (next: (current: Readonly<Record<string, string | null>>) => Readonly<Record<string, string | null>>) => void;
  readonly report: (answer: KeyboardShortcutsAnswer) => void;
}): ReactElement {
  const { _ } = useLingui();
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
    report({ kind: 'choose', id, chord });
  };

  const capture = (row: ShortcutListRow, event: KeyboardEvent<HTMLButtonElement>): void => {
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
    <>
      {dropped.length === 0 ? null : (
        <p className="m-shortcuts-editor__note">{_(SHORTCUTS_DROPPED, { commands: dropped.map(titleOf).join(', ') })}</p>
      )}
      <ShortcutList
        rows={rows}
        editor={{
          chords,
          waiting,
          refused,
          begin: (row) => {
            setRefused(undefined);
            setWaiting(row.id);
          },
          capture,
          stopWaiting: () => {
            setWaiting(undefined);
          },
          choose,
        }}
      />
      {/* RESET ALL APART, under the list: it is about the whole list, not one row. */}
      <div className="m-shortcuts-editor__reset">
        <Button
          label={SHORTCUTS_RESET_ALL}
          onClick={() => {
            setChords(() => Object.fromEntries(rows.map((row) => [row.id, row.fallback])));
            setWaiting(undefined);
            setRefused(undefined);
            report({ kind: 'reset' });
          }}
        />
      </div>
    </>
  );
}
