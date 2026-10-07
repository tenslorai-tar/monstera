import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { KEYBOARD_SHORTCUTS_TITLE, SHORTCUTS_DROPPED } from '../messages/en.js';
import { DialogFooter, DialogScroll } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { KeyboardShortcutsAnswer } from './keyboardShortcuts.js';
import { ShortcutList, type ShortcutListRow } from './ShortcutList.js';

/**
 * Help › Keyboard shortcuts: every command against its key, to READ (ADR-0191).
 *
 * It draws the list without the editing column and reports nothing, so there is no route by which a key is changed from
 * here; Settings › Keyboard is where that is done, over the same rows (`ShortcutList`'s two modes). The one thing it
 * says beyond the list is which commands' chosen keys went back to their usual ones, since that is a fact about what the
 * list shows.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function KeyboardShortcutsBody({
  rows,
  dropped,
}: {
  readonly rows: readonly ShortcutListRow[];
  readonly dropped: readonly string[];
} & DialogAnswering<KeyboardShortcutsAnswer>): ReactElement {
  const { _ } = useLingui();
  const titleOf = (id: string): string => {
    const title = rows.find((row) => row.id === id)?.title;
    return title === undefined ? id : _(title);
  };
  return (
    <>
      {dropped.length === 0 ? null : (
        <p className="m-shortcuts-editor__note">{_(SHORTCUTS_DROPPED, { commands: dropped.map(titleOf).join(', ') })}</p>
      )}
      <DialogScroll label={_(KEYBOARD_SHORTCUTS_TITLE)}>
        <ShortcutList rows={rows} editor={undefined} />
      </DialogScroll>
      <DialogFooter dismissal="close" />
    </>
  );
}
