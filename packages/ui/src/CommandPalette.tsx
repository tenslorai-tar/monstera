import { useLingui } from '@lingui/react';
import { type ReactElement, useMemo, useRef, useState } from 'react';

import { CLOSE_LABEL, PALETTE_EMPTY, PALETTE_LABEL, PALETTE_PLACEHOLDER } from './messages/en.js';
import { Dialog } from './primitives/Dialog.js';
import type { CommandContext, CommandRegistry } from './registries/commands.js';
import { paletteModel } from './surfaces/projections.js';

/**
 * Every command a reader can reach, by name.
 *
 * ## A PROJECTION, and there is no list here
 *
 * `paletteModel` is the model and this renders it. That is the registration
 * rule at its plainest: a command absent from the registry is absent here for
 * free, and one added there appears with no edit to this file. A hand-kept list
 * would be exactly the second wiring place the registry exists to forbid — and
 * the palette is the surface where that would be least visible, because nobody
 * notices a command that is merely *not offered*.
 *
 * **The model reads no placements at all**, which is what makes §7's promise
 * hold: a surface a reader has hidden can always be restored from here, and
 * that only works if the palette shows commands that appear nowhere else.
 *
 * ## Filtering is a plain substring match, and deliberately so
 *
 * A palette that scored and ranked would need a second field on every command
 * and a rule about ties. What a reader does here is type the first few letters
 * of a name they already know; the model's stable id order is worth more than
 * any ranking, because a control that moves under your fingers between
 * keystrokes is harder to hit than one that does not.
 *
 * **Matched against the RENDERED title**, not the id: `view.zoom-in` is not
 * what a person types. That means the filter is locale-sensitive, which is
 * correct — a French reader searching French names finds them.
 */
export function CommandPalette({
  registry,
  context,
  onClose,
}: {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  /** Closes the palette: before a command runs, on Escape, on a press outside it, and from its Close control. */
  readonly onClose: () => void;
}): ReactElement {
  const { i18n } = useLingui();
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement | null>(null);

  const matches = useMemo(() => {
    const wanted = query.trim().toLocaleLowerCase();
    const all = paletteModel(registry, context);
    if (wanted === '') return all;
    return all.filter((command) => i18n._(command.title).toLocaleLowerCase().includes(wanted));
  }, [context, i18n, query, registry]);

  return (
    // THE ONE DIALOG PRIMITIVE (B9), and its absence was the defect. This was a `div` with `role="dialog"` and an
    // `onKeyDown`, which hears a key only while focus is inside it — and it had no outside-press handler at all. So the
    // first click a person made anywhere outside moved focus out, and nothing could close it again (live, 2026-09-17).
    // Base UI's dismissal listens on the document and traps focus, which is every route at once, and it consumes the
    // Escape it acts on, so `view.leave-focus` on the document never also runs.
    //
    // FOCUS OPENS ON THE FIELD, because the chord that opened the palette says the person is about to type.
    <Dialog
      closeLabel={CLOSE_LABEL}
      initialFocus={field}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open
      popupClassName="m-palette"
      title={PALETTE_LABEL}
    >
      <input
        ref={field}
        className="m-palette-query"
        type="text"
        value={query}
        aria-label={i18n._(PALETTE_PLACEHOLDER)}
        placeholder={i18n._(PALETTE_PLACEHOLDER)}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {matches.length === 0 ? (
        <p className="m-palette-empty">{i18n._(PALETTE_EMPTY)}</p>
      ) : (
        <ul className="m-palette-list">
          {matches.map((command) => (
            <li key={command.id}>
              <button
                type="button"
                className="m-palette-item"
                onClick={() => {
                  // CLOSED FIRST, so a command that opens a dialog of its own opens it with no modal still above it.
                  onClose();
                  // NOT AWAITED, for `QuickToolbar`'s reason: a click handler
                  // returning a promise makes React's event handling wait on
                  // IPC, and nothing here reads the result — a command reports
                  // through its own callback.
                  void command.run(context);
                }}
              >
                <span className="m-palette-title">{i18n._(command.title)}</span>
                {command.shortcut === undefined ? null : (
                  <kbd className="m-palette-chord">{command.shortcut}</kbd>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
