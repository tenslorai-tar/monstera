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

/** Binds the catalogue, read on its first use. A second binding replaces the first, for a proof that rebinds. */
export function bindEditFaces(faces: () => FaceSource): void {
  bound = faces;
  read = null;
}

/** The bound catalogue, read once, or `null` where this process was given none. */
export function editFaces(): FaceSource | null {
  if (bound === null) return null;
  read ??= bound();
  return read;
}
