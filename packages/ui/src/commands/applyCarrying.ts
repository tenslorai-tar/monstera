import { type RenderableCommand, keepsTheAnnotationWalk } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import { type AnnotationSelection, carrySelection } from '../annotations/selectTool.js';
import { type Applied, type DocumentCommandDeps, applyDocumentCommand } from './documentCommands.js';

/** Replaces the selection with what a function of the current one answers — a state setter's shape. */
export type CarrySelection = (
  update: (current: AnnotationSelection | undefined) => AnnotationSelection | undefined,
) => void;

/**
 * Sends a command through `applyDocumentCommand`, and carries the selection across it when the
 * command keeps the walk
 * ([ADR-0102](../../../../docs/DECISIONS/0102-a-selection-survives-a-command-that-keeps-the-walk.md)).
 *
 * ## The version moves only once the walk has been read again
 *
 * For a command in `KEEPS_THE_ANNOTATION_WALK`, `onApplied` is held until the walk at the version the
 * command produced has been read, and then called with the carried selection in the same turn, so
 * both land in one render. Moving the version first would show *nothing selected* for the length of
 * a round trip, and the Properties tab would unmount the control a person was using between the
 * press that sent this and the release that ends it.
 *
 * **A read that fails still moves the version.** `carrySelection` then drops the selection, which
 * is what every version change did before ADR-0102: the positions are not known to name the same
 * marks, and nothing the document holds depends on a selection. A transport failure on the read is
 * that case too — the command itself succeeded and was reported as such.
 *
 * Every other command goes through unchanged.
 *
 * @returns whether the document moved, as `applyDocumentCommand` answers it
 */
export async function applyCarrying(
  deps: DocumentCommandDeps & { readonly carry: CarrySelection },
  docId: DocId,
  command: RenderableCommand,
): Promise<boolean> {
  if (!keepsTheAnnotationWalk(command)) return applyDocumentCommand(deps, docId, command);

  const held: { answer?: Applied } = {};
  const moved = await applyDocumentCommand(
    {
      ...deps,
      onApplied: (answer) => {
        held.answer = answer;
      },
    },
    docId,
    command,
  );
  const produced = held.answer;
  if (!moved || produced === undefined) return moved;

  const read = await deps.client['document.annotations']({ docId }).catch(() => undefined);
  const walk = read?.ok === true ? read.value : undefined;
  const composed = { page: command.page, version: command.version };
  deps.onApplied(produced);
  deps.carry((current) => carrySelection(current, composed, produced.version, walk));
  return true;
}
