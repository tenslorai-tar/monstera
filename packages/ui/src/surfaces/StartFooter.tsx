import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { START_COPYRIGHT, START_F1_HINT, START_LICENCE, START_VERSION } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import { shortcutMapOf, startScreenModel } from './projections.js';

/** §10.3's footer names F1; the hint shows only while the shortcut map binds it. */
const HELP_CHORD = 'f1';

/**
 * The start screen's footer (§10.3: *"Footer: … version + © Tenslor Inc."*), laid out as v5-01 draws it: a bar
 * along the window's foot with the links on the left, the F1 hint in the middle, and the build on the right.
 *
 * ## The `footer` slot's commands, and the screen's own text beside them
 *
 * About, Settings and the diagnostics log are projected here (ADR-0068): with no
 * document the ribbon is not drawn, so without this slot they would be reachable
 * from the palette alone. They are drawn as words, the design's links, through the
 * button primitive's `quiet` variant — still buttons, since each runs a command. The
 * version, the copyright and the licence are text, not commands.
 *
 * ## Separate from `StartScreen` because of where it sits
 *
 * §10.3 puts the recent files *"below the grid"* and the footer after them. The
 * recent list is not a projection and is drawn by the shell between the two, so the
 * footer is its own surface rather than a slot `StartScreen` would have to draw
 * above or below a list it does not own.
 *
 * ## The version is `app.info`'s, and absent until main answers
 *
 * `undefined` draws no version rather than a placeholder: a footer that said
 * *Monstera* with nothing after it looks like an answer.
 *
 * ## The F1 hint is read off the shortcut map, by CHORD
 *
 * A sentence naming a key that does nothing is the wired-tools defect in a line of
 * text, so the hint is drawn only while the map binds F1, and it prints the bound
 * command's own spelling of the chord. It looks the chord up rather than a command
 * id, because a surface naming a command is what `check:secondwiring` refuses.
 */
export function StartFooter({
  registry,
  context,
  version,
}: {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  readonly version: string | undefined;
}): ReactElement {
  const { _ } = useLingui();
  const { footer } = startScreenModel(registry, context);
  const help = shortcutMapOf(registry).get(HELP_CHORD);

  return (
    <footer className="m-start-footer">
      <div className="m-start-footer__commands">
        {footer.map((entry) => (
          <Button
            key={entry.command.id}
            label={entry.command.title}
            variant="quiet"
            onClick={() => {
              // Not awaited, for `StartScreen`'s reason.
              void entry.command.run(context);
            }}
          />
        ))}
      </div>
      <p className="m-start-footer__hint">
        {help?.shortcut === undefined ? null : _(START_F1_HINT, { chord: help.shortcut })}
      </p>
      <p className="m-start-footer__build">
        {version === undefined ? null : <span>{_(START_VERSION, { version })}</span>}
        <span>{_(START_COPYRIGHT)}</span>
        <span>{_(START_LICENCE)}</span>
      </p>
    </footer>
  );
}
