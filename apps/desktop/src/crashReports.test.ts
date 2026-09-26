import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCrashReports } from './crashReports.js';
import type { ShareDestination, ShareOffer } from './sharing.js';

/**
 * Crash reports that stay on this computer until the person shares one (ADR-0109), against a real folder laid out the
 * way Crashpad writes one — a `reports` folder of `.dmp` files — with files of the case's own making.
 */

const made: string[] = [];
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A crash-dump folder with the named dumps, each written at the given second. */
function folderWith(dumps: Readonly<Record<string, number>>): { readonly root: string; readonly folder: string } {
  const root = mkdtempSync(join(tmpdir(), 'monstera-crash-'));
  made.push(root);
  const folder = join(root, 'Crashpad');
  mkdirSync(join(folder, 'reports'), { recursive: true });
  for (const [name, second] of Object.entries(dumps)) {
    const path = join(folder, 'reports', name);
    writeFileSync(path, `dump ${name}`);
    utimesSync(path, second, second);
  }
  // NOT A REPORT: Crashpad keeps other files beside them, and none of them may be offered or deleted.
  writeFileSync(join(folder, 'settings.dat'), 'crashpad settings');
  return { root, folder };
}

function sheet(refuse = false): { readonly destination: ShareDestination; readonly offers: ShareOffer[] } {
  const offers: ShareOffer[] = [];
  return {
    offers,
    destination: {
      offer: (offer) => {
        if (refuse) return Promise.reject(new Error('the sheet refused'));
        offers.push(offer);
        return Promise.resolve();
      },
    },
  };
}

const LOG = [{ fileName: 'shell.log', bytes: new TextEncoder().encode('log') }] as const;

describe('crash reports (ADR-0109)', () => {
  it('offers the NEWEST report not yet offered, by its name and time — and none where there is no folder', async () => {
    const { root, folder } = folderWith({ 'older.dmp': 1_000, 'newer.dmp': 2_000 });
    const reports = createCrashReports({ folder, offeredFile: join(root, 'offered.json'), share: null, logFiles: () => Promise.resolve(LOG) });
    expect(await reports.pending()).toStrictEqual({ id: 'newer.dmp', crashedAt: new Date(2_000_000).toISOString() });

    // DISMISSED IS SHOWN: the next start offers the other one, and then nothing.
    await reports.dismiss('newer.dmp');
    expect((await reports.pending())?.id).toBe('older.dmp');
    await reports.dismiss('older.dmp');
    expect(await reports.pending()).toBeNull();

    const none = createCrashReports({ folder: join(root, 'absent'), offeredFile: join(root, 'o2.json'), share: null, logFiles: () => Promise.resolve(LOG) });
    expect(await none.pending()).toBeNull();
  });

  it('SHARES the report with the log beside it, through the sheet, and counts it as offered', async () => {
    const { root, folder } = folderWith({ 'crash.dmp': 1_000 });
    const { destination, offers } = sheet();
    const reports = createCrashReports({ folder, offeredFile: join(root, 'offered.json'), share: destination, logFiles: () => Promise.resolve(LOG) });

    expect(await reports.share('crash.dmp')).toBe('offered');
    expect(offers).toHaveLength(1);
    expect(offers[0]?.files.map((file) => file.fileName)).toStrictEqual(['crash.dmp', 'shell.log']);
    expect(new TextDecoder().decode(offers[0]?.files[0]?.bytes)).toBe('dump crash.dmp');
    expect(await reports.pending()).toBeNull();
  });

  it('CONTROL: with no sheet, or a sheet that refuses, nothing is marked — the offer comes back next time', async () => {
    const { root, folder } = folderWith({ 'crash.dmp': 1_000 });
    const without = createCrashReports({ folder, offeredFile: join(root, 'offered.json'), share: null, logFiles: () => Promise.resolve(LOG) });
    expect(await without.share('crash.dmp')).toBe('unavailable');
    expect((await without.pending())?.id).toBe('crash.dmp');

    const refusing = createCrashReports({
      folder,
      offeredFile: join(root, 'offered.json'),
      share: sheet(true).destination,
      logFiles: () => Promise.resolve(LOG),
    });
    expect(await refusing.share('crash.dmp')).toBe('failed');
    expect((await refusing.pending())?.id).toBe('crash.dmp');
  });

  it('an id is matched by NAME among the reports, never joined onto a path', async () => {
    const { root, folder } = folderWith({ 'crash.dmp': 1_000 });
    writeFileSync(join(root, 'secret.dmp'), 'outside the folder');
    const { destination, offers } = sheet();
    const reports = createCrashReports({ folder, offeredFile: join(root, 'offered.json'), share: destination, logFiles: () => Promise.resolve(LOG) });
    for (const id of ['../../secret.dmp', 'reports/crash.dmp', 'nothing.dmp']) {
      expect(await reports.share(id), id).toBe('gone');
    }
    expect(offers).toStrictEqual([]);
  });

  it('CLEAR deletes every report and nothing else — Settings › Privacy turned off', async () => {
    const { root, folder } = folderWith({ 'a.dmp': 1_000, 'b.dmp': 2_000 });
    const reports = createCrashReports({ folder, offeredFile: join(root, 'offered.json'), share: null, logFiles: () => Promise.resolve(LOG) });
    await reports.clear();
    expect(readdirSync(join(folder, 'reports'))).toStrictEqual([]);
    // CONTROL: Crashpad's own file is untouched.
    expect(readdirSync(folder)).toContain('settings.dat');
  });
});
