import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { TrocrSize } from '@monstera/contract';
import {
  HANDWRITING_HOSTS,
  type HandwritingArtefact,
  artefactsFor,
  downloadVerified,
  totalBytes,
} from '@monstera/kernel';

/**
 * Where the handwriting engine's downloaded stack lives, and what it costs.
 *
 * ## Main downloads, the host reads
 *
 * Invariant 25 gives an engine host no network, so it cannot fetch anything.
 * Main resolves this directory under `userData`, downloads what is missing
 * against a **pinned SHA-256** (invariant 9), and hands the path to the host —
 * which is `tessdata`'s pattern with the provisioning step replaced by a
 * download the reader asked for
 * ([ADR-0052](../../../docs/DECISIONS/0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md)
 * Decision 5).
 *
 * ## `userData`, not the install root
 *
 * Two reasons and either would be enough. The install root is not writable by a
 * Store-installed application, and — measured 2026-09-09, ADR-0023's correction
 * — a contained host cannot read it at all: MSIX writes a per-package
 * `S-1-15-3-…` ACE, this host's token carries `CapabilityCount: 0`, and all
 * three access-check routes are closed there. A cache under `userData` is
 * written by main and granted to the host explicitly, which is the only shape
 * that works in both configurations.
 *
 * ## What is NOT here
 *
 * The **grant**. Creating this directory with a DACL naming the host's container
 * SID needs the Win32 surface `sessionDirectories.ts` owns, and it is taken in
 * the composition root beside every other grant rather than by a module whose
 * subject is a download. Splitting it that way keeps this file runnable in a
 * unit test and on a machine with no host at all.
 */

/** The name of the directory under `userData`. */
export const HANDWRITING_CACHE_NAME = 'handwriting';

/**
 * What one size's stack needs, and how much of it this machine already has.
 *
 * ## Presence is a SIZE CHECK, not an existence check
 *
 * A file of the right name and the wrong length is a download that was
 * interrupted between `downloadVerified`'s quarantine rename and nothing — which
 * cannot happen, since the rename is atomic and only a verified file is renamed.
 * What can happen is a file put there by something else, or a partially copied
 * profile. The byte length is free to check and separates those from a complete
 * artefact; the digest is what separates a complete artefact from the right one,
 * and it is checked on every download rather than on every start.
 *
 * **The honest number to show a reader is what is MISSING**, not the total: a
 * reader agreeing to a download is agreeing to what it will actually fetch.
 */
export interface HandwritingCacheReport {
  readonly size: TrocrSize;
  readonly directory: string;
  readonly present: readonly HandwritingArtefact[];
  readonly missing: readonly HandwritingArtefact[];
  /** Bytes still to fetch. Zero means the engine can run offline. */
  readonly bytesToFetch: number;
}

async function isPresent(directory: string, artefact: HandwritingArtefact): Promise<boolean> {
  try {
    const found = await stat(join(directory, artefact.file));
    return found.isFile() && found.size === artefact.bytes;
  } catch {
    // ANY stat failure means "cannot use this file", which is the same answer
    // the caller needs — and the ordinary case on a machine that has never run
    // this feature.
    return false;
  }
}

/** Which of one size's artefacts this machine holds, and what is left to fetch. */
export async function reportHandwritingCache(
  directory: string,
  size: TrocrSize,
): Promise<HandwritingCacheReport> {
  const wanted = artefactsFor(size);
  const flags = await Promise.all(wanted.map((artefact) => isPresent(directory, artefact)));
  const present = wanted.filter((_, at) => flags[at] === true);
  const missing = wanted.filter((_, at) => flags[at] !== true);
  return { size, directory, present, missing, bytesToFetch: totalBytes(missing) };
}

/** How a download reports itself, so a surface can show progress that is real. */
export interface HandwritingDownloadProgress {
  readonly file: string;
  readonly done: number;
  readonly total: number;
}

/**
 * Fetches whatever one size is missing, verifying every file before it lands.
 *
 * **Idempotent and resumable at file granularity.** Each artefact is checked
 * before it is fetched, so a run interrupted after three files fetches the
 * remaining ones. There is no partial-file resume, deliberately: a range request
 * resumed against a changed asset is exactly the case the digest exists to catch
 * and the one where catching it costs the whole download anyway.
 *
 * @param onProgress called once per file, after it lands.
 * @throws whatever `downloadVerified` refuses with — the reason is on
 *   `DownloadRefused.reason`, so a surface need not read the message.
 */
export async function fetchHandwritingModel(
  directory: string,
  size: TrocrSize,
  onProgress?: (progress: HandwritingDownloadProgress) => void,
): Promise<HandwritingCacheReport> {
  const before = await reportHandwritingCache(directory, size);
  let done = 0;

  for (const artefact of before.missing) {
    await downloadVerified({
      url: artefact.url,
      allowedHosts: HANDWRITING_HOSTS,
      sha256: artefact.sha256,
      // THE ARTEFACT'S OWN LENGTH IS THE CEILING. It is the tightest honest
      // bound: the digest already pins the exact bytes, so anything longer is
      // not the file we pinned and there is no reason to receive it.
      maxBytes: artefact.bytes,
      destination: join(directory, artefact.file),
    });
    done += 1;
    onProgress?.({ file: artefact.file, done, total: before.missing.length });
  }

  return reportHandwritingCache(directory, size);
}

/**
 * Removes the whole cache — `BUILD-PROMPT.md`:627's *clear caches (TrOCR models,
 * thumbnails)*.
 *
 * **It lands with the row rather than after it.** A feature that writes hundreds
 * of megabytes into a reader's profile with no way to remove them is not
 * finished, which is why this is not a follow-up row.
 *
 * Removes the directory itself and not its contents one by one: the cache holds
 * only files this build downloaded, and a selective sweep would be a second
 * opinion about what belongs there.
 *
 * @returns the bytes removed, so a surface can say what it freed rather than
 *   that something happened.
 */
export async function clearHandwritingCache(directory: string): Promise<number> {
  // A SET OF FILE NAMES, because the three runtime files are in BOTH sizes'
  // lists — counting per size would report a machine holding one size as having
  // freed the runtime twice, which is a figure shown to a reader.
  const files = new Set<string>();
  for (const size of ['small', 'base'] as const) {
    for (const artefact of artefactsFor(size)) files.add(artefact.file);
  }

  let removed = 0;
  for (const file of files) {
    try {
      const found = await stat(join(directory, file));
      removed += found.size;
    } catch {
      // Absent, which is most of them on most machines.
    }
  }
  await rm(directory, { recursive: true, force: true });
  return removed;
}

/**
 * The cache as one surface, bound to a directory.
 *
 * ## Why the composition root takes this rather than a path
 *
 * That file's own rule: *each surface is a function or an object, never a path*,
 * because `app.getPath('userData')` is Electron's answer and the composition
 * root may not ask Electron anything. `entry.ts` builds this with the real path;
 * a test builds it with a scratch directory and the whole wiring runs in
 * milliseconds.
 */
export interface HandwritingCache {
  /** The directory the host is granted and reads from. */
  readonly directory: string;
  readonly report: (size: TrocrSize) => Promise<HandwritingCacheReport>;
  readonly fetch: (
    size: TrocrSize,
    onProgress?: (progress: HandwritingDownloadProgress) => void,
  ) => Promise<HandwritingCacheReport>;
  /** @returns bytes removed. */
  readonly clear: () => Promise<number>;
}

/** @param userData where Electron keeps this installation's per-user state. */
export function createHandwritingCache(userData: string): HandwritingCache {
  const directory = join(userData, HANDWRITING_CACHE_NAME);
  return {
    directory,
    report: (size) => reportHandwritingCache(directory, size),
    fetch: (size, onProgress) => fetchHandwritingModel(directory, size, onProgress),
    clear: () => clearHandwritingCache(directory),
  };
}
