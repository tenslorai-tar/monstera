import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { DOCUMENT_TOOLS_LABEL } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import { quickToolbarModel } from './projections.js';

/**
 * §10.3's floating quick toolbar, as a **projection of the command registry**.
 *
 * ## It names no command, and `check:secondwiring` is the mechanism
 *
 * This renders `quickToolbarModel(...)` and knows nothing about what is in it.
 * Registering a command with a `quick-toolbar` placement is the whole of putting
 * it here, and removing the registration removes the control with nothing to
 * edit — which is §7's *"there is no second place where a feature is wired"*
 * applied to the surface where it is easiest to break.
 *
 * ## Rendered only when it has something in it
 *
 * The model is empty when no document is focused, because every command placed
 * here declares `when: hasDocument`. An empty pill floating on the start screen
 * would be a container that looks like a surface under construction, which
 * §10.4 bans in the same sentence as a control that does nothing.
 *
 * That is a decision about **emptiness**, not about documents: this component
 * asks the model what it holds and never asks whether a document is open. A
 * surface that consulted application state would be deciding its own contents.
 *
 * ## Labelled, because a group of controls needs a name
 *
 * `aria-label` on a `toolbar` role: without it a screen reader announces an
 * unnamed group of three buttons, and B9 makes accessibility substrate rather
 * than a later pass. The label is a `MessageKey` like every other visible
 * string, resolved by `useLingui` so a locale change re-renders it.
 *
 * ## THERE IS NO VISIBILITY TOGGLE YET, and that is deliberate
 *
 * `projections.ts` notes that this toolbar's visibility is itself a command, so
 * that a hidden toolbar can be restored from the palette. The palette does not
 * exist. Registering a toggle now would ship a control that can hide this
 * toolbar with no way to bring it back — a working button whose effect is
 * irreversible, which is worse than the missing feature. It lands with the
 * palette, in the same commit, for that reason.
 */
export interface QuickToolbarProps {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
}

export function QuickToolbar({ registry, context }: QuickToolbarProps): ReactElement | null {
  const { i18n } = useLingui();
  const entries = quickToolbarModel(registry, context);
  if (entries.length === 0) return null;

  return (
    <div className="m-quick-toolbar" role="toolbar" aria-label={i18n._(DOCUMENT_TOOLS_LABEL)}>
      {entries.map((entry) => (
        <Button
          key={entry.command.id}
          label={entry.command.title}
          onClick={() => {
            // Not awaited, for `StartScreen`'s reason: a click handler returning
            // a promise would make React's event handling wait on IPC, and
            // nothing here reads the result — the command reports through its
            // own callback.
            void entry.command.run(context);
          }}
        />
      ))}
    </div>
  );
}
