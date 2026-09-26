import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { CRASH_REPORTS_SETTING_ID } from '@monstera/contract';

import type { SharedFile, ShareDestination } from './sharing.js';
import { LOG_NAME, MAX_FILES } from './shellLog.js';

/**
 * Crash reports that stay on this computer until the person sends one
 * ([ADR-0109](../../../docs/DECISIONS/0109-a-crash-report-is-written-here-and-sent-only-by-the-person.md)).
 *
 * Electron's reporter writes the dumps (started in `entry.ts` with uploads off); this module only READS the folder it
 * writes to, says whether there is a report not yet offered, hands one to the Share sheet, and forgets it. Nothing here
 * opens a network connection: the only way a report leaves is the person choosing a Share target.
 *
 * ## Found by listing the folder
 *
 * With uploads off, Electron's `getLastCrashReport()` answers nothing — it lists uploaded reports only — so the folder
 * is listed here. Crashpad's layout under it is not documented as stable, so every `.dmp` beneath it counts, at any
 * depth, rather than one subfolder a version might rename.
 *
 * ## Offered once
 *
 * A report the person was shown is recorded by its file name in a small file beside the settings, so the offer is made
 * once per crash — and dismissing it, or sharing it, both count as shown.
 */

/** A report not yet offered: its file's name — never a path — and when it was written. */
export interface PendingReport {
  readonly id: string;
  readonly crashedAt: string;
}

export type ShareOutcome = 'offered' | 'unavailable' | 'failed' | 'gone';

export interface CrashReportParts {
  /** The folder Electron writes dumps to (`app.getPath('crashDumps')`). */
  readonly folder: string;
  /** The file recording which reports were offered. */
  readonly offeredFile: string;
  /** The Share sheet, or `null` on a platform with none. */
  readonly share: ShareDestination | null;
  /** The diagnostics log's files, attached beside a report. */
  readonly logFiles: () => Promise<readonly SharedFile[]>;
}

export interface CrashReports {
  readonly pending: () => Promise<PendingReport | null>;
  readonly share: (id: string) => Promise<ShareOutcome>;
  readonly dismiss: (id: string) => Promise<void>;
  /** Deletes every report — Settings › Privacy turned off. */
  readonly clear: () => Promise<void>;
}

/**
 * Whether reports are kept, from the stored settings: **on unless turned off** (ADR-0109). Only `false` turns it off —
 * a missing or malformed value is the default, since a first launch has stored nothing.
 */
export function crashReportsOn(stored: Readonly<Record<string, unknown>>): boolean {
  return stored[CRASH_REPORTS_SETTING_ID] !== false;
}

/**
 * The diagnostics log's files, to go beside a report: the live file and its rotations, oldest last, and only those —
 * `shellLog.ts` names them, and nothing else in the folder is attached.
 */
export async function logFilesIn(directory: string): Promise<SharedFile[]> {
  const names = [LOG_NAME, ...Array.from({ length: MAX_FILES - 1 }, (_unused, at) => `shell.${String(at + 1)}.log`)];
  const files: SharedFile[] = [];
  for (const fileName of names) {
    try {
      files.push({ fileName, bytes: await readFile(join(directory, fileName)) });
    } catch {
      // A ROTATION NOT YET WRITTEN is not missing: a young log has fewer files.
    }
  }
  return files;
}

/** Every `.dmp` under `folder`, at any depth, with its path and time. */
async function dumpsUnder(folder: string): Promise<{ readonly path: string; readonly written: number }[]> {
  let names: string[];
  try {
    names = await readdir(folder, { recursive: true });
  } catch {
    // NO FOLDER IS NO REPORTS: Electron creates it the first time it writes one.
    return [];
  }
  const dumps: { path: string; written: number }[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.dmp')) continue;
    const path = join(folder, name);
    const info = await stat(path);
    if (info.isFile()) dumps.push({ path, written: info.mtimeMs });
  }
  return dumps;
}

async function offeredSet(file: string): Promise<Set<string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    return new Set(Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []);
  } catch {
    return new Set();
  }
}

export function createCrashReports(parts: CrashReportParts): CrashReports {
  const markOffered = async (id: string): Promise<void> => {
    const offered = await offeredSet(parts.offeredFile);
    offered.add(id);
    await writeFile(parts.offeredFile, JSON.stringify([...offered]));
  };

  /** The report named `id`, found by its NAME among the dumps — an id is never joined onto a path. */
  const find = async (id: string): Promise<string | undefined> =>
    (await dumpsUnder(parts.folder)).find((dump) => basename(dump.path) === id)?.path;

  return {
    pending: async () => {
      const offered = await offeredSet(parts.offeredFile);
      const newest = (await dumpsUnder(parts.folder))
        .filter((dump) => !offered.has(basename(dump.path)))
        .sort((a, b) => b.written - a.written)[0];
      return newest === undefined ? null : { id: basename(newest.path), crashedAt: new Date(newest.written).toISOString() };
    },

    share: async (id) => {
      const path = await find(id);
      if (path === undefined) return 'gone';
      if (parts.share === null) return 'unavailable';
      try {
        await parts.share.offer({
          title: 'Monstera crash report',
          files: [{ fileName: id, bytes: await readFile(path) }, ...(await parts.logFiles())],
        });
      } catch {
        return 'failed';
      }
      await markOffered(id);
      return 'offered';
    },

    dismiss: async (id) => {
      await markOffered(id);
    },

    clear: async () => {
      for (const dump of await dumpsUnder(parts.folder)) await rm(dump.path, { force: true });
    },
  };
}
