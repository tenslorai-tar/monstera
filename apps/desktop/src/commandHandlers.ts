import type { ContractHandlers } from '@monstera/contract';
import {
  DocumentBusyError,
  DocumentNotOpenError,
  StaleTargetError,
  UnregisteredWriterError,
} from '@monstera/kernel';
import { err, ok } from '@monstera/shared';

import { type DocumentCommands, DocumentPoisonedError } from './documentCommands.js';

/**
 * The first IPC handler, and the first code in this repository that answers
 * ADR-0009 §9 with something other than a promise to.
 *
 * ## What "sanitised" means here, stated because the trigger does not say it
 *
 * `kernel-error-path-sanitisation` fires on *"a handler reached
 * `DocumentService`"*, not on *"and its errors were sanitised"*. Satisfying it
 * means what this function does: return the §9 failure type. It does not mean
 * making the line go away.
 *
 * And the trap that trigger's own text names is worth repeating at the call
 * site, because this is where someone stands when they meet it: the mechanism
 * **looks finished**. `wrapHandler` already converts throws in one place, so a
 * developer arriving here finds an error boundary built and concludes the work
 * is done. It was not the conversion that was missing — it was that the thing
 * being converted carried `message`, `stack` and a recursed `cause`, and a
 * rethrown `EPERM` reads `EPERM: operation not permitted, stat '<absolute
 * path>'`.
 *
 * ## Three kinds of thing can go wrong and only two of them are outcomes
 *
 * - **A named outcome** — the document closed while this was in flight, its
 *   lane is saturated, or the supervisor has stopped rebuilding its engine
 *   session — becomes a declared code. Matched on the **class**, never
 *   on the message: wording changes silently, and the failure direction is an
 *   ordinary outcome reported to a user as an unexplained internal error.
 * - **Everything else is a defect** and is rethrown untouched. That is not
 *   laziness about error handling; it is the whole design. `wrapHandler` records
 *   the full diagnostic main-side — where the path is already known and
 *   discloses nothing — and hands the renderer `internal` plus the id of the log
 *   entry. Catching here to build a message would put the path back on the wire.
 *
 * Nothing in this file constructs an error message, and that is the property to
 * preserve. There is no free-text field in what it returns, so there is no
 * sanitiser that has to be right every time (B5).
 */
export function executeCommandHandler(
  commands: DocumentCommands,
): ContractHandlers['document.execute'] {
  return async ({ docId, command }) => {
    try {
      // TWO SCALARS CROSS, and `Executed` still does not. An entry holds an
      // inverse or a checkpoint — a whole byte image — so what the bus produced
      // never leaves main. The version says the renderer's view is stale and the
      // byte length is what it rebuilds that view against, both the same size
      // for any document.
      const applied = await commands.execute(docId, command);
      return ok(applied);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      // A DECISION, not an inconsistency. The supervisor bounded a rebuild loop
      // and refused; reporting that as `internal` would hand the renderer an
      // unexplained defect for the one failure it can actually explain to a
      // user. The count in the message stays main-side with everything else.
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      // A RACE, and the one refusal here the user can act on themselves
      // (ADR-0041 Decision 2). The renderer named a row of an answer the
      // document has moved past — an undo, or another surface's command,
      // between the read and the click. Reporting it as `internal` would tell
      // someone to quote an incident id for a document that is intact and a
      // list that has already refreshed.
      //
      // The two versions stay main-side with every other diagnostic. What the
      // renderer needs is that nothing changed and the list it is holding is
      // old, and neither number helps it say that.
      if (thrown instanceof StaleTargetError) return err({ code: 'stale-target' });
      // A PROPERTY OF THE MACHINE, and the third refusal here a user can do
      // something about. `CommandBus` refuses by name when a command's writer of
      // record has no adapter registered, and the composition root leaves
      // `writers.pdfium` genuinely absent wherever no PDFium host could be built
      // — no `pdfium.dll`, no Win32 surfaces, a packaged run.
      //
      // It reads as a DEFECT from inside the bus, correctly: a command reaching
      // it is one some surface offered. What makes it an outcome here is that
      // the surface offered it on a build assembled without that engine, which
      // is a state the shipped product is deliberately in — and `internal` would
      // hand somebody an incident id for a working application.
      //
      // The writer's NAME stays main-side with every other diagnostic. What the
      // renderer needs is that this installation cannot do it and the document
      // is untouched; which engine is missing is ours.
      if (thrown instanceof UnregisteredWriterError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
  };
}
