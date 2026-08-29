import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { CapabilityRegistry } from './capabilityRegistry.js';
import { readDocumentRange } from './documentRanges.js';
import type { CanonicalPath, FileIdentity } from './documentIdentity.js';
import {
  type CommandWriter,
  DocumentNotOpenError,
  DocumentService,
  type OpenOutcome,
} from './documentService.js';

/**
 * The kernel-level half of exit clause 2 (ADR-0031).
 *
 * The UI-level half is `documentTransport.test.ts` — that the renderer asks the
 * right channel with the right offsets — and neither counts alone: this file
 * would pass against bytes no renderer ever requests, and that one would pass
 * against a main that served the wrong ones.
 */

const AMPLE_CEILING = 64 * 1024 * 1024;
const COMMAND_WRITER_FOR_TEST = 'command-writer' as CommandWriter;

function identity(): FileIdentity {
  return {
    canonicalPath: 'C:\\docs\\a.pdf' as CanonicalPath,
    dev: 1,
    ino: 100,
    size: 2048,
    modifiedMs: 1_700_000_000_000,
    changedMs: 1_700_000_000_000,
  };
}

/**
 * A document whose every byte is its own index modulo 251.
 *
 * **Not zeroes, and not a repeating byte.** A slice of a uniform document is
 * equal to every other slice of the same length, so a service that returned the
 * wrong offset — or the same offset every time — would satisfy every assertion
 * below. 251 is prime and smaller than 256, so the pattern does not align with
 * any power-of-two offset a bug is likely to land on.
 */
function countingBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = index % 251;
  return bytes;
}

function mustOpen(outcome: OpenOutcome): {
  docId: import('@monstera/shared').DocId;
  version: import('@monstera/shared').DocVersion;
  byteLength: number;
} {
  if (outcome.kind !== 'opened') throw new Error(`expected 'opened', got '${outcome.kind}'`);
  return { docId: outcome.docId, version: outcome.version, byteLength: outcome.byteLength };
}

async function openCounting(length: number): Promise<{
  service: DocumentService;
  opened: ReturnType<typeof mustOpen>;
  bytes: Uint8Array;
}> {
  const bytes = countingBytes(length);
  const registry = new CapabilityRegistry();
  const service = new DocumentService(registry, {
    documentBytesCeiling: AMPLE_CEILING,
    readIdentity: () => Promise.resolve(identity()),
    readBytes: () => Promise.resolve(bytes),
  });
  const opened = mustOpen(await service.open(registry.mint('C:\\docs\\a.pdf')));
  return { service, opened, bytes };
}

describe('readDocumentRange', () => {
  it('reports the document size at open, which is what a transport is built from', async () => {
    const { opened } = await openCounting(1500);

    expect(opened.byteLength).toBe(1500);
  });

  it('serves exactly the requested bytes', async () => {
    const { service, opened, bytes } = await openCounting(1500);

    const answer = readDocumentRange(service, opened.docId, opened.version, 400, 460);

    expect(answer).toStrictEqual({ kind: 'bytes', bytes: bytes.slice(400, 460) });
  });

  it('COPIES, so the slice does not retain the whole canonical image', async () => {
    const { service, opened } = await openCounting(1500);

    const answer = readDocumentRange(service, opened.docId, opened.version, 400, 460);
    if (answer.kind !== 'bytes') throw new Error('expected bytes');

    // A `subarray` would be a 60-byte VIEW whose buffer is the whole document,
    // so a renderer holding one range would pin the entire image — the defect
    // `assertOwnsItsBuffer` exists for, arriving through the one method that is
    // allowed to hand bytes out. Both halves are asserted: the buffer is exactly
    // the slice's size, and the view starts at zero.
    expect(answer.bytes.buffer.byteLength).toBe(60);
    expect(answer.bytes.byteOffset).toBe(0);
  });

  it('reports STALE with the current version and length, and serves nothing', async () => {
    const { service, opened } = await openCounting(1500);
    await service.run(opened.docId, (context) => {
      context.bumpVersion(COMMAND_WRITER_FOR_TEST);
      return Promise.resolve();
    });

    const answer = readDocumentRange(service, opened.docId, opened.version, 400, 460);

    // ASSERT WHAT WAS NOT SERVED. A service that reported the new version AND
    // returned the bytes would satisfy an assertion about `kind` alone, and
    // handing them over is the entire defect: offsets from one version applied
    // to another build a document out of two of them.
    expect(answer).toStrictEqual({
      kind: 'stale',
      version: asDocVersion(opened.version + 1),
      byteLength: 1500,
    });
  });

  it('CONTROL: the same read at the CURRENT version is served', async () => {
    // Without this, the case above passes for a service that answers `stale` to
    // everything — which is also what a broken version comparison produces.
    const { service, opened, bytes } = await openCounting(1500);
    const bumped = await service.run(opened.docId, (context) =>
      Promise.resolve(context.bumpVersion(COMMAND_WRITER_FOR_TEST)),
    );

    const answer = readDocumentRange(service, opened.docId, bumped.value, 400, 460);

    expect(answer).toStrictEqual({ kind: 'bytes', bytes: bytes.slice(400, 460) });
  });

  it('refuses a range past the end rather than clamping it', () => {
    // A clamped answer is a short read, and a parser reports that later as a
    // corrupt document — the diagnosis then lands nowhere near the mistake.
    return openCounting(1500).then(({ service, opened }) => {
      expect(() =>
        readDocumentRange(service, opened.docId, opened.version, 1400, 1600),
      ).toThrow(RangeError);
    });
  });

  it('refuses a document that is not open', async () => {
    const { service, opened } = await openCounting(1500);
    await service.close(opened.docId);

    expect(() => readDocumentRange(service, opened.docId, opened.version, 0, 10)).toThrow(
      DocumentNotOpenError,
    );
  });
});
