import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HeldPassword } from '@monstera/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { drained, fakeConverterPlatform } from './converterFake.js';
import { type CountedKept, CurvesFailedError, type KeptCounter, createCurvesSource, curvesArguments } from './textToCurves.js';

/**
 * The curves copy's own rules (ADR-0282). Ghostscript itself is measured by `scripts/research/textToCurves.mjs` and
 * proven by `scripts/proofs/textToCurves.proof.mjs`; here the converter is a fake that writes what it read.
 */

let root = '';

afterEach(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
  root = '';
});

function platform(said: string | null = null, code = 0): ReturnType<typeof fakeConverterPlatform> {
  root = mkdtempSync(join(tmpdir(), 'monstera-curves-'));
  return fakeConverterPlatform(root, said, { kind: 'exited', code }, '%PDF-1.7 curves');
}

const CENSUS: CountedKept = {
  kept: { pages: 1, marks: 2, links: 1, 'link-targets': 1, bookmarks: 0, attachments: 0, layers: 0, fields: 3, tags: 0, title: 1 },
  fonts: 4,
};

/** A census that records what it was handed and, where asked, writes `copy` as the unencrypted document. */
function counting(copy: string): {
  readonly count: KeptCounter;
  readonly asked: { readonly password: string | null; readonly unencrypted: boolean }[];
  readonly discarded: () => number;
} {
  const asked: { password: string | null; unencrypted: boolean }[] = [];
  let discarded = 0;
  return {
    asked,
    discarded: () => discarded,
    count: (_source, opensWith, unencrypted) => {
      asked.push({ password: opensWith?.reveal() ?? null, unencrypted });
      let path: string | null = null;
      if (unencrypted) {
        path = join(mkdtempSync(join(root, 'unencrypted-')), 'copy.pdf');
        writeFileSync(path, copy);
      }
      const written = path;
      return Promise.resolve({
        kind: 'counted' as const,
        census: CENSUS,
        path: written,
        discard: () => {
          discarded += 1;
          if (written !== null) rmSync(written, { force: true });
          return Promise.resolve();
        },
      });
    },
  };
}

describe('curvesArguments — ADR-0282 Decision 5’s fixed command line', () => {
  it('asks pdfwrite for no fonts, SAFER, with the input last and nothing else', () => {
    expect(curvesArguments('C:\\in.pdf', 'C:\\out.pdf')).toStrictEqual([
      '-dBATCH',
      '-dNOPAUSE',
      '-dSAFER',
      '-sDEVICE=pdfwrite',
      '-dNoOutputFonts',
      '-sOutputFile=C:\\out.pdf',
      '-f',
      'C:\\in.pdf',
    ]);
  });
});

describe('createCurvesSource', () => {
  it('converts the flush itself where the document opens with no password, and answers its census', async () => {
    const built = platform();
    const counted = counting('%PDF-1.7 unencrypted');
    const source = createCurvesSource(built.platform, () => undefined, counted.count);

    const converted = await source(new TextEncoder().encode('%PDF-1.7 flush'), undefined);

    expect(converted.before).toStrictEqual(CENSUS);
    expect(await drained(converted.output)).toBe('%PDF-1.7 curves read:%PDF-1.7 flush');
    expect(counted.asked).toStrictEqual([{ password: null, unencrypted: false }]);
    expect(counted.discarded()).toBe(1);
    expect(built.argumentsSeen[0]).toContain('-dNoOutputFonts');
    expect(readdirSync(built.platform.sessionRoot).filter((name) => !name.endsWith('.log'))).toStrictEqual([]);
  });

  it('converts the UNENCRYPTED copy where the document opens with a password, which never reaches the command line', async () => {
    const built = platform();
    const counted = counting('%PDF-1.7 unencrypted');
    const source = createCurvesSource(built.platform, () => undefined, counted.count);

    const converted = await source(new TextEncoder().encode('%PDF-1.7 encrypted flush'), new HeldPassword('sample-only-0282'));

    expect(await drained(converted.output)).toBe('%PDF-1.7 curves read:%PDF-1.7 unencrypted');
    expect(counted.asked).toStrictEqual([{ password: 'sample-only-0282', unencrypted: true }]);
    expect(built.argumentsSeen[0]?.join(' ')).not.toContain('sample-only-0282');
    expect(counted.discarded()).toBe(1);
  });

  it('CONTROL: with no census the flush is converted, said in the log, and no census is claimed', async () => {
    const built = platform();
    const reported: string[] = [];
    const source = createCurvesSource(built.platform, (failure) => reported.push(failure.detail), () =>
      Promise.resolve({ kind: 'unavailable' }),
    );

    const converted = await source(new TextEncoder().encode('%PDF-1.7 flush'), undefined);

    expect(converted.before).toBeNull();
    expect(await drained(converted.output)).toBe('%PDF-1.7 curves read:%PDF-1.7 flush');
    expect(reported).toStrictEqual(['the document was not counted before its curves copy (unavailable)']);
  });

  it('REFUSES a converter that exits non-zero, reports it, discards the unencrypted copy and leaves no session area', async () => {
    const built = platform('Error: /undefinedfilename', 1);
    const reported: string[] = [];
    const counted = counting('%PDF-1.7 unencrypted');
    const source = createCurvesSource(built.platform, (failure) => reported.push(failure.detail), counted.count);

    await expect(source(new Uint8Array(4), new HeldPassword('sample-only-0282'))).rejects.toBeInstanceOf(CurvesFailedError);
    expect(reported).toHaveLength(1);
    expect(counted.discarded()).toBe(1);
    expect(readdirSync(built.platform.sessionRoot).filter((name) => !name.endsWith('.log'))).toStrictEqual([]);
  });
});
