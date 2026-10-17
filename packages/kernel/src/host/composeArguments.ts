/**
 * The native MuPDF library's path, when the factory gave the compose host one — its second argument, as PDFium's host
 * takes `pdfium.dll`'s. ABSENT is a real state and not a refusal, unlike the pipe: this host composes imports without
 * it, and Optimize answers `unavailable`. Empty is absent, for `pdfiumLibraryPath`'s measured reason — a shell
 * expanding an unset variable passes `''`.
 *
 * ONE READING for the launcher, which binds the library before it connects, and the module that serves, which builds
 * Optimize only where it was bound ([ADR-0251](../../../../docs/DECISIONS/0251-a-host-reaches-its-pipe-before-it-loads-its-handlers.md)):
 * two spellings of the rule could disagree about whether the library is there.
 */
export function composeShimPathOf(argv: readonly string[]): string | null {
  const path = argv[3];
  return path === undefined || path.length === 0 ? null : path;
}
