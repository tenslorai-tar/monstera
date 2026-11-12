import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { keptCatalogueName } from '@monstera/kernel';
import { afterEach, describe, expect, it } from 'vitest';

import type { ContainerSid, UserSid } from './hostDacl.js';
import { type KeptAreaFiles, type KeptCatalogueParts, type RunCatalogueHost, createKeptCatalogue, keptCatalogueHolder } from './keptCatalogueStore.js';

/**
 * `main`'s half of the kept catalogue (ADR-0293 and its correction of 2026-11-12): the area made and given its DACL every
 * launch, the catalogue host run only where no file for this fingerprint is there, its file copied in by name, the other
 * fingerprints' removed, and the hosts told only once a file is in place. The files are real, in a temporary folder; the
 * DACL and the host are stand-ins.
 */
const USER: UserSid = { __sid: 'user', value: 'S-1-5-21-1-2-3-1001' };
const READERS: readonly ContainerSid[] = [
  { __sid: 'container', value: 'S-1-15-2-11' },
  { __sid: 'container', value: 'S-1-15-2-22' },
  { __sid: 'container', value: 'S-1-15-2-33' },
];
const FINGERPRINT = 'e'.repeat(64);
const OLDER = 'f'.repeat(64);

const made: string[] = [];
afterEach(() => {
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});
function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'kept-store-'));
  made.push(path);
  return path;
}

/** The files `main` may touch, over the real file system, with every copy recorded. */
function filesRecording(copies: [string, string][]): KeptAreaFiles {
  return {
    makeDirectory: (path) => Promise.resolve(mkdirSync(path, { recursive: true })),
    exists: (path) => Promise.resolve(existsSync(path)),
    copy: (from, to) => {
      copies.push([from, to]);
      copyFileSync(from, to);
      return Promise.resolve();
    },
    names: (directory) => Promise.resolve(readdirSync(directory)),
    remove: (path) => {
      rmSync(path, { force: true });
      return Promise.resolve();
    },
  };
}

/** A catalogue host that writes `text` under the fingerprint's name into its own area and hands it to `place`. */
function hostWriting(text: string, calls: string[]): RunCatalogueHost {
  return async (fingerprint, place) => {
    calls.push(fingerprint);
    const own = folder();
    const written = join(own, keptCatalogueName(fingerprint));
    writeFileSync(written, text);
    await place(written);
    return 'kept';
  };
}

function parts(overrides: Partial<KeptCatalogueParts> & { area: string }): KeptCatalogueParts & { written: string[] } {
  const written: string[] = [];
  return {
    user: USER,
    readers: READERS,
    dacl: {
      read: () => 'D:P(A;OICI;FA;;;S-1-5-21-1-2-3-1001)',
      write: (_path, sddl) => {
        written.push(sddl);
        return true;
      },
    },
    files: filesRecording([]),
    fingerprint: () => Promise.resolve(FINGERPRINT),
    run: hostWriting('the catalogue', []),
    holder: keptCatalogueHolder(),
    report: () => undefined,
    ...overrides,
    written,
  };
}

describe('the kept catalogue in main (ADR-0293)', () => {
  it('runs the catalogue host where no file is there, copies its file in by name, removes an older one, and tells the hosts', async () => {
    const area = join(folder(), 'font-catalogue');
    mkdirSync(area);
    writeFileSync(join(area, keptCatalogueName(OLDER)), 'an older fonts’ catalogue');
    writeFileSync(join(area, 'not-a-catalogue.txt'), 'kept');
    const copies: [string, string][] = [];
    const calls: string[] = [];
    const holder = keptCatalogueHolder();
    const given = parts({ area, files: filesRecording(copies), run: hostWriting('the catalogue', calls), holder });
    await createKeptCatalogue(given).start();
    expect(calls).toStrictEqual([FINGERPRINT]);
    expect(copies.map(([, to]) => to)).toStrictEqual([join(area, keptCatalogueName(FINGERPRINT))]);
    expect(readFileSync(join(area, keptCatalogueName(FINGERPRINT)), 'utf8')).toBe('the catalogue');
    expect(readdirSync(area).sort()).toStrictEqual([keptCatalogueName(FINGERPRINT), 'not-a-catalogue.txt'].sort());
    expect(holder.known()).toStrictEqual({ area, fingerprint: FINGERPRINT });
    // THE AREA'S DACL, written this launch: the user full control and read to each of the three text hosts, nothing else.
    expect(given.written).toStrictEqual([
      'D:P(A;OICI;FA;;;S-1-5-21-1-2-3-1001)(A;OICI;0x00120089;;;S-1-15-2-11)(A;OICI;0x00120089;;;S-1-15-2-22)(A;OICI;0x00120089;;;S-1-15-2-33)',
    ]);
  });

  it('takes a file already in place for this fingerprint without running the host, and still writes the DACL', async () => {
    const area = folder();
    writeFileSync(join(area, keptCatalogueName(FINGERPRINT)), 'kept last launch');
    const calls: string[] = [];
    const holder = keptCatalogueHolder();
    const given = parts({ area, run: hostWriting('new', calls), holder });
    await createKeptCatalogue(given).start();
    expect(calls).toStrictEqual([]);
    expect(holder.known()).toStrictEqual({ area, fingerprint: FINGERPRINT });
    expect(given.written).toHaveLength(1);
  });

  const UNTOLD: readonly [string, (area: string) => Partial<KeptCatalogueParts>][] = [
    ['the DACL could not be written', () => ({ dacl: { read: () => null, write: () => false } })],
    ['the DACL did not read back', () => ({ dacl: { read: () => null, write: () => true } })],
    ['no catalogue host can be built', () => ({ run: null })],
    ['the catalogue host failed', () => ({ run: () => Promise.reject(new Error('refused at connect')) })],
    ['the folders held no face', () => ({ run: () => Promise.resolve('no-faces') })],
    [
      'the host wrote a file of another name',
      () => ({
        run: async (_fingerprint, place) => {
          await place(join(folder(), 'other.json'));
          return 'kept';
        },
      }),
    ],
  ];
  for (const [name, change] of UNTOLD) {
    it(`tells no host of the area where ${name}, and reports why`, async () => {
      const area = folder();
      const holder = keptCatalogueHolder();
      const reported: string[] = [];
      await createKeptCatalogue(parts({ area, holder, report: (line) => reported.push(line), ...change(area) })).start();
      expect(holder.known()).toBeNull();
      expect(reported).toHaveLength(1);
    });
  }

  it('CONTROL: a host that answers kept and placed nothing leaves the hosts untold, so being told means a file is there', async () => {
    const area = folder();
    const holder = keptCatalogueHolder();
    await createKeptCatalogue(parts({ area, holder, run: () => Promise.resolve('kept') })).start();
    expect(holder.known()).toBeNull();
    expect(existsSync(join(area, keptCatalogueName(FINGERPRINT)))).toBe(false);
  });
});
