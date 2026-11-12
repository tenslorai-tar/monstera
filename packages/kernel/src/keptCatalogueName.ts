/**
 * The kept font catalogue's NAME, apart from what reads it
 * ([ADR-0293](../../../docs/DECISIONS/0293-the-font-catalogue-is-read-once-by-a-host-that-holds-no-document-and-kept.md)).
 *
 * `main` copies the file by this name and never parses it, so this module is what the kernel's barrel gives `main`: the
 * name and the fingerprint's rule, and no route to `keptCatalogue.ts`' parser. Its hosts take both.
 */

/** A fingerprint as ADR-0237 makes it: SHA-256, hex. Anything else names no file, so no path can be built from it. */
export const KEPT_FINGERPRINT = /^[0-9a-f]{64}$/u;

/** The file a fingerprint's catalogue is kept in, inside an area. */
export function keptCatalogueName(fingerprint: string): string {
  if (!KEPT_FINGERPRINT.test(fingerprint)) throw new Error('a kept catalogue is named by a SHA-256 fingerprint, and this is not one');
  return `${fingerprint}.catalogue.json`;
}

/** Whether a file in a kept area is a kept catalogue, of whichever fingerprint: what `main` removes when another is placed. */
export function isKeptCatalogueName(name: string): boolean {
  return name.endsWith('.catalogue.json') && KEPT_FINGERPRINT.test(name.slice(0, -'.catalogue.json'.length));
}
