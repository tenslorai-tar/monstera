// @ts-check
/**
 * What a Windows DLL exports, read from its export table.
 *
 * ## Why this exists rather than a string scan
 *
 * Measured 2026-09-08, and it cost a wrong reading before it was written. A
 * research instrument answered *does this PDFium build have `FPDFTextObj_SetText`*
 * by searching the file's bytes for that name, printed **present**, and then
 * died one line later inside `koffi.load`:
 *
 *   Error: Cannot find function 'FPDFTextObj_SetText' in shared library
 *
 * Both readings were correct. The name **is** in the file — as a string in a
 * table, or as a substring of a longer symbol — and it is **not** in the export
 * directory, which is the only list a dynamic loader consults. *Does this file
 * contain the bytes of a name* and *does this file export a function under that
 * name* are different questions with the same reassuring answer, and the first
 * is the one a `grep` can reach.
 *
 * That is `CLAUDE.md`'s search rule at the level below patterns: the scan could
 * see, its positive control passed, its root was right and its window was the
 * whole file. It was reading the wrong **structure**.
 *
 * So this module owns the question, and every caller that needs an answer about
 * a DLL's surface takes it from here rather than from a byte search (B3a).
 * `scripts/research/pdfiumBinary.mjs` keeps its byte scan and is not a second
 * opinion about this: it asks whether an interpreter is **linked**, which is a
 * question about code that need not be exported at all.
 *
 * ## The format
 *
 * Data directory 0 is the export table. The walk to it, and from its RVAs to
 * file offsets, is `peImage.mjs`'s.
 */

import { peLayout } from './peImage.mjs';

/**
 * Every name in a PE file's export directory.
 *
 * Throws rather than answering an empty set for anything it cannot parse. An
 * empty result is the shape a broken parse and a genuinely export-less DLL
 * share, and the callers of this ask *is symbol X here* — where the reassuring
 * answer is a hit for the ones they need and a miss for the ones they fear, so
 * both directions of silence have to be impossible.
 *
 * @param {Buffer} bytes the whole DLL
 * @returns {readonly string[]} the exported names, in the file's own order
 */
export function peExports(bytes) {
  const layout = peLayout(bytes);
  const exportRva = layout.directory(0).rva;
  if (exportRva === 0) return [];

  const directory = layout.fileOffset(exportRva);
  const nameCount = bytes.readUInt32LE(directory + 24);
  const namesRva = bytes.readUInt32LE(directory + 32);
  if (nameCount === 0) return [];

  const namesAt = layout.fileOffset(namesRva);
  /** @type {string[]} */
  const names = [];
  for (let index = 0; index < nameCount; index += 1) {
    const at = layout.fileOffset(bytes.readUInt32LE(namesAt + index * 4));
    const end = bytes.indexOf(0, at);
    names.push(bytes.toString('latin1', at, end));
  }
  return names;
}

/**
 * The exported names, with a caller-supplied positive control asserted first.
 *
 * The control is not optional and not defaulted. Every caller here is asking
 * whether a set of symbols is present, and a parse that silently returned the
 * wrong region would answer *absent* for all of them — which is the finding each
 * caller is looking for, produced by the reader rather than by the file.
 *
 * @param {Buffer} bytes the whole DLL
 * @param {readonly string[]} certainlyPresent names the file is known to export
 * @returns {ReadonlySet<string>}
 */
export function exportedSymbols(bytes, certainlyPresent) {
  if (certainlyPresent.length === 0) {
    throw new Error(
      'exportedSymbols needs at least one known-present name. Without one, a parse that read ' +
        'the wrong region answers "absent" for every symbol asked about, which is exactly the ' +
        'finding the caller is looking for.',
    );
  }
  const names = new Set(peExports(bytes));
  const missing = certainlyPresent.filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(
      `the export table parsed to ${String(names.size)} names and none of them are ` +
        `${missing.join(', ')}, which this file is known to export — so the parse is wrong ` +
        'and every answer it gives about other symbols is about this reader',
    );
  }
  return names;
}
