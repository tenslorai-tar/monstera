import { describe, expect, it } from 'vitest';

import { createClient } from '@monstera/contract';

import type { ByteImage } from '../engineSeam.js';
import { EngineCallFailed, EngineSessionGone, type SessionArea } from './remoteEngine.js';
import { EngineSerialiseMismatch } from './remoteLifecycle.js';
import { pdfiumChannels } from './pdfiumChannels.js';
import {
  type PdfiumTransfer,
  remotePdfiumTextObjects,
  remotePdfiumWriter,
} from './remotePdfium.js';

/**
 * Main's side of the PDFium host, driven against a stub peer.
 *
 * ## What is under test is the DANCE, not the protocol
 *
 * `pdfiumHostBody.test.ts` drives the host's half and `proof:pdfiumcommand`
 * drives the engine. What neither can see is main's four steps: write the image
 * where the host reads, name it, read the answer back out of the granted
 * directory, and remove what was written **whatever happened**. Every one of
 * those can be wrong while both ends are right.
 *
 * ## The peer answers through the contract's own client
 *
 * `createClient(pdfiumChannels, …)` rather than a hand-made object, so the
 * responses these cases write are validated against the same schemas the real
 * client validates against. A stub that could answer a shape the channel
 * forbids would let a case assert behaviour the wire cannot produce.
 */

const AREA: SessionArea = {
  snapshotDirectory: 'C:\\snap',
  outputDirectory: 'C:\\out',
};

/** A transfer that records every file it is asked to write, take or remove. */
function stubTransfer(): PdfiumTransfer & {
  readonly snapshots: Map<string, ByteImage>;
  readonly outputs: Map<string, ByteImage>;
  readonly log: string[];
} {
  const snapshots = new Map<string, ByteImage>();
  const outputs = new Map<string, ByteImage>();
  const log: string[] = [];
  let minted = 0;
  return {
    snapshots,
    outputs,
    log,
    // DETERMINISTIC AND HEX, because `outputNameSchema` is `/^[0-9a-f-]+$/` and
    // a name the wire refuses would make every case fail at the boundary rather
    // than at its own subject.
    mintName: () => {
      minted += 1;
      return `00${minted.toString(16)}`;
    },
    writeSnapshot: (_area, name, bytes) => {
      log.push(`write:${name}`);
      snapshots.set(name, bytes);
      return Promise.resolve();
    },
    removeSnapshot: (_area, name) => {
      log.push(`remove:${name}`);
      snapshots.delete(name);
      return Promise.resolve();
    },
    takeOutput: (_area, name) => {
      log.push(`take:${name}`);
      const found = outputs.get(name);
      if (found === undefined) return Promise.reject(new Error(`no output named ${name}`));
      outputs.delete(name);
      return Promise.resolve(found);
    },
    remove: () => Promise.resolve(),
  };
}

/** The peer's answers, keyed by channel, plus what it was asked. */
interface Peer {
  readonly asked: { channel: string; params: unknown }[];
  answer: (channel: string, params: unknown) => unknown;
}

function harness(peer: Peer, transfer: PdfiumTransfer) {
  const client = createClient(pdfiumChannels, (channel, params) => {
    peer.asked.push({ channel, params });
    return Promise.resolve(peer.answer(channel, params));
  });
  const held = () => ({ session: 'a'.repeat(43), area: AREA });
  return {
    writer: remotePdfiumWriter(client, held, transfer),
    textObjects: remotePdfiumTextObjects(client, held, transfer),
  };
}

const COMMAND = {
  kind: 'replaceTextObject',
  page: 0,
  replacements: [{ index: 2, text: 'hi' }],
  version: 1,
} as never;

describe('main’s PDFium writer', () => {
  it('serialise is the identity and makes no call at all', async () => {
    const transfer = stubTransfer();
    const peer: Peer = {
      asked: [],
      answer: () => {
        throw new Error('serialise must not reach the wire');
      },
    };
    const { writer } = harness(peer, transfer);
    const image = new Uint8Array([1, 2, 3]);

    expect(await writer.serialise(image)).toBe(image);
    // BOTH HALVES. The same array is what `pdfLibWriter` promises, and the
    // empty ask list is what says this host has no `engine/serialise` to reach
    // — a member that called and returned its argument would satisfy the first.
    expect(peer.asked).toStrictEqual([]);
    expect(transfer.log).toStrictEqual([]);
  });

  it('applies by writing the image in, naming both files, and reading the answer back', async () => {
    const transfer = stubTransfer();
    const result = new Uint8Array([9, 9, 9, 9]);
    const peer: Peer = {
      asked: [],
      answer: (channel, params) => {
        expect(channel).toBe('engine/apply');
        const sent = params as { from: string; into: string };
        // THE INPUT IS THERE WHEN THE PEER IS CALLED, which is the ordering
        // that matters: a writer that called first and wrote after would pass
        // every assertion made afterwards.
        expect(transfer.snapshots.get(sent.from)).toStrictEqual(new Uint8Array([1, 2]));
        transfer.outputs.set(sent.into, result);
        return { ok: true, value: { bytes: result.length } };
      },
    };
    const { writer } = harness(peer, transfer);

    expect(await writer.apply(new Uint8Array([1, 2]), COMMAND)).toStrictEqual(result);
    // AND THE INPUT IS GONE. A file that outlives the call is one nothing holds
    // a name for, in a directory nothing sweeps until the host ends.
    expect(transfer.snapshots.size).toBe(0);
    expect(transfer.log).toStrictEqual(['write:001', 'take:002', 'remove:001']);
  });

  it('removes the input even when the host refuses', async () => {
    const transfer = stubTransfer();
    const peer: Peer = {
      asked: [],
      answer: () => ({ ok: false, error: { code: 'engine-refused' } }),
    };
    const { writer } = harness(peer, transfer);

    await expect(writer.apply(new Uint8Array([1, 2]), COMMAND)).rejects.toBeInstanceOf(
      EngineCallFailed,
    );
    // THE `finally` IS THE WHOLE OF THE LIFETIME, and this is the case that
    // says so: the happy path removes the file too, so only a refusal
    // separates a `finally` from a line at the end of the body.
    expect(transfer.snapshots.size).toBe(0);
    expect(transfer.log).toStrictEqual(['write:001', 'remove:001']);
  });

  it('turns no-such-session into the class the supervisor rebuilds for, and engine-refused into one it does not', async () => {
    const transfer = stubTransfer();
    let code = 'no-such-session';
    const peer: Peer = { asked: [], answer: () => ({ ok: false, error: { code } }) };
    const { writer } = harness(peer, transfer);

    await expect(writer.apply(new Uint8Array([1]), COMMAND)).rejects.toBeInstanceOf(
      EngineSessionGone,
    );
    // THE PAIR IS THE POINT. `EngineSessionGone` is what the supervisor answers
    // with a rebuild; a document this engine will refuse just as firmly next
    // time must NOT take that path, or a request that cannot succeed drives the
    // runaway ADR-0023 Decision 9a bounds.
    code = 'engine-refused';
    const refused = writer.apply(new Uint8Array([1]), COMMAND);
    await expect(refused).rejects.toBeInstanceOf(EngineCallFailed);
    await expect(refused).rejects.not.toBeInstanceOf(EngineSessionGone);
  });

  it('refuses an answer whose count disagrees with the file that arrived', async () => {
    const transfer = stubTransfer();
    const peer: Peer = {
      asked: [],
      answer: (_channel, params) => {
        const sent = params as { into: string };
        transfer.outputs.set(sent.into, new Uint8Array([7, 7]));
        // A COUNT THAT IS NOT THE FILE'S LENGTH. The host answers a number and
        // main reads a file, so "the host wrote nothing" and "the read found
        // nothing" are otherwise the same empty buffer.
        return { ok: true, value: { bytes: 99 } };
      },
    };
    const { writer } = harness(peer, transfer);

    await expect(writer.apply(new Uint8Array([1]), COMMAND)).rejects.toBeInstanceOf(
      EngineSerialiseMismatch,
    );
  });

  it('captures a prior, and refuses one tagged for a different command', async () => {
    const transfer = stubTransfer();
    let kind = 'replaceTextObject';
    const peer: Peer = {
      asked: [],
      answer: () => ({
        ok: true,
        value: {
          captured: true,
          value: { kind, prior: { page: 0, objects: [{ index: 2, text: 'WAS' }] } },
        },
      }),
    };
    const { writer } = harness(peer, transfer);

    const captured = await writer.capture(new Uint8Array([1]), COMMAND);
    expect(captured).toStrictEqual({
      captured: true,
      prior: { page: 0, objects: [{ index: 2, text: 'WAS' }] },
    });
    // A CAPTURE WRITES NOTHING OUT. Its params carry no `into`, so an output
    // name minted here would be one nothing ever reads.
    expect(transfer.log).toStrictEqual(['write:001', 'remove:001']);

    // A MIS-TAGGED PRIOR IS REFUSED — and the case asserts the refusal rather
    // than which layer produces it, because that moves and the property does
    // not.
    //
    // Today it is the BOUNDARY: `pdfiumPriorSchema` is a discriminated union of
    // one, so `rotatePages` is a malformed envelope and `createClient` throws
    // before the writer sees it. The tag check inside `capture` is therefore
    // unreachable through the wire right now — which was written down before
    // this case was run and is what this comment records, rather than deleting
    // a check that becomes live on the second PDFium command.
    //
    // Asserting `EngineCallFailed` here would have pinned the layer and gone
    // red on the day the union grew, for a change that fixes nothing.
    kind = 'rotatePages';
    await expect(writer.capture(new Uint8Array([1]), COMMAND)).rejects.toThrow();
    // AND THE INPUT IS STILL REMOVED, which is the half a refusal at the
    // boundary could plausibly skip: the throw comes from inside `withImage`'s
    // `call`, so only a `finally` cleans up after it.
    expect(transfer.snapshots.size).toBe(0);
  });

  it('passes a refused capture through as an OUTCOME, not a throw', async () => {
    const transfer = stubTransfer();
    const peer: Peer = {
      asked: [],
      answer: () => ({ ok: true, value: { captured: false, reason: 'no such object' } }),
    };
    const { writer } = harness(peer, transfer);

    // The bus answers `captured: false` by taking a checkpoint and applying
    // anyway (ADR-0009's 2026-08-19 decision), so it must arrive as a value.
    expect(await writer.capture(new Uint8Array([1]), COMMAND)).toStrictEqual({
      captured: false,
      reason: 'no such object',
    });
  });

  it('reads a page’s text objects through the same input write', async () => {
    const transfer = stubTransfer();
    const peer: Peer = {
      asked: [],
      answer: (channel, params) => {
        expect(channel).toBe('engine/text-objects');
        expect(params).toMatchObject({ page: 4 });
        return { ok: true, value: { indices: [1, 3], truncated: false } };
      },
    };
    const { textObjects } = harness(peer, transfer);

    expect(await textObjects(new Uint8Array([5]), 4)).toStrictEqual({
      indices: [1, 3],
      truncated: false,
    });
    expect(transfer.log).toStrictEqual(['write:001', 'remove:001']);
  });
});
