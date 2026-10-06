import { serialiseIntoFile } from './checkpointFile.js';
import { type RegisteredWriter, localMupdfExecution } from './commandSpecs.js';
import type { MupdfSession } from './engineSeam.js';
import { mupdfWriter } from './mupdfWriter.js';
import { NO_TIMESTAMPS, type RequestTimestamp, signpdfExecutionWith } from './documentSign.js';
import { applyPdfLibImage, hostedPdfLibExecution } from './pdfLibWriter.js';
import { stagedBytes } from './savePipeline.js';
import { prepareSignature } from './signaturePlaceholder.js';

/**
 * The MuPDF writer assembled for a process that holds the session itself
 * (ADR-0023 Decision 10).
 *
 * ## Why this is a third file and not a property of either half
 *
 * The two halves cannot be assembled where either of them lives, and the reason
 * is the module graph rather than taste. `commandSpecs.ts` declares what a
 * command's `apply` is; `rotatePages.ts` implements it and reaches the native
 * document through `withDocument`, which `mupdfWriter.ts` exports. So
 * `mupdfWriter.ts` naming `declaredSpecs` would close a cycle —
 * `mupdfWriter → commandSpecs → rotatePages → mupdfWriter` — and the assembly
 * has to sit downstream of both.
 *
 * That is worth stating because the tidy-looking alternative is to give
 * `mupdfWriter` the execution members directly, and it is unbuildable for a
 * structural reason that would otherwise be rediscovered by whoever tries.
 *
 * ## The word LOCAL is the whole distinction
 *
 * Not "the real one" and not "the default". Decision 10's split is *where the
 * session is*: this object runs a command against a session in **this** process,
 * and a remote writer sends the command to the process that holds one. Both are
 * real, and the engine host will register exactly this object — `packages/kernel`
 * is the host body, so the host's dispatch is this assembly rather than a
 * host-side copy of it.
 *
 * Nothing in main registers this today, and that is invariant 20 rather than an
 * omission: `mupdfWriter` binds native code, and no native engine code runs in
 * the main process. `composition.ts` registers an empty `CommandBus` until a
 * remote writer exists to put there.
 */
/**
 * pdf-lib, hosted beside a MuPDF session in THIS process — what the MuPDF host does, run where a test holds the
 * session ([ADR-0121](../../../docs/DECISIONS/0121-main-never-holds-two-images.md) Decision 3).
 *
 * The apply serialises the session, runs the spec on the image and stages the result as bytes in hand; the bus then
 * rebuilds the session from it through `adopt`, as it does for the host. Its checkpoint is the session's serialise,
 * which is MuPDF's — the same bytes the image was made from.
 */
export const localPdfLibWriter: RegisteredWriter<'pdf-lib'> = {
  serialise: (session) => mupdfWriter.serialise(session),
  serialiseInto: serialiseIntoFile((session: MupdfSession) => mupdfWriter.serialise(session)),
  ...hostedPdfLibExecution(async (session, command, reads) =>
    stagedBytes(await applyPdfLibImage(await mupdfWriter.serialise(session), command, reads)),
  ),
};

/**
 * The signer, its placeholder prepared beside a MuPDF session in THIS process — what the MuPDF host does — and its
 * signature made by the same execution `main` registers ([ADR-0148](../../../docs/DECISIONS/0148-signings-parse-runs-in-the-mupdf-host-and-main-keeps-only-the-key.md)).
 * The bus rebuilds the session from the signed bytes through `adopt`, as it does for the host.
 *
 * @param requestTimestamp a timestamp port; without one a command asking for a timestamp is refused as unreachable
 */
export function localSignpdfWriterWith(requestTimestamp: RequestTimestamp): RegisteredWriter<'signpdf'> {
  return {
    serialise: (session) => mupdfWriter.serialise(session),
    serialiseInto: serialiseIntoFile((session: MupdfSession) => mupdfWriter.serialise(session)),
    ...signpdfExecutionWith(
      async (session, request) => prepareSignature(await mupdfWriter.serialise(session), request),
      requestTimestamp,
    ),
  };
}

/** {@link localSignpdfWriterWith} with no timestamp port. */
export const localSignpdfWriter: RegisteredWriter<'signpdf'> = localSignpdfWriterWith(NO_TIMESTAMPS);

export const localMupdfWriter: RegisteredWriter<'mupdf'> = {
  ...mupdfWriter,
  // The session is in this process, so a checkpoint is its bytes written out (ADR-0121).
  serialiseInto: serialiseIntoFile((session: MupdfSession) => mupdfWriter.serialise(session)),
  ...localMupdfExecution,
};
