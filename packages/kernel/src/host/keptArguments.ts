import type { CatalogueReading } from '../fontCatalogue.js';
import { keptOrRead } from '../keptCatalogue.js';

/**
 * Where a host that sets text was told its kept catalogue is
 * ([ADR-0293](../../../../docs/DECISIONS/0293-the-font-catalogue-is-read-once-by-a-host-that-holds-no-document-and-kept.md)
 * Decision 6): the kept area and the fingerprint, the two arguments after the installed fonts' folder, at the same
 * places on the MuPDF, PDFium and compose hosts' command lines. ONE READING for the three, so they cannot disagree about
 * which arguments say it.
 */
export const KEPT_AREA_ARGUMENT = 6;

/**
 * The reading a host binds its faces through: the kept file where both arguments are there, through `keptOrRead`, which
 * falls back to `read`; `read` alone where either is absent, which is a host started before `main` knew the
 * fingerprint, or a launcher that kept none. `refused` hears why a file present was not taken.
 */
export function catalogueReadingFrom(argv: readonly string[], read: CatalogueReading, refused: (why: string) => void): CatalogueReading {
  const area = argv[KEPT_AREA_ARGUMENT];
  const fingerprint = argv[KEPT_AREA_ARGUMENT + 1];
  if (area === undefined || area.length === 0 || fingerprint === undefined || !/^[0-9a-f]{64}$/u.test(fingerprint)) return read;
  return keptOrRead(area, fingerprint, read, refused);
}

/** What a host writes when its kept file was refused: its diagnostics log, the inherited stderr, as an incident is. */
export function noteKeptRefused(why: string): void {
  process.stderr.write(`MONSTERA_HOST_NOTE the kept font catalogue was not taken (${why}); the font folders were read\n`);
}
