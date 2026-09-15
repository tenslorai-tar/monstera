import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import { SHORTCUTS_CHORD_HEADER, SHORTCUTS_COMMAND_HEADER } from '../messages/en.js';

/**
 * The keyboard shortcuts dialog's body: one row per chord, the command's title against the keys that run it.
 *
 * A TABLE, because the content is one — a pairing a screen reader should announce as *Open PDF…, Ctrl+O* rather than
 * as two unrelated lines. The rows arrive in the order the list put them in; this sorts nothing.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function KeyboardShortcutsBody({
  entries,
}: {
  readonly entries: readonly { readonly chord: string; readonly title: MessageKey }[];
}): ReactElement {
  const { _ } = useLingui();

  return (
    <table className="m-shortcuts">
      <thead>
        <tr>
          <th scope="col">{_(SHORTCUTS_COMMAND_HEADER)}</th>
          <th scope="col">{_(SHORTCUTS_CHORD_HEADER)}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          // THE CHORD IS THE KEY: the shortcut map refuses two commands on one chord, so it is unique by construction.
          <tr key={entry.chord}>
            <td>{_(entry.title)}</td>
            <td>
              <kbd>{entry.chord}</kbd>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
