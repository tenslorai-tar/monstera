/**
 * A document whose protection cannot be written again as it stands.
 *
 * MuPDF keeps a protected document's own keys when IT saves, and cannot hand them to another document: a pdf-lib command
 * produces a new file, which has to be encrypted afresh from passwords. The user password is known where the document was
 * opened with it, and the owner password is known only where it was the one typed; a file stores each only as a hash.
 * Where the one that is missing cannot be replaced without taking something from a person, this says so
 * ([ADR-0220](../../../docs/DECISIONS/0220-a-pdf-lib-command-on-a-protected-document-runs-on-its-readable-bytes-and-is-written-protected.md)).
 *
 * **In a module that imports nothing**, so main's barrel can name the class, and the host's table can rebuild it from the
 * code it crossed the pipe as, without loading the engine that throws it (`signingRefusals.ts`' shape, ADR-0026's barrel
 * discipline, held by `proof:kernelload`).
 */
export class ProtectionNotReproducible extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtectionNotReproducible';
  }
}
