import type { FaceSource } from './fontCatalogue.js';

/**
 * The catalogue an in-place edit sets a word in when the run's own font cannot carry it
 * ([ADR-0173](../../../docs/DECISIONS/0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md)
 * Decision 4).
 *
 * BOUND ONCE, by whoever starts the process that edits: the PDFium host's entry binds the folder its factory passed, an
 * in-process proof binds the provisioned one. `openPdfium`'s shape, for its reason: the faces are a property of the
 * process, read once, and a handler that read them per command would make the first edit pay for a catalogue the next
 * hundred share.
 *
 * UNBOUND IS A DECIDED STATE, not a fault: a checkout that has not provisioned the fonts edits with the document's own
 * fonts alone, and a word they cannot carry is refused by name as it was before the resolver existed.
 */
let bound: (() => FaceSource) | null = null;
let read: FaceSource | null = null;
/**
 * Folders bound before the catalogue's module is loaded ({@link bindEditFolders}), which {@link loadEditFaces} turns
 * into the same binding {@link bindEditFaces} makes. Never both: each binding clears the other.
 */
let deferred: { readonly bundled: string; readonly installed: string | null } | null = null;

/**
 * Binds the catalogue, read on its first use. A second binding replaces the first, and `null` unbinds, for a proof
 * that runs its cases both ways in one process.
 */
export function bindEditFaces(faces: (() => FaceSource) | null): void {
  bound = faces;
  read = null;
  deferred = null;
}

/**
 * Binds the catalogue by its FOLDERS, without loading the module that reads them: `fontCatalogue.ts` brings HarfBuzz,
 * which the MuPDF host loads only when an edit needs a face (ADR-0177). {@link loadEditFaces} completes the binding.
 */
export function bindEditFolders(bundled: string, installed: string | null): void {
  bound = null;
  read = null;
  deferred = { bundled, installed };
}

/** Completes a {@link bindEditFolders} binding by loading the catalogue's module; nothing to do for any other. */
export async function loadEditFaces(): Promise<void> {
  const folders = deferred;
  if (folders === null) return;
  const { faceSourceOf, fontFoldersOf } = await import('./fontCatalogue.js');
  // BOUND ONLY IF NOTHING REBOUND while the module loaded, so a later binding is never overwritten by an earlier one.
  if (deferred === folders) {
    deferred = null;
    bound = () => faceSourceOf(fontFoldersOf(folders.bundled, folders.installed));
  }
}

/**
 * Whether a catalogue is bound, WITHOUT reading it: which path an edit takes is decided by this, and the read waits
 * for the first word that needs a face — so a folder that cannot be read fails that word's edit, never an edit whose
 * words the document's own fonts carry.
 */
export function editFacesBound(): boolean {
  return bound !== null || deferred !== null;
}

/**
 * The bound catalogue, read once, or `null` where this process was given none.
 *
 * @throws where folders are bound and {@link loadEditFaces} has not completed them: reading them as no catalogue would
 *   refuse a word a bundled face carries
 */
export function editFaces(): FaceSource | null {
  if (deferred !== null) throw new Error('the edit faces were bound by their folders and read before loadEditFaces completed them');
  if (bound === null) return null;
  read ??= bound();
  return read;
}
