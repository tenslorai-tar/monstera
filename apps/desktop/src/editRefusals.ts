import {
  EditRefusedError,
  NothingToReplaceError,
  TextNotInPlaceError,
  TextNotWritableError,
  UnregisteredWriterError,
} from '@monstera/kernel';
import type { DeclaredFailure } from '@monstera/shared';

/**
 * The refusals an edit's rewrite answers, as the failures the renderer reads, or `undefined` for anything else.
 *
 * A PDFium page rewrite refuses at a named step, or reads back with characters its font could not carry
 * ([ADR-0169](../../../docs/DECISIONS/0169-a-pdfium-rewrite-is-saved-only-when-it-reads-back-as-edited.md)), and an
 * undo or a redo runs the same rewrite as the edit it reverses, so all three answer these two. The step, the number
 * PDFium answered and the characters the person typed travel with the code; nothing a native library wrote does.
 */
export function rewriteRefusalOf(thrown: unknown): DeclaredFailure<'edit-refused' | 'text-not-writable'> | undefined {
  if (thrown instanceof EditRefusedError) {
    return { code: 'edit-refused', detail: { step: thrown.step, engineError: thrown.engineError } };
  }
  if (thrown instanceof TextNotWritableError) return { code: 'text-not-writable', detail: { characters: thrown.characters } };
  return undefined;
}

/**
 * {@link rewriteRefusalOf}, and the three refusals only an edit can meet before anything is rewritten: no single text
 * object holds a word at its point (ADR-0156), a replacement that would change nothing (ADR-0169 Decision 6), and an
 * engine this installation was assembled without.
 *
 * ONE RULE for every route an edit takes, `document.execute` and `document.editCopy` alike. Each route spelt its own,
 * and the copy route's knew four of the codes the direct route knew, so an edit refused on a copy could not say what the
 * same edit said in place.
 */
export function editRefusalOf(
  thrown: unknown,
):
  | DeclaredFailure<'edit-refused' | 'text-not-writable' | 'text-not-in-place' | 'nothing-to-replace' | 'engine-unavailable'>
  | undefined {
  // A PROPERTY OF THE MACHINE: the composition root leaves a writer genuinely absent where no host for it could be built,
  // a state the shipped product is deliberately in, so it is a sentence and never an incident id. Which engine is ours.
  if (thrown instanceof UnregisteredWriterError) return { code: 'engine-unavailable' };
  // ONE OCCURRENCE NO SINGLE TEXT OBJECT HOLDS AT ITS POINT: nothing written, and the person can edit the line instead.
  if (thrown instanceof TextNotInPlaceError) return { code: 'text-not-in-place' };
  // A REPLACEMENT THAT WOULD CHANGE NOTHING, refused before the bus recorded anything: the version has not moved.
  if (thrown instanceof NothingToReplaceError) return { code: 'nothing-to-replace' };
  return rewriteRefusalOf(thrown);
}
