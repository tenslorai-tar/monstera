/**
 * An appended save the writer would not use: the file it wrote does not read back as the document (`mupdfWriter.ts`'
 * `rebasedOn`). Named, so a save answers it as its own outcome and the person is asked
 * ([ADR-0291](../../../docs/DECISIONS/0291-a-certified-document-is-locked-to-what-its-certifier-allowed-and-worked-on-as-a-copy.md)
 * question 4) rather than told something went wrong; matched by NAME across the host's pipe, `StructureTooDeep`'s reason.
 *
 * In a module of its own, importing nothing, because `main` throws it too (`remoteLifecycle.ts`) and must never reach
 * the native engine's module to borrow it (invariant 20).
 */
export class AppendRefused extends Error {
  override readonly name = 'AppendRefused';

  constructor(why: string) {
    super(`The appended save wrote a file where ${why}, so it was not used.`);
  }
}
