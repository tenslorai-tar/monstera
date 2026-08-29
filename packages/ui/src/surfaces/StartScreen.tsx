import type { ReactElement } from 'react';

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
 */
export interface StartScreenProps {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
}

export function StartScreen({ registry, context }: StartScreenProps): ReactElement {
  return (
    <div className="m-start-screen">
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
  );
}
