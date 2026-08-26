import { type RegisteredWriter, localMupdfExecution } from './commandSpecs.js';
import { mupdfWriter } from './mupdfWriter.js';

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
export const localMupdfWriter: RegisteredWriter<'mupdf'> = {
  ...mupdfWriter,
  ...localMupdfExecution,
};
