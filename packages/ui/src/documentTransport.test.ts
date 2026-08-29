// @vitest-environment happy-dom
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it, vi } from 'vitest';

import { DocumentRangeTransport } from './documentTransport.js';

/**
 * The UI-level half of exit clause 2.
 *
 * The kernel-level half — that main serves the right bytes and refuses a stale
 * version — is `documentRanges.test.ts`, and the end-to-end half is
 * `proof:rendererpolicy`, which drives the shipped transport through real PDF.js
 * in real Chromium. **None of the three counts alone**: this file would pass
 * against a transport whose bytes never reach a parser, the kernel's would pass
 * against a renderer that never asks, and the Chromium one would pass without
 * ever meeting a version that moved.
 *
 * ## The client is built from the contract, not from the browser shim
 *
 * This package may import `shared` and `contract` only, and `@monstera/testing`
 * is across that boundary — the same constraint `bridge.test.ts` records, and
 * the same reason it is right: what is under test here is what the transport
 * *asks for*, and a shim would put a second implementation of the boundary
 * between the question and the answer. `createClient` is the real one, so the
 * params and the result below go through the real schemas in both directions.
 */

const DOC = asDocId('doc-range');
const VERSION = asDocVersion(4);

/** A document whose every byte is its own index, so a wrong slice is visible. */
function countingBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = index % 251;
  return bytes;
}

/**
 * A client whose `document.readRange` answers as main does.
 *
 * `held === null` is a document that is not open, which is a different answer
 * from an empty one and must stay different — the transport's response to the
 * two is not the same.
 */
function clientOver(held: Uint8Array | null, at: number): ContractClient {
  return createClient(channels, (id, params) => {
    if (id !== 'document.readRange') {
      throw new Error(`this fixture answers document.readRange only, not ${id}`);
    }
    const { version, begin, end } = params as { version: number; begin: number; end: number };
    if (held === null) return Promise.resolve(err({ code: 'document-not-open' }));
    if (version !== at) {
      return Promise.resolve(
        ok({ kind: 'stale', version: at, byteLength: held.byteLength }),
      );
    }
    const copy = new Uint8Array(end - begin);
    copy.set(held.subarray(begin, end));
    return Promise.resolve(ok({ kind: 'bytes', bytes: copy }));
  });
}

/** Resolves once the transport has answered, or after `tries` microtask turns. */
async function settle(tries = 12): Promise<void> {
  for (let turn = 0; turn < tries; turn += 1) await Promise.resolve();
}

describe('DocumentRangeTransport', () => {
  it('answers a requested range with exactly those bytes', async () => {
    const bytes = countingBytes(600);
    const client = clientOver(bytes, VERSION);

    const transport = new DocumentRangeTransport({
      client,
      docId: DOC,
      version: VERSION,
      byteLength: bytes.byteLength,
      onVersionMoved: vi.fn(),
    });

    // `onDataRange` is what PDF.js's stream listens on; nothing is listening
    // here, so it is spied rather than driven through a parser. The parser is
    // exercised end to end by proof:rendererpolicy.
    const answered = vi.spyOn(transport, 'onDataRange').mockImplementation(() => undefined);

    transport.requestDataRange(100, 140);
    await settle();

    expect(answered).toHaveBeenCalledTimes(1);
    const [begin, chunk] = answered.mock.calls[0] ?? [];
    expect(begin).toBe(100);
    // THE FIXTURE IS COUNTING BYTES, so an off-by-one slice is a different array
    // rather than the same length. A fixture of zeroes would be satisfied by any
    // slice of the right size, which is the defect this is meant to catch.
    expect(chunk).toStrictEqual(bytes.slice(100, 140));
  });

  it('a range answered in ONE call, because a split one is refused by PDF.js', async () => {
    const bytes = countingBytes(600);
    const client = clientOver(bytes, VERSION);

    const transport = new DocumentRangeTransport({
      client,
      docId: DOC,
      version: VERSION,
      byteLength: bytes.byteLength,
      onVersionMoved: vi.fn(),
    });
    const answered = vi.spyOn(transport, 'onDataRange').mockImplementation(() => undefined);

    transport.requestDataRange(0, 500);
    await settle();

    // Measured against pdfjs-dist@6.2.108: a second `onDataRange` for the same
    // begin throws `no PDFDataTransportStreamRangeReader instance found`,
    // because the reader completes and is deleted after the first. So "one call
    // per range" is a contract with the parser rather than a style choice, and
    // a transport that started chunking would break it silently.
    expect(answered).toHaveBeenCalledTimes(1);
  });

  it('reports a version that moved, and stops answering', async () => {
    const bytes = countingBytes(600);
    // Main holds the document at version 9; the transport is bound to 4.
    const client = clientOver(bytes, 9);

    const onVersionMoved = vi.fn();
    const transport = new DocumentRangeTransport({
      client,
      docId: DOC,
      version: VERSION,
      byteLength: bytes.byteLength,
      onVersionMoved,
    });
    const answered = vi.spyOn(transport, 'onDataRange').mockImplementation(() => undefined);

    transport.requestDataRange(0, 40);
    await settle();

    // ASSERT THE CALL THAT WAS NOT MADE. A transport that reported the move AND
    // still handed the bytes over would satisfy an assertion about
    // `onVersionMoved` alone — and handing them over is the whole defect, since
    // offsets from one version applied to another build a document out of two.
    expect(answered).not.toHaveBeenCalled();
    expect(onVersionMoved).toHaveBeenCalledWith({ version: 9, byteLength: 600 });
    expect(transport.aborted).toBe(true);
  });

  it('CONTROL: the same request at the CURRENT version is answered', async () => {
    // Without this, the case above passes for a transport that answers nothing
    // ever — "did not call onDataRange" is what a broken transport produces too.
    const bytes = countingBytes(600);
    const client = clientOver(bytes, VERSION);

    const transport = new DocumentRangeTransport({
      client,
      docId: DOC,
      version: VERSION,
      byteLength: bytes.byteLength,
      onVersionMoved: vi.fn(),
    });
    const answered = vi.spyOn(transport, 'onDataRange').mockImplementation(() => undefined);

    transport.requestDataRange(0, 40);
    await settle();

    expect(answered).toHaveBeenCalledTimes(1);
    expect(transport.aborted).toBe(false);
  });

  it('drops an answer that arrives after abort', async () => {
    const bytes = countingBytes(600);
    const client = clientOver(bytes, VERSION);

    const transport = new DocumentRangeTransport({
      client,
      docId: DOC,
      version: VERSION,
      byteLength: bytes.byteLength,
      onVersionMoved: vi.fn(),
    });
    const answered = vi.spyOn(transport, 'onDataRange').mockImplementation(() => undefined);

    // Aborted while the query is in flight — the real sequence when a document
    // closes mid-render. `onDataRange` on a torn-down reader throws inside
    // PDF.js, and it surfaces against the NEXT document rather than this one.
    transport.requestDataRange(0, 40);
    transport.abort();
    await settle();

    expect(answered).not.toHaveBeenCalled();
  });

  it('stops answering when the document is no longer open', async () => {
    const bytes = countingBytes(600);
    // `null` held bytes, so the client answers `document-not-open`.
    const client = clientOver(null, VERSION);

    const onVersionMoved = vi.fn();
    const transport = new DocumentRangeTransport({
      client,
      docId: DOC,
      version: VERSION,
      byteLength: bytes.byteLength,
      onVersionMoved,
    });
    const answered = vi.spyOn(transport, 'onDataRange').mockImplementation(() => undefined);

    transport.requestDataRange(0, 40);
    await settle();

    expect(answered).not.toHaveBeenCalled();
    // NOT reported as a version move. Absence and staleness are different, and
    // conflating them has the owner rebuild a transport for a document that is
    // gone — a loop rather than an error.
    expect(onVersionMoved).not.toHaveBeenCalled();
    expect(transport.aborted).toBe(true);
  });
});
