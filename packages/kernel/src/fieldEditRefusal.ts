import type { FieldEditReason } from '@monstera/shared';

/**
 * Why a change to a form field was refused, each the person's to act on and none a defect: the one list
 * `@monstera/shared` holds.
 *
 * **In a module that imports no library**, so the table that carries this refusal across the engine host's pipe
 * (`host/hostRefusals.ts`) can name the class without loading `@cantoo/pdf-lib`. The class lived in `formFieldEdit.ts`,
 * which imports pdf-lib at load; the host's table took it from there, and every MuPDF host paid +17.7 MB at start
 * (fresh Node process, forced collection, 2026-10-08, `rssProbe.mjs` on `@cantoo/pdf-lib/cjs/index.js`) for a library it
 * runs only on the first form command.
 */
export type FieldEditRefusal = FieldEditReason;

/** A refusal of one of the three form-field commands, carrying the code the surface reads. */
export class FieldEditRefusedError extends Error {
  public constructor(
    public readonly reason: FieldEditRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'FieldEditRefusedError';
  }
}
