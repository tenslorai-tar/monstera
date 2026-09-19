import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import heroLogo from '../../../../assets/brand/logo-hero.png';
import type { OpenProblem } from '../commands/openDocument.js';
import {
  START_ABSENT,
  START_AT_CAPACITY,
  START_PRODUCT,
  START_TAGLINE,
  START_TITLE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { ToolButton } from '../primitives/ToolButton.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import { startScreenModel } from './projections.js';

/**
 * The start screen, as a **projection** of the command registry (§10.3).
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
 * ## Three slots, and this draws two of them
 *
 * A placement names its slot (ADR-0068): `primary` is §10.3's one green button
 * under the hero, drawn with its command's chord; `shortcut` is the grid of
 * feature shortcuts, drawn only when a command is placed there; `footer` belongs to
 * `StartFooter`, which the shell draws after the recent list, because §10.3 puts the
 * recent files *"below the grid"* and the footer below them.
 *
 * ## The hero is the supplied artwork, and it is not a command
 *
 * ADR-0002: the owner's artwork is used as supplied, so there is no text wordmark —
 * the artwork carries the name, and it is this heading's accessible name. The
 * derivative is `assets/brand/logo-hero.png`, generated from the wordmark master
 * and imported, so the bundle carries 17 KB rather than the master's 1.6 MB. "PDF
 * EDITOR" and the tagline stay beneath it.
 *
 * ## A GRID of what this build can do, not a grid of what it will
 *
 * Every tile of a panel of eventual capabilities is a control with nothing behind
 * it — the display-only defect, at the scale of a whole screen. What is laid out
 * here is the projection: the commands that exist, each of which works.
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
  const { primary, shortcut } = startScreenModel(registry, context);

  return (
    <div className="m-start-screen">
      <div className="m-start-hero">
        <h1 className="m-start-title">
          <img className="m-start-logo" src={heroLogo} alt={_(START_TITLE)} />
        </h1>
        <p className="m-start-product">{_(START_PRODUCT)}</p>
        <p className="m-start-tagline">{_(START_TAGLINE)}</p>
      </div>
      <div className="m-start-primary">
        {primary.map((entry) => (
          <Button
            key={entry.command.id}
            label={entry.command.title}
            variant="primary"
            chord={entry.command.shortcut}
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
      {shortcut.length === 0 ? null : (
        <div className="m-start-shortcuts">
          {shortcut.map((entry) =>
            // A GLYPH OVER ITS CAPTION, the ribbon's own button: the registry refuses a start-screen placement with no
            // icon (`DRAWS_A_GLYPH`), so the `undefined` arm is one the type needs and no registration reaches.
            entry.command.icon === undefined ? null : (
              <ToolButton
                key={entry.command.id}
                label={entry.command.title}
                icon={entry.command.icon}
                onClick={() => {
                  void entry.command.run(context);
                }}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
