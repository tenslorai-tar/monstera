import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import type { OpenProblem } from '../commands/openDocument.js';
import { START_ABSENT, START_AT_CAPACITY, START_INVITATION, START_TITLE } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import { startScreenModel } from './projections.js';

/**
 * The start screen, as a **projection** of the command registry.
 *
 * ## There is no list here, and that is the whole design
 *
 * §7: the ribbon, the floating toolbar, context menus, the palette, the shortcut
 * map and this are all projections of one registry, and *"a hand-maintained
 * layout file for any surface is exactly the second wiring place the registry
 * exists to forbid."* So this component renders `startScreenModel(...)` and
 * knows the name of no command — adding one is a registration, and removing one
 * removes it from here with nothing to edit.
 *
 * `check:secondwiring` reads this directory and fails on a module that names a
 * command id, which is the mechanical half of the same rule.
 *
 * ## Every control here dispatches, because the model only contains ones that do
 *
 * `UiCommand.run` is required, so a projected entry cannot be a control with
 * nothing behind it. What the type cannot catch is an empty `run`, which is what
 * the wired-tools test PAIR is for — a UI test that the control dispatches, and
 * a kernel proof that the dispatch has an effect.
 *
 * ## A GRID of what this build can do, not a grid of what it will
 *
 * The row this screen answers says *features grid*, and the temptation is a
 * panel of the application's eventual capabilities. Every tile of that is a
 * control with nothing behind it — the display-only defect, at the scale of a
 * whole screen and on the first one a reader sees. What is laid out here is the
 * projection: the commands that exist, each of which works.
 *
 * ## AN ERROR IS SHOWN HERE, and until 2026-09-03 it was shown nowhere
 *
 * `openDocumentCommand` returned silently for every outcome that was not a
 * document, so picking a file that had been moved produced no feedback at all.
 * Inline rather than a dialog: the reader is looking at this screen, the
 * message belongs beside the control they just used, and a modal for *that file
 * is not there* is a ceremony for a thing they can simply try again.
 */
export interface StartScreenProps {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  /** The last open that ended with no document, or none. */
  readonly problem: OpenProblem | undefined;
}

export function StartScreen({ registry, context, problem }: StartScreenProps): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-start-screen">
      <h1 className="m-start-title">{_(START_TITLE)}</h1>
      <p className="m-start-invitation">{_(START_INVITATION)}</p>
      <div className="m-start-actions">
        {startScreenModel(registry, context).map((entry) => (
          <Button
            key={entry.command.id}
            label={entry.command.title}
            variant="primary"
            onClick={() => {
              // Not awaited, and the shape is `dispatchChord`'s for the same
              // reason: a click handler that returned a promise would make React's
              // event handling wait on IPC, and nothing here has anything to do
              // with the result — the command reports through its own callback.
              void entry.command.run(context);
            }}
          />
        ))}
      </div>
      {problem === undefined ? null : (
        // `role="alert"`, not the polite region the status bar uses: this
        // appears in response to something the reader just did and there is
        // nothing else on screen that answers them. A polite region would queue
        // behind whatever a screen reader was saying about the button.
        <p className="m-start-problem" role="alert">
          {_(problem === 'absent' ? START_ABSENT : START_AT_CAPACITY)}
        </p>
      )}
    </div>
  );
}
