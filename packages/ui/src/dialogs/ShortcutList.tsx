import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { KeyboardEvent, ReactElement } from 'react';
import { useRef } from 'react';

import {
  SHORTCUTS_ACTIONS_HEADER,
  SHORTCUTS_CHANGE,
  SHORTCUTS_CHORD_HEADER,
  SHORTCUTS_COMMAND_HEADER,
  SHORTCUTS_NONE,
  SHORTCUTS_PRESS,
  SHORTCUTS_REMOVE,
  SHORTCUTS_RESET,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Problem } from '../primitives/Problem.js';

/** One command and its key, as the command registry's rows reach a surface (`ShortcutRow`, with the title as a key). */
export interface ShortcutListRow {
  readonly id: string;
  readonly title: MessageKey;
  readonly chord: string | null;
  readonly fallback: string | null;
  readonly also: readonly string[];
}

/**
 * What the editing column needs. Present, the list draws *Change*, *Reset* and *Remove* on each row; absent, it is a list
 * to read and draws neither the column nor its header (ADR-0191).
 */
export interface ShortcutListEditor {
  /** Each command's key as it stands, which the list draws instead of the row's own, since a change is not yet a reopen. */
  readonly chords: Readonly<Record<string, string | null>>;
  /** The command waiting for a key, if any. */
  readonly waiting: string | undefined;
  /** The refusal to say, and the command it is said under. */
  readonly refused: { readonly id: string; readonly text: string } | undefined;
  readonly begin: (row: ShortcutListRow) => void;
  readonly capture: (row: ShortcutListRow, event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly stopWaiting: () => void;
  readonly choose: (id: string, chord: string | null) => void;
}

/**
 * Every command against its key — ONE list in two modes (ADR-0191).
 *
 * Help's dialog draws it to read; Settings › Keyboard draws it with an editor. The columns are the same table and the
 * rows the same registry rows, so the two cannot disagree about which commands there are or what they are called (B3a).
 */
export function ShortcutList({
  rows,
  editor,
}: {
  readonly rows: readonly ShortcutListRow[];
  readonly editor: ShortcutListEditor | undefined;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <table className="m-shortcuts">
      <thead>
        <tr>
          <th scope="col">{_(SHORTCUTS_COMMAND_HEADER)}</th>
          <th scope="col">{_(SHORTCUTS_CHORD_HEADER)}</th>
          {editor === undefined ? null : (
            <th className="m-shortcuts__actions" scope="col">
              {_(SHORTCUTS_ACTIONS_HEADER)}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <ShortcutRowView editor={editor} key={row.id} row={row} />
        ))}
      </tbody>
    </table>
  );
}

/** One command's row. A component of its own so the sentence about its key can point at the row's controls (`Problem`). */
function ShortcutRowView({
  row,
  editor,
}: {
  readonly row: ShortcutListRow;
  readonly editor: ShortcutListEditor | undefined;
}): ReactElement {
  const { _ } = useLingui();
  const rowRef = useRef<HTMLTableRowElement>(null);
  const chord = editor === undefined ? row.chord : (editor.chords[row.id] ?? null);
  const waiting = editor?.waiting === row.id;
  return (
    <tr ref={rowRef}>
      <th scope="row">{_(row.title)}</th>
              <td>
                {/* THE KEYS IN THEIR OWN FLEX BOX, so the cell stays a table cell: a `td` made `display: flex`
                    leaves the table's row alignment and drew every key above its command's name. */}
                <div className="m-shortcuts__keys">
                  {editor !== undefined && waiting ? (
                    <button
                      // THE ONE PLACE A KEY PRESS IS TAKEN WHOLE: focused as it appears, so the next key is its.
                      autoFocus
                      className="m-shortcuts__capture"
                      type="button"
                      onBlur={editor.stopWaiting}
                      onKeyDown={(event) => {
                        editor.capture(row, event);
                      }}
                    >
                      {_(SHORTCUTS_PRESS)}
                    </button>
                  ) : (
                    [chord, ...row.also]
                      .filter((each): each is string => each !== null)
                      .map((each) => <kbd key={each}>{each}</kbd>)
                  )}
                  {chord === null && row.also.length === 0 && !waiting ? (
                    <span className="m-shortcuts__none">{_(SHORTCUTS_NONE)}</span>
                  ) : null}
                  {editor?.refused?.id === row.id ? (
                    <Problem about={{ within: rowRef }} message={editor.refused.text} />
                  ) : null}
                </div>
              </td>
              {editor === undefined ? null : (
                <td className="m-shortcuts__actions">
                  <Button
                    label={SHORTCUTS_CHANGE}
                    variant="quiet"
                    onClick={() => {
                      editor.begin(row);
                    }}
                  />
                  {chord === row.fallback ? null : (
                    <Button
                      label={SHORTCUTS_RESET}
                      variant="quiet"
                      onClick={() => {
                        editor.choose(row.id, row.fallback);
                      }}
                    />
                  )}
                  {chord === null ? null : (
                    <Button
                      label={SHORTCUTS_REMOVE}
                      variant="quiet"
                      onClick={() => {
                        editor.choose(row.id, null);
                      }}
                    />
                  )}
                </td>
              )}
    </tr>
  );
}
