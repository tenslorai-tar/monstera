import type { ContractClient, TrocrSize } from '@monstera/contract';

import { COMMAND_PROBLEM_DIALOG_ID } from '../dialogs/commandProblem.js';
import { GROUP_OCR, HANDWRITING_CLEAR_TITLE, HANDWRITING_FETCH_TITLE } from '../messages/en.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';

/**
 * Getting the handwriting engine's models, and getting rid of them.
 *
 * ## Why the download is a command a reader runs, and not something that happens
 *
 * TrOCR is **never bundled** — 67 MB for the smaller model and 339 MB for the
 * larger, downloaded on demand (`BUILD-PROMPT.md`:806, ADR-0052). A build that
 * fetched that quietly the first time somebody dragged a box would be spending a
 * reader's bandwidth and disk on a decision they never made.
 *
 * So the handwriting **tool** is hidden until the models are here — the registry's
 * `when` predicate, which is what this project already uses for *this does not
 * exist yet* — and this is what a reader meets instead. The wired-tools rule from
 * both ends: no control that cannot work, and no work no control asked for.
 *
 * ## And removing them is the other end of the same row
 *
 * `BUILD-PROMPT.md`:627's *clear caches (TrOCR models, thumbnails)*. It lands
 * with the row rather than after it: a feature that writes hundreds of megabytes
 * into a reader's profile with no way to remove them is not finished.
 *
 * ## THE OBSERVABLE EFFECT IS THE TOOL APPEARING, and there is no notice dialog
 *
 * Deliberately. A dialog saying *done* is a second thing to dismiss and it is
 * not evidence — where the handwriting tool appearing in the ribbon is, and its
 * disappearing after a clear is evidence the other way. A failure does open a
 * dialog, through the one primitive every other command uses for a refused
 * channel call.
 *
 * ## What is NOT here, and it is a real gap rather than an omission
 *
 * **Progress.** The fetch is one channel call that returns when the last file
 * has landed, so a reader on a slow connection sees a control that is busy for
 * minutes with nothing said. `fetchHandwritingModel` in main already reports per
 * file — the surface for it is what does not exist, and inventing one here would
 * need a progress channel this row does not have. Stated rather than hidden.
 */

/** What either command needs. */
export interface HandwritingModelDeps {
  readonly client: ContractClient;
  /** Which model the setting names, read at run time rather than captured. */
  readonly size: () => TrocrSize;
  /** Shows a dialog. The primitive, as every other command uses it. */
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  /**
   * Called when the cache's state changed, so the tool's `when` predicate has
   * something new to read.
   *
   * Without it the handwriting tool stays hidden until something else happened
   * to re-query — a control that appears eventually, which reads as a download
   * that did not work.
   */
  readonly onChanged: () => void;
}

/** Downloads whatever this machine is missing for the chosen model size. */
export function fetchHandwritingModelCommand(deps: HandwritingModelDeps): UiCommand {
  return {
    // `<domain>.<kebab-name>`, which is the registry's grammar rather than a
    // style: `check:secondwiring` matches ids by it, so an id outside it is
    // invisible to the scan that forbids a second wiring place.
    id: 'app.fetch-handwriting-model',
    title: HANDWRITING_FETCH_TITLE,
    // TOOLS › OCR, beside the recognition commands it serves.
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_OCR, order: 40 }],
    // NO DOCUMENT REQUIRED, deliberately: this is about the machine rather than
    // about a document, and a reader who wants the models before opening
    // anything should not have to open something first.
    when: () => true,
    run: async (_context: CommandContext): Promise<void> => {
      const fetched = await deps.client['app.fetchHandwritingModel']({ size: deps.size() });
      // TOLD EITHER WAY, because a partial fetch changed the machine too — three
      // of five files landing is a different state from none, and the predicate
      // must read what is actually there rather than what this call returned.
      deps.onChanged();
      if (!fetched.ok) await deps.ask(COMMAND_PROBLEM_DIALOG_ID, fetched.error);
    },
  };
}

/** Removes the downloaded runtime and models. */
export function clearHandwritingCacheCommand(deps: HandwritingModelDeps): UiCommand {
  return {
    id: 'app.clear-handwriting-cache',
    title: HANDWRITING_CLEAR_TITLE,
    placements: [{ surface: 'ribbon', section: 'tools', group: GROUP_OCR, order: 50 }],
    when: () => true,
    run: async (_context: CommandContext): Promise<void> => {
      const cleared = await deps.client['app.clearHandwritingCache']({});
      // THIS DIRECTION MATTERS MORE than the other: the tool must DISAPPEAR,
      // because the models it needs are gone and a drag would now fail.
      deps.onChanged();
      if (!cleared.ok) await deps.ask(COMMAND_PROBLEM_DIALOG_ID, cleared.error);
    },
  };
}

/** Both, for the registry. */
export function handwritingModelCommands(deps: HandwritingModelDeps): readonly UiCommand[] {
  return [fetchHandwritingModelCommand(deps), clearHandwritingCacheCommand(deps)];
}
