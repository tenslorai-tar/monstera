import { appendFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { channel, fileAnswered, fileRequested, outputNameSchema } from '@monstera/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { fileAnswersFor } from './hostFileAnswers.js';

const channels = {
  'test.big': fileAnswered('answers in a file', z.object({ session: z.string() }), z.object({})),
  'test.small': channel('answers in the frame', z.object({}), z.object({})),
  'test.undo': fileRequested('takes its params in a file', z.object({ session: z.string() }), z.object({})),
} as const;

const made: string[] = [];
afterEach(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/**
 * A granted area for the session `s1` whose output directory holds `bytes` under `name`. The snapshot directory is a
 * SEPARATE one, so a write that landed in the wrong half of the area is visible rather than the same path.
 */
function areaWith(name: string, bytes: Uint8Array) {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'monstera-file-answers-'));
  const snapshotDirectory = mkdtempSync(join(tmpdir(), 'monstera-file-params-'));
  made.push(outputDirectory, snapshotDirectory);
  writeFileSync(join(outputDirectory, name), bytes);
  const area = { outputDirectory, snapshotDirectory };
  return {
    outputDirectory,
    snapshotDirectory,
    answers: fileAnswersFor(channels, (params) =>
      (params as { session?: unknown }).session === 's1' ? area : undefined,
    ),
  };
}

describe('taking a file-routed answer (ADR-0125)', () => {
  it('routes by the channel declaration, and mints names the host will accept', () => {
    const { answers } = areaWith('n1', new Uint8Array([1]));
    expect(answers.routed('test.big')).toBe(true);
    expect(answers.routed('test.small')).toBe(false);
    expect(answers.routed('test.undeclared')).toBe(false);
    expect(outputNameSchema.safeParse(answers.mint()).success).toBe(true);
  });

  it('reads the named file for the session in the params, and removes it', async () => {
    const bytes = new TextEncoder().encode('{"ok":true,"value":{}}');
    const { answers, outputDirectory } = areaWith('n1', bytes);
    await expect(answers.take({ session: 's1' }, 'n1', bytes.byteLength)).resolves.toStrictEqual(bytes);
    expect(existsSync(join(outputDirectory, 'n1'))).toBe(false);
  });

  /**
   * THE SIZE IS CHECKED BEFORE THE READ: a host that announced one size and wrote a larger file would otherwise choose
   * how much of main's memory the read spends. Refused, and the file is removed all the same.
   */
  it('refuses a file of another size than announced, before reading it, and removes it', async () => {
    const { answers, outputDirectory } = areaWith('n1', new Uint8Array(64));
    await expect(answers.take({ session: 's1' }, 'n1', 10)).rejects.toThrow(/reported writing 10 bytes and the file holds 64/u);
    expect(existsSync(join(outputDirectory, 'n1'))).toBe(false);
  });

  /**
   * THE RACE, STAGED (addendum 5's X1): the host changes the file AFTER `main` has opened it, which is the window a
   * `stat` then a `readFile` by path left open. The files the reader is handed do the change at that moment, so the
   * case is deterministic rather than a timing.
   */
  function racing(change: (path: string) => void): { readonly files: { open: typeof open; rm: typeof rm }; readonly reads: number[] } {
    const reads: number[] = [];
    const opening = (async (path: string, flags: string) => {
      const handle = await open(path, flags);
      change(path);
      const read = handle.read.bind(handle) as (buffer: Uint8Array, offset: number, length: number, position: number) => ReturnType<typeof handle.read>;
      return Object.assign(handle, {
        read: (buffer: Uint8Array, offset: number, length: number, position: number) => {
          reads.push(length);
          return read(buffer, offset, length, position);
        },
      });
    }) as unknown as typeof open;
    return { files: { open: opening, rm }, reads };
  }

  it('a file GROWN after it was opened is refused, and never more than one byte past the count is asked for', async () => {
    const bytes = new TextEncoder().encode('{"ok":true,"value":{}}');
    const { outputDirectory } = areaWith('n1', bytes);
    const { files, reads } = racing((path) => {
      appendFileSync(path, new Uint8Array(1_048_576));
    });
    const answers = fileAnswersFor(channels, () => ({ outputDirectory, snapshotDirectory: outputDirectory }), files);
    await expect(answers.take({ session: 's1' }, 'n1', bytes.byteLength)).rejects.toThrow(/reported writing/u);
    expect(Math.max(...reads)).toBeLessThanOrEqual(bytes.byteLength);
    expect(reads.reduce((sum, length) => sum + length, 0)).toBeLessThanOrEqual(bytes.byteLength + 1);
    expect(existsSync(join(outputDirectory, 'n1'))).toBe(false);
  });

  it('a file REPLACED after it was opened is not what is read: the answer is the bytes the opened file held', async () => {
    const bytes = new TextEncoder().encode('{"ok":true,"value":{}}');
    const { outputDirectory } = areaWith('n1', bytes);
    let seenAtPath = 0;
    let replaced = false;
    const { files } = racing((path) => {
      const larger = `${path}.larger`;
      writeFileSync(larger, new Uint8Array(4 * 1_048_576));
      // WINDOWS REFUSES THIS RACE: a rename onto a file another handle holds open fails (EPERM, read from CI's
      // Windows unit tests on c683edac, 2026-10-15), so there the host cannot swap the file under main at all.
      // POSIX allows it, and that is the race this case exists for, so it is required to happen there.
      try {
        renameSync(larger, path);
        replaced = true;
      } catch (error) {
        if (process.platform !== 'win32') throw error;
        rmSync(larger, { force: true });
      }
      // CONTROL: what the path names now, so a reader that went back to the path would read that.
      seenAtPath = readFileSync(path).byteLength;
    });
    const answers = fileAnswersFor(channels, () => ({ outputDirectory, snapshotDirectory: outputDirectory }), files);
    await expect(answers.take({ session: 's1' }, 'n1', bytes.byteLength)).resolves.toStrictEqual(bytes);
    // WHERE THE RACE HAPPENED, the path named the larger file while the answer was the opened one's bytes.
    expect({ replaced, seenAtPath }).toStrictEqual(
      process.platform === 'win32' ? { replaced: false, seenAtPath: bytes.byteLength } : { replaced: true, seenAtPath: 4 * 1_048_576 },
    );
    expect(existsSync(join(outputDirectory, 'n1'))).toBe(false);
  });

  it('refuses an answer for a session it does not hold', async () => {
    const { answers, outputDirectory } = areaWith('n1', new Uint8Array(4));
    await expect(answers.take({ session: 'someone-else' }, 'n1', 4)).rejects.toThrow(/not holding/u);
    expect(existsSync(join(outputDirectory, 'n1'))).toBe(true);
  });
});

describe("putting a file-requested call's params (ADR-0125's addendum)", () => {
  it('routes by the channel declaration', () => {
    const { answers } = areaWith('n1', new Uint8Array([1]));
    expect(answers.requested('test.undo')).toBe(true);
    expect(answers.requested('test.big')).toBe(false);
    expect(answers.requested('test.undeclared')).toBe(false);
  });

  /**
   * INTO THE SNAPSHOT DIRECTORY, the half the host may only read — never the output directory it writes, where a
   * compromised host could replace prior state between main writing it and the host reading it.
   */
  it('writes the params into the snapshot directory of the session they name, and drop removes them', async () => {
    const { answers, snapshotDirectory, outputDirectory } = areaWith('n1', new Uint8Array([1]));
    const bytes = new TextEncoder().encode('{"session":"s1"}');
    await answers.put({ session: 's1' }, 'p1', bytes);
    expect(new Uint8Array(readFileSync(join(snapshotDirectory, 'p1')))).toStrictEqual(bytes);
    expect(existsSync(join(outputDirectory, 'p1'))).toBe(false);

    await answers.drop({ session: 's1' }, 'p1');
    expect(existsSync(join(snapshotDirectory, 'p1'))).toBe(false);
  });

  it('refuses params for a session it does not hold, and a drop of nothing does not throw', async () => {
    const { answers } = areaWith('n1', new Uint8Array([1]));
    await expect(answers.put({ session: 'someone-else' }, 'p1', new Uint8Array([1]))).rejects.toThrow(/not holding/u);
    await expect(answers.drop({ session: 's1' }, 'never-written')).resolves.toBeUndefined();
    await expect(answers.drop({ session: 'someone-else' }, 'p1')).resolves.toBeUndefined();
  });
});
