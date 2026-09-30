import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { channel, fileAnswered, outputNameSchema } from '@monstera/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { fileAnswersFor } from './hostFileAnswers.js';

const channels = {
  'test.big': fileAnswered('answers in a file', z.object({ session: z.string() }), z.object({})),
  'test.small': channel('answers in the frame', z.object({}), z.object({})),
} as const;

const made: string[] = [];
afterEach(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A granted output directory holding `bytes` under `name`, for the session `s1`. */
function areaWith(name: string, bytes: Uint8Array) {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'monstera-file-answers-'));
  made.push(outputDirectory);
  writeFileSync(join(outputDirectory, name), bytes);
  const area = { outputDirectory, snapshotDirectory: outputDirectory };
  return {
    outputDirectory,
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
