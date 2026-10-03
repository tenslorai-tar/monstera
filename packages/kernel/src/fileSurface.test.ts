import { copyFile, writeFile } from 'node:fs/promises';
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { atomicWrite } from './atomicWrite.js';
import { nodeFileSurface, siblingNames } from './fileSurface.js';

/**
 * CR-SEC-17: the save's sibling files are written into the person's directory, which another account may also write
 * to, so an object planted at a sibling's name must never receive the document's bytes or become the document.
 * Real files, because the property is the filesystem's: a hard link is the same file under a second name.
 */

const OLD = Buffer.from('%PDF-1.7 the previous version\n');
const NEW = Buffer.from('%PDF-1.7 the new version\n');
const PLANTED = Buffer.from('a file another account holds\n');

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A document's folder, and a separate one holding the planter's file. */
function scene(): { readonly target: string; readonly planter: string; readonly outside: string } {
  const folder = mkdtempSync(join(tmpdir(), 'monstera-save-'));
  const outside = mkdtempSync(join(tmpdir(), 'monstera-planter-'));
  made.push(folder, outside);
  const target = join(folder, 'doc.pdf');
  const planter = join(outside, 'planter.bin');
  writeFileSync(target, OLD);
  writeFileSync(planter, PLANTED);
  return { target, planter, outside };
}

const sameFile = (a: string, b: string): boolean => {
  const x = statSync(a, { bigint: true });
  const y = statSync(b, { bigint: true });
  return x.ino === y.ino && x.dev === y.dev;
};

const save = (target: string, names = siblingNames(target, 1)) =>
  atomicWrite(nodeFileSurface, target, (temp) => nodeFileSurface.write(temp, NEW), names, () => Promise.resolve());

describe('the save writes nothing through an object planted at a sibling name', () => {
  it('a hard link planted at .bak keeps its own bytes, and the saved document is not it', async () => {
    const { target, planter } = scene();
    const names = siblingNames(target, 1);
    linkSync(planter, names.backups[0] ?? '');

    const saved = await save(target, names);

    expect(saved.ok).toBe(true);
    expect(readFileSync(planter)).toStrictEqual(PLANTED);
    expect(readFileSync(target)).toStrictEqual(NEW);
    expect(readFileSync(names.backups[0] ?? '')).toStrictEqual(OLD);
    expect(sameFile(target, planter)).toBe(false);
  });

  it('CONTROL: a plain copy onto that planted link writes the document into the planter’s file', async () => {
    // THE FIXTURE IS REAL: what the surface's copy refuses to do is what a copy onto that name does — the shape of the
    // save before this fix, measured on Windows with the previous version landing in the planter's file.
    const { target, planter } = scene();
    const bak = siblingNames(target, 1).backups[0] ?? '';
    linkSync(planter, bak);
    await copyFile(target, bak);
    expect(readFileSync(planter)).toStrictEqual(OLD);
  });

  it('the temp is written only where nothing is: an object already at the path is refused and left as it was', async () => {
    const { target, planter } = scene();
    const occupied = `${target}.occupied.monstera-tmp`;
    linkSync(planter, occupied);

    await expect(nodeFileSurface.write(occupied, NEW)).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(nodeFileSurface.writeStream(occupied, Readable.from([NEW]))).rejects.toMatchObject({ code: 'EEXIST' });
    expect(readFileSync(planter)).toStrictEqual(PLANTED);
  });

  it('CONTROL: a plain write onto that planted link writes the document into the planter’s file', async () => {
    const { target, planter } = scene();
    const occupied = `${target}.occupied.monstera-tmp`;
    linkSync(planter, occupied);
    await writeFile(occupied, NEW);
    expect(readFileSync(planter)).toStrictEqual(NEW);
  });

  it('the temp’s name is new at every save, so nothing can be waiting at it', () => {
    const temps = new Set(Array.from({ length: 50 }, () => siblingNames('C:/d/doc.pdf', 1).temp));
    expect(temps.size).toBe(50);
  });

  it('a directory link planted at .bak receives nothing; on Windows it refuses the save at its backup', async () => {
    const { target, outside } = scene();
    const names = siblingNames(target, 1);
    const pointed = join(outside, 'pointed');
    mkdirSync(pointed);
    symlinkSync(pointed, names.backups[0] ?? '', 'junction');

    const saved = await save(target, names);

    expect(readdirSync(pointed)).toStrictEqual([]);
    // BY PLATFORM, because the rename's answer is the platform's: Windows refuses a file renamed onto a junction
    // (measured 2026-10-03), so the save stops at its backup with the original as it was; POSIX replaces the link
    // itself, so the save lands and `.bak` becomes a plain file. Neither writes into what the link pointed at.
    if (process.platform === 'win32') {
      expect(saved.ok).toBe(false);
      if (!saved.ok) expect(saved.error.stage).toBe('backup');
      expect(readFileSync(target)).toStrictEqual(OLD);
    } else {
      expect(saved.ok).toBe(true);
      expect(lstatSync(names.backups[0] ?? '').isFile()).toBe(true);
    }
  });
});
