import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    await expect(answers.take({ session: 's1' }, 'n1', 10)).rejects.toThrow(/holds 64 bytes where the host announced 10/u);
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
