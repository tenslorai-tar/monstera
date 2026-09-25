import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { FOCUS_HINT } from '../messages/en.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import { shortcutMapOf } from './projections.js';

/** The way out of Focus is the chord §10.3 names: *"Esc returns"*. */
const LEAVE_CHORD = 'escape';

/**
 * v5-07's note at the top of the page in Focus mode: *"Focus mode · Esc to return"*.
 *
 * ## The key is read off the shortcut map, and only while it works
 *
 * StartFooter's F1 rule: a sentence naming a key that does nothing is the wired-tools defect in a line of
 * text. So the note is drawn only while the map binds Escape to a command that is available in this context —
 * Leave Focus, whose `when` is Focus mode itself — and it prints that command's own spelling of the chord.
 * Looked up by CHORD, not by command id, because a surface naming a command is what `check:secondwiring`
 * refuses.
 */
export function FocusHint({
  registry,
  context,
}: {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
}): ReactElement | null {
  const { _ } = useLingui();
  const leave = shortcutMapOf(registry).get(LEAVE_CHORD);
  if (leave?.shortcut === undefined || !(leave.when?.(context) ?? true)) return null;
  // THE COMMAND'S OWN SPELLING, as the keyboard list shows it — v5-07 writes *Esc*, and a short form made here
  // would be a second spelling of one chord.
  return <p className="m-focus-hint">{_(FOCUS_HINT, { chord: leave.shortcut })}</p>;
}
