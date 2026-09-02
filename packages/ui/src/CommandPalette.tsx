import { useLingui } from '@lingui/react';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';

import { PALETTE_EMPTY, PALETTE_LABEL, PALETTE_PLACEHOLDER } from './messages/en.js';
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
  /** Closes the palette. Called after a command runs, and on Escape. */
  readonly onClose: () => void;
}): ReactElement {
  const { i18n } = useLingui();
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement | null>(null);

  // FOCUSED ON OPEN, because a palette that needs a click before it accepts
  // typing is a palette a keyboard user cannot use — and the chord that opened
  // it says they are on the keyboard.
  useEffect(() => {
    field.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const wanted = query.trim().toLocaleLowerCase();
    const all = paletteModel(registry, context);
    if (wanted === '') return all;
    return all.filter((command) => i18n._(command.title).toLocaleLowerCase().includes(wanted));
  }, [context, i18n, query, registry]);

  return (
    <div
      className="m-palette"
      role="dialog"
      aria-modal="true"
      aria-label={i18n._(PALETTE_LABEL)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
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
                  // NOT AWAITED, for `QuickToolbar`'s reason: a click handler
                  // returning a promise makes React's event handling wait on
                  // IPC, and nothing here reads the result — a command reports
                  // through its own callback.
                  void command.run(context);
                  onClose();
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
    </div>
  );
}
