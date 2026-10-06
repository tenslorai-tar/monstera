import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAX_ANNOTATION_DATA_BYTES,
  MAX_CSV_BYTES,
  MAX_FORM_DATA_BYTES,
  MAX_IMAGE_BYTES,
  MAX_MARKDOWN_BYTES,
  MAX_OFFICE_IMPORT_BYTES,
} from '@monstera/contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type BoundedRead,
  type FileReadCalls,
  readAnnotationDataFile,
  readCsvFile,
  readFormDataFile,
  readImageFile,
  readMarkdownFile,
  readOfficeFile,
} from './pickedFileReads.js';

/**
 * Every picked file is sized before it is read, against its own bound (the stage audit of `de106c45..5da42ae3`,
 * MMMMMMM-8). Each read in a ROW of its own, with the bound it must name, so a read wired to another's bound fails here —
 * except between form data and annotation data, whose bounds are both 8 MiB today: a swap there changes nothing a
 * person could see, and this table cannot see it either.
 */
const READS = [
  ['image', readImageFile, MAX_IMAGE_BYTES],
  ['form data', readFormDataFile, MAX_FORM_DATA_BYTES],
  ['annotation data', readAnnotationDataFile, MAX_ANNOTATION_DATA_BYTES],
  ['Markdown', readMarkdownFile, MAX_MARKDOWN_BYTES],
  ['CSV', readCsvFile, MAX_CSV_BYTES],
  ['Office', readOfficeFile, MAX_OFFICE_IMPORT_BYTES],
] as const satisfies readonly (readonly [string, (path: string, calls?: FileReadCalls) => Promise<BoundedRead>, number])[];

/** The real `stat`, and a `readFile` that records every path it is asked for. */
function recording(): { readonly calls: FileReadCalls; readonly read: string[] } {
  const read: string[] = [];
  return {
    read,
    calls: {
      stat: (path) => stat(path),
      readFile: (path) => {
        read.push(path);
        return Promise.resolve(Uint8Array.of(1, 2, 3));
      },
    },
  };
}

let folder = '';
beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), 'monstera-picked-'));
});
afterAll(() => {
  if (folder !== '') rmSync(folder, { recursive: true, force: true });
});

describe('a picked file is sized before it is read', () => {
  it('PAST ITS BOUND by one byte, each read answers too-large and READS NOTHING', async () => {
    for (const [name, read, bound] of READS) {
      // A SPARSE FILE ON THE REAL DISK, one byte past the bound: its size is real and no byte of it was written.
      const path = join(folder, `past-${name}.bin`);
      writeFileSync(path, '');
      truncateSync(path, bound + 1);
      const { calls, read: asked } = recording();

      expect([name, await read(path, calls)]).toStrictEqual([name, { kind: 'too-large', byteLength: bound + 1 }]);
      // THE CALL NOT MADE: a read past the bound is the very allocation the bound exists to prevent.
      expect([name, asked]).toStrictEqual([name, []]);
    }
  });

  it('CONTROL: AT its bound, each read reads the file, so the refusal above is the bound and not a refusal of all', async () => {
    for (const [name, read, bound] of READS) {
      const path = join(folder, `at-${name}.bin`);
      writeFileSync(path, '');
      truncateSync(path, bound);
      const { calls, read: asked } = recording();

      expect([name, await read(path, calls)]).toStrictEqual([name, { kind: 'read', bytes: Uint8Array.of(1, 2, 3) }]);
      expect([name, asked]).toStrictEqual([name, [path]]);
    }
  });

  it('a file gone since it was picked reads as unreadable, and nothing is read', async () => {
    for (const [name, read] of READS) {
      const { calls, read: asked } = recording();
      expect([name, await read(join(folder, 'never-there.bin'), calls)]).toStrictEqual([name, { kind: 'unreadable' }]);
      expect([name, asked]).toStrictEqual([name, []]);
    }
  });

  it('the default calls are Node’s: a small file on disk is read whole', async () => {
    const path = join(folder, 'small.png');
    writeFileSync(path, Uint8Array.of(0x89, 0x50, 0x4e, 0x47));
    expect(await readImageFile(path)).toStrictEqual({ kind: 'read', bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47) });
  });
});
