import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ENGINE_HOST_FRAME_MAX_BYTES, fileRequestedAndAnswered } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createHostClient } from './client.js';
import { type HostTermination, createHostRuntime } from './runtime.js';

/**
 * A CREDENTIAL CROSSES TO A HOST IN THE FRAME, NEVER IN A FILE, across a real client and a real runtime whose files
 * are real files ([ADR-0171](../../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md)'s
 * correction of 2026-10-05, finding RRRRRRR-1).
 *
 * The defect was invisible to every case that ran in process, because none had a transport: the password reached the
 * snapshot directory as JSON with the call's params, and a protect's prior reached the output directory as JSON with
 * its answer. So this joins `createHostClient` to `createHostRuntime` by their frames, writes every params file and
 * every answer file into a temporary directory as main and the host write them, and reads each one back from the disk
 * WHILE THE CALL IS IN FLIGHT, inside the handler, before anything is removed.
 *
 * One channel carries a credential both ways, as `engine/capture` does on PDFium's host: its params name the key the
 * document opens with, and its answer is a protect's prior.
 *
 * CONTROL: the same secret also travels under a key that is not a credential's, in both directions, and that copy is
 * found in the files. So *not found* is about the lift and not about a read that sees nothing.
 */

const SECRET = 'sample-only-RRRRRRR-1';

const channels = {
  'fixture.capture': fileRequestedAndAnswered(
    'takes a key and a note, and answers a prior carrying terms and the note back',
    z.object({ session: z.string(), password: z.string(), note: z.string() }).strict(),
    z
      .object({ prior: z.object({ standing: z.literal('protected'), passwordTerms: z.string() }).strict(), note: z.string() })
      .strict(),
  ),
} as const;

interface Run {
  /** Every file either side wrote, read from the disk while the call was in flight. */
  readonly seenOnDisk: string[];
  /** What the handler was handed, after the runtime put the credentials back. */
  readonly handed: unknown[];
  readonly terminations: HostTermination[];
  readonly answer: unknown;
  readonly left: readonly string[];
}

let root: string | undefined;
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

async function run(): Promise<Run> {
  root = mkdtempSync(join(tmpdir(), 'monstera-credential-transport-'));
  const directory = root;
  const seenOnDisk: string[] = [];
  const handed: unknown[] = [];
  const terminations: HostTermination[] = [];
  const readAll = (): void => {
    for (const name of readdirSync(directory)) seenOnDisk.push(readFileSync(join(directory, name), 'utf8'));
  };

  let toHost: (chunk: Uint8Array) => void = () => undefined;
  let toMain: (chunk: Uint8Array) => void = () => undefined;

  const runtime = createHostRuntime({
    channels,
    handlers: {
      'fixture.capture': (params: { session: string; password: string; note: string }) => {
        // IN FLIGHT: main's params file is on the disk now, and nothing has removed it.
        readAll();
        handed.push(params);
        return Promise.resolve(
          ok({ prior: { standing: 'protected' as const, passwordTerms: `user-password="${params.password}"` }, note: params.note }),
        );
      },
    },
    incidents: () => undefined,
    maxFrameBytes: ENGINE_HOST_FRAME_MAX_BYTES,
    maxInFlight: 4,
    transport: {
      write: (frame) => {
        toMain(frame);
      },
      terminate: (reason) => terminations.push(reason),
    },
    fileAnswers: {
      write: (_params, name, bytes) => {
        writeFileSync(join(directory, `answer-${name}`), bytes);
        return Promise.resolve(bytes.byteLength);
      },
      read: (_session, name) => Promise.resolve(new Uint8Array(readFileSync(join(directory, `params-${name}`)))),
    },
  });

  const client = createHostClient({
    transport: {
      write: (frame) => {
        toHost(frame);
      },
      terminate: (reason) => terminations.push(reason),
    },
    maxInFlight: 4,
    correlate: () => 'c1',
    fileAnswers: {
      routed: () => true,
      requested: () => true,
      mint: () => 'abc123',
      put: (_params, name, bytes) => {
        writeFileSync(join(directory, `params-${name}`), bytes);
        return Promise.resolve();
      },
      take: (_params, name) => {
        // IN FLIGHT the other way: the host's answer file is on the disk, and main has not removed it yet.
        readAll();
        const path = join(directory, `answer-${name}`);
        const bytes = new Uint8Array(readFileSync(path));
        rmSync(path);
        return Promise.resolve(bytes);
      },
      drop: (_params, name) => {
        rmSync(join(directory, `params-${name}`), { force: true });
        return Promise.resolve();
      },
    },
  });
  toHost = (chunk) => {
    runtime.receive(chunk);
  };
  toMain = (chunk) => {
    client.receive(chunk);
  };

  const answer = await client.invoke('fixture.capture', { session: 's1', password: SECRET, note: `the note: ${SECRET}` });
  return { seenOnDisk, handed, terminations, answer, left: readdirSync(directory) };
}

describe('a credential crosses to a host in the frame, never in a file (ADR-0171, RRRRRRR-1)', () => {
  it('writes neither the params’ key nor the answer’s terms to disk, and both arrive whole', async () => {
    const result = await run();

    expect(result.terminations).toStrictEqual([]);
    // BOTH FILES WERE READ FROM THE DISK, in flight: the params file in the handler, and both in `take`.
    expect(result.seenOnDisk.length).toBeGreaterThanOrEqual(2);
    for (const file of result.seenOnDisk) {
      // CONTROL, per file: the note's copy of the secret is in it, so the read sees what the file holds.
      expect(file).toContain(`the note: ${SECRET}`);
      expect(file.split(SECRET), 'the secret appears once in each file, in the note alone').toHaveLength(2);
    }
    // THE HANDLER GOT THE KEY, put back from the frame, and main got the terms.
    expect(result.handed).toStrictEqual([{ session: 's1', password: SECRET, note: `the note: ${SECRET}` }]);
    expect(result.answer).toStrictEqual({
      ok: true,
      value: { prior: { standing: 'protected', passwordTerms: `user-password="${SECRET}"` }, note: `the note: ${SECRET}` },
    });
    // AND NOTHING IS LEFT once the call has ended.
    expect(result.left).toStrictEqual([]);
  });
});
