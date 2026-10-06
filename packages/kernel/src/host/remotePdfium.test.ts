import { describe, expect, it } from 'vitest';

import { createClient } from '@monstera/contract';

import { HeldPassword } from '@monstera/shared';

import type { ByteImage, ImageSession } from '../engineSeam.js';
import { NothingToReplaceError, ReplaceMovesLineError, TextNotInPlaceError } from '../textEditRefusals.js';
import { EngineCallFailed, EngineSessionGone, type SessionArea } from './remoteEngine.js';
import { EngineSerialiseMismatch } from './remoteLifecycle.js';
import { pdfiumChannels } from './pdfiumChannels.js';
import {
  type PdfiumInputKeeper,
  type PdfiumTransfer,
  remotePdfiumPageRuns,
  remotePdfiumRunFonts,
  remotePdfiumTextRuns,
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

/** A byte-image session over `bytes`, opening with `opensWith` or, as every fixture but one here, with none. */
const imageOf = (bytes: ByteImage, opensWith?: HeldPassword): ImageSession => ({ bytes, opensWith });

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
    // THROWS: PDFium's session holds its bytes in `main`, so its checkpoint is written there and nothing moves (ADR-0121).
    moveOutput: () => Promise.reject(new Error('a PDFium checkpoint is written in main, never moved from a host')),
    removeOutput: () => Promise.reject(new Error('PDFium stages nothing in a host, so nothing is discarded there')),
    remove: () => Promise.resolve(),
  };
}

/** The peer's answers, keyed by channel, plus what it was asked. */
interface Peer {
  readonly asked: { channel: string; params: unknown }[];
  answer: (channel: string, params: unknown) => unknown;
}

function harness(peer: Peer, transfer: PdfiumTransfer, keep?: PdfiumInputKeeper) {
  const client = createClient(pdfiumChannels, (channel, params) => {
    peer.asked.push({ channel, params });
    return Promise.resolve(peer.answer(channel, params));
  });
  const held = () => ({ session: 'a'.repeat(43), area: AREA });
  return {
    writer: remotePdfiumWriter(client, held, transfer, keep),
    textRuns: remotePdfiumTextRuns(client, held, transfer),
    runFonts: remotePdfiumRunFonts(client, held, transfer),
    pageRuns: remotePdfiumPageRuns(client, held, transfer),
  };
}

/**
 * A keeper that records what it was asked and, when `places`, puts `kept` where it was told — standing in for the
 * compose host's file-to-file copy (ADR-0126).
 */
function recordingKeeper(
  transfer: ReturnType<typeof stubTransfer>,
  places: boolean,
  kept: ByteImage = new Uint8Array([7, 7]),
): { readonly keep: PdfiumInputKeeper; readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    keep: (image, scope, into) => {
      // THE KEY ONLY WHEN ONE CAME, so the cases that send none read as they always did.
      const key = image.opensWith === undefined ? '' : ` key:${image.opensWith.reveal()}`;
      asked.push(`${String(scope)}@${into.directory}|${into.name}${key}`);
      if (places) transfer.snapshots.set(into.name, kept);
      return Promise.resolve(places);
    },
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

    expect(await writer.serialise(imageOf(image))).toBe(image);
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
        // A BOX AND A COUNT PAST IT (ADR-0174): both must reach the writer's answer, beside the image.
        return { ok: true, value: { bytes: result.length, boxed: [{ character: '中', page: 0 }], more: 4 } };
      },
    };
    const { writer } = harness(peer, transfer);

    expect(
      await writer.apply({
        session: imageOf(new Uint8Array([1, 2])),
        command: COMMAND,
        sources: [],
        reads: undefined,
      }),
    ).toStrictEqual({ image: result, boxed: [{ character: '中', page: 0 }], more: 4 });
    // AND THE INPUT IS GONE. A file that outlives the call is one nothing holds
    // a name for, in a directory nothing sweeps until the host ends.
    expect(transfer.snapshots.size).toBe(0);
    expect(transfer.log).toStrictEqual(['write:001', 'take:002', 'remove:001']);
  });

  /**
   * ADR-0126: a regenerating command's input is handed to the keeper, with the command's page and the exact name the
   * host will read — and what the keeper placed is what the host reads, not overwritten by the ordinary write.
   */
  it('a WRITE asks the keeper for its page, and the host reads what the keeper PLACED — no second write', async () => {
    const transfer = stubTransfer();
    const { keep, asked } = recordingKeeper(transfer, true);
    const result = new Uint8Array([9, 9]);
    const peer: Peer = {
      asked: [],
      answer: (_channel, params) => {
        const sent = params as { from: string; into: string };
        expect(transfer.snapshots.get(sent.from)).toStrictEqual(new Uint8Array([7, 7]));
        transfer.outputs.set(sent.into, result);
        return { ok: true, value: { bytes: result.length, boxed: [], more: 0 } };
      },
    };
    const { writer } = harness(peer, transfer, keep);
    await writer.apply({ session: imageOf(new Uint8Array([1, 2])), command: COMMAND, sources: [], reads: undefined });
    expect(asked).toStrictEqual(['0@C:\\snap|001']);
    expect(transfer.log).toStrictEqual(['take:002', 'remove:001']);
  });

  it('sends the key the session carries on the frame, and hands the keeper the key too (ADR-0171)', async () => {
    const transfer = stubTransfer();
    const { keep, asked } = recordingKeeper(transfer, true);
    const sent: unknown[] = [];
    const peer: Peer = {
      asked: [],
      answer: (_channel, params) => {
        const frame = params as { into: string; password: unknown };
        sent.push(frame.password);
        transfer.outputs.set(frame.into, new Uint8Array([9]));
        return { ok: true, value: { bytes: 1, boxed: [], more: 0 } };
      },
    };
    const { writer } = harness(peer, transfer, keep);
    const key = new HeldPassword('sample-only-0171');
    await writer.apply({ session: imageOf(new Uint8Array([1, 2]), key), command: COMMAND, sources: [], reads: undefined });
    // CONTROL: the same apply with none sends `null`, the field's own word for none, never an absent field.
    await writer.apply({ session: imageOf(new Uint8Array([1, 2])), command: COMMAND, sources: [], reads: undefined });

    expect(sent).toStrictEqual(['sample-only-0171', null]);
    expect(asked).toStrictEqual(['0@C:\\snap|001 key:sample-only-0171', '0@C:\\snap|003']);
  });

  it('CONTROL: a keeper that placed nothing leaves the ordinary write, of the image as it was', async () => {
    const transfer = stubTransfer();
    const { keep, asked } = recordingKeeper(transfer, false);
    const peer: Peer = {
      asked: [],
      answer: (_channel, params) => {
        const sent = params as { from: string; into: string };
        expect(transfer.snapshots.get(sent.from)).toStrictEqual(new Uint8Array([1, 2]));
        transfer.outputs.set(sent.into, new Uint8Array([9]));
        return { ok: true, value: { bytes: 1, boxed: [], more: 0 } };
      },
    };
    const { writer } = harness(peer, transfer, keep);
    await writer.apply({ session: imageOf(new Uint8Array([1, 2])), command: COMMAND, sources: [], reads: undefined });
    expect(asked).toStrictEqual(['0@C:\\snap|001']);
    expect(transfer.log).toStrictEqual(['write:001', 'take:002', 'remove:001']);
  });

  it('an UNDO asks the keeper for the page its prior restores; a CAPTURE, which regenerates nothing, never asks', async () => {
    const transfer = stubTransfer();
    const { keep, asked } = recordingKeeper(transfer, false);
    const peer: Peer = {
      asked: [],
      answer: (channel, params) => {
        if (channel === 'engine/capture') {
          return { ok: true, value: { captured: true, value: { kind: 'replaceTextObject', prior: { page: 0, objects: [{ index: 2, text: 'WAS' }] } } } };
        }
        transfer.outputs.set((params as { into: string }).into, new Uint8Array([9]));
        return { ok: true, value: { bytes: 1, boxed: [], more: 0 } };
      },
    };
    const { writer } = harness(peer, transfer, keep);
    await writer.capture(imageOf(new Uint8Array([1])), COMMAND);
    expect(asked).toStrictEqual([]);
    await writer.invert(imageOf(new Uint8Array([1])), 'replaceTextObject', { page: 5, objects: [{ index: 2, text: 'WAS' }] });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/^5@/u);
  });

  it('removes the input even when the host refuses', async () => {
    const transfer = stubTransfer();
    const peer: Peer = {
      asked: [],
      answer: () => ({ ok: false, error: { code: 'engine-refused' } }),
    };
    const { writer } = harness(peer, transfer);

    await expect(
      writer.apply({
        session: imageOf(new Uint8Array([1, 2])),
        command: COMMAND,
        sources: [],
        reads: undefined,
      }),
    ).rejects.toBeInstanceOf(EngineCallFailed);
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

    await expect(
      writer.apply({
        session: imageOf(new Uint8Array([1])),
        command: COMMAND,
        sources: [],
        reads: undefined,
      }),
    ).rejects.toBeInstanceOf(EngineSessionGone);
    // THE PAIR IS THE POINT. `EngineSessionGone` is what the supervisor answers
    // with a rebuild; a document this engine will refuse just as firmly next
    // time must NOT take that path, or a request that cannot succeed drives the
    // runaway ADR-0023 Decision 9a bounds.
    code = 'engine-refused';
    const refused = writer.apply({
      session: imageOf(new Uint8Array([1])),
      command: COMMAND,
      sources: [],
      reads: undefined,
    });
    await expect(refused).rejects.toBeInstanceOf(EngineCallFailed);
    await expect(refused).rejects.not.toBeInstanceOf(EngineSessionGone);
  });

  it('turns nothing-to-replace into the class the local writer throws, and text-not-in-place into its own (ADR-0169)', async () => {
    const transfer = stubTransfer();
    let code = 'nothing-to-replace';
    const peer: Peer = { asked: [], answer: () => ({ ok: false, error: { code } }) };
    const { writer } = harness(peer, transfer);
    const apply = () => writer.apply({ session: imageOf(new Uint8Array([1])), command: COMMAND, sources: [], reads: undefined });

    // THE SAME CLASS IN EITHER PROCESS, so main says *nothing matched* whichever applied it, never *Something went wrong*.
    await expect(apply()).rejects.toBeInstanceOf(NothingToReplaceError);
    // AND ITS NEIGHBOUR STAYS ITS OWN: a mapping that answered every person's refusal with one class passes the line
    // above and fails this one.
    code = 'text-not-in-place';
    const misplaced = apply();
    await expect(misplaced).rejects.toBeInstanceOf(TextNotInPlaceError);
    await expect(misplaced).rejects.not.toBeInstanceOf(NothingToReplaceError);
    // AND A REPLACEMENT THAT WOULD MOVE ITS LINE is its own class too, for the same reason.
    code = 'replace-moves-line';
    const moving = apply();
    await expect(moving).rejects.toBeInstanceOf(ReplaceMovesLineError);
    await expect(moving).rejects.not.toBeInstanceOf(NothingToReplaceError);
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
        return { ok: true, value: { bytes: 99, boxed: [], more: 0 } };
      },
    };
    const { writer } = harness(peer, transfer);

    await expect(
      writer.apply({
        session: imageOf(new Uint8Array([1])),
        command: COMMAND,
        sources: [],
        reads: undefined,
      }),
    ).rejects.toBeInstanceOf(EngineSerialiseMismatch);
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

    const captured = await writer.capture(imageOf(new Uint8Array([1])), COMMAND);
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
    await expect(writer.capture(imageOf(new Uint8Array([1])), COMMAND)).rejects.toThrow();
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
    expect(await writer.capture(imageOf(new Uint8Array([1])), COMMAND)).toStrictEqual({
      captured: false,
      reason: 'no such object',
    });
  });

  /**
   * A PRIOR ABOVE THE CEILING IS A PRIOR THAT CANNOT BE RECORDED (ADR-0125): the bus's checkpoint, never a failed
   * edit. The CONTROL is the next declared failure in the same shape, which still throws — so this is the code's rule
   * and not every failure turned into a checkpoint.
   */
  it('answers a capture above the ceiling as a prior it cannot record, and still throws for any other failure', async () => {
    let code = 'answer-too-large';
    const peer: Peer = { asked: [], answer: () => ({ ok: false, error: { code } }) };
    const { writer } = harness(peer, stubTransfer());

    expect(await writer.capture(imageOf(new Uint8Array([1])), COMMAND)).toMatchObject({
      captured: false,
      reason: expect.stringMatching(/larger than the \d+-byte ceiling/u) as unknown,
    });

    // A DECLARED code, so the boundary passes it and the refusal is the writer's rule — an undeclared one would be
    // refused as a malformed envelope first, and this control would pass for that reason.
    code = 'asset-missing';
    await expect(writer.capture(imageOf(new Uint8Array([1])), COMMAND)).rejects.toThrow(/asset-missing/u);
  });

  /**
   * A BLOCK'S FONTS COME BACK OUT OF THE OUTPUT DIRECTORY in one file, cut where each size ends (ADR-0175), and no sizes
   * is a block with none: nothing is taken, since the host wrote nothing. Each is the other's control, and the input is
   * removed either way.
   */
  it('cuts a block’s fonts out of one file by the sizes the host answered, and for none takes nothing', async () => {
    const transfer = stubTransfer();
    let sizes = [3, 2];
    const peer: Peer = {
      asked: [],
      answer: (channel, params) => {
        expect(channel).toBe('engine/run-fonts');
        expect(params).toMatchObject({ page: 2, indices: [6, 7, 9] });
        if (sizes.length > 0) transfer.outputs.set((params as { into: string }).into, new Uint8Array([1, 2, 3, 8, 9]));
        return { ok: true, value: { sizes, runs: sizes.length > 0 ? [1, null, 0] : [null, null, null] } };
      },
    };
    const { runFonts } = harness(peer, transfer);
    const read = await runFonts(imageOf(new Uint8Array([5])), 2, [6, 7, 9]);
    expect(read.fonts.map((font) => Array.from(font))).toStrictEqual([[1, 2, 3], [8, 9]]);
    expect(read.runs).toStrictEqual([1, null, 0]);
    sizes = [];
    transfer.log.length = 0;
    expect(await runFonts(imageOf(new Uint8Array([5])), 2, [6, 7, 9])).toStrictEqual({ fonts: [], runs: [null, null, null] });
    expect(transfer.log.some((entry) => entry.startsWith('take:'))).toBe(false);
    expect(transfer.log.at(-1)?.startsWith('remove:')).toBe(true);
  });

  describe('a page’s runs with their members (ADR-0176’s pageRuns)', () => {
    const asking = (runs: unknown[]) => {
      const transfer = stubTransfer();
      const peer: Peer = {
        asked: [],
        answer: (channel, params) => {
          expect(channel).toBe('engine/page-runs');
          expect(params).toMatchObject({ page: 4 });
          return { ok: true, value: { textObjects: [0, 2, 3], runs } };
        },
      };
      return { transfer, pageRuns: harness(peer, transfer).pageRuns };
    };
    const run = (index: number, members: number[]) => ({ index, members, text: 'x', left: 0, right: 1, bottom: 0, top: 1 });

    it('answers the host’s reading, and removes the input it wrote whatever happened', async () => {
      const { transfer, pageRuns } = asking([run(0, [0, 2]), run(3, [3])]);
      expect(await pageRuns(imageOf(new Uint8Array([5])), 4)).toStrictEqual({
        textObjects: [0, 2, 3],
        runs: [run(0, [0, 2]), run(3, [3])],
      });
      expect(transfer.log.at(-1)?.startsWith('remove:')).toBe(true);
    });

    it('refuses a member that is not one of the text objects the same answer names', async () => {
      // OBJECT 1 IS NOT TEXT here: a host naming it would have the writer set a rule as a glyph.
      await expect(asking([run(0, [0, 1])]).pageRuns(imageOf(new Uint8Array([5])), 4)).rejects.toThrow(/object 1 in a run/u);
    });

    it('refuses an object named in two runs', async () => {
      await expect(asking([run(0, [0, 2]), run(2, [2, 3])]).pageRuns(imageOf(new Uint8Array([5])), 4)).rejects.toThrow(/two runs/u);
    });
  });

  it('refuses a block’s fonts whose sizes disagree with the file that arrived', async () => {
    const transfer = stubTransfer();
    const peer: Peer = {
      asked: [],
      answer: (_channel, params) => {
        transfer.outputs.set((params as { into: string }).into, new Uint8Array([1, 2, 3]));
        return { ok: true, value: { sizes: [4], runs: [0] } };
      },
    };
    const { runFonts } = harness(peer, transfer);
    await expect(runFonts(imageOf(new Uint8Array([5])), 0, [1])).rejects.toBeInstanceOf(EngineSerialiseMismatch);
  });

  /**
   * THE ANSWER IS HELD TO THE QUESTION, which the channel's schema cannot do: it bounds each field and sees neither the
   * request nor the other field. A run too few, and a place past the fonts answered, are each refused; the same answer
   * with the right count and a place in range is the control, read whole.
   */
  it('refuses an answer with a run too few, or naming a font it does not carry', async () => {
    const transfer = stubTransfer();
    let runs: (number | null)[] = [0];
    const peer: Peer = {
      asked: [],
      answer: (_channel, params) => {
        transfer.outputs.set((params as { into: string }).into, new Uint8Array([1, 2]));
        return { ok: true, value: { sizes: [2], runs } };
      },
    };
    const { runFonts } = harness(peer, transfer);
    await expect(runFonts(imageOf(new Uint8Array([5])), 0, [1, 4])).rejects.toThrow(/answered 1 runs for 2 asked/u);
    runs = [0, 1];
    await expect(runFonts(imageOf(new Uint8Array([5])), 0, [1, 4])).rejects.toThrow(/past the 1 it answered/u);
    runs = [0, 0];
    expect((await runFonts(imageOf(new Uint8Array([5])), 0, [1, 4])).runs).toStrictEqual([0, 0]);
  });

  it('reads a page’s text runs through the same input write', async () => {
    const transfer = stubTransfer();
    const runs = [
      {
        index: 1,
        // A JOINED RUN, objects 1 to 2 (ADR-0130), so the read is seen carrying `last` through, not inventing it.
        last: 2,
        text: 'ONE',
        bottom: 229.9,
        top: 238.0,
        left: 72.5,
        right: 110.25,
        style: {
          size: 11,
          colour: { r: 12, g: 34, b: 56 },
          font: 'Georgia-Italic',
          serif: true,
          mono: false,
          italic: true,
          bold: false,
          orientation: 'upright' as const,
        },
      },
      {
        index: 3,
        last: 3,
        text: 'TWO',
        bottom: 189.9,
        top: 198.0,
        left: 72.5,
        right: 104.75,
        style: {
          size: 9.5,
          colour: { r: 200, g: 0, b: 7 },
          font: 'Courier-Bold',
          serif: false,
          mono: true,
          italic: false,
          bold: true,
          orientation: 'turned' as const,
        },
      },
    ];
    const peer: Peer = {
      asked: [],
      answer: (channel, params) => {
        expect(channel).toBe('engine/text-runs');
        expect(params).toMatchObject({ page: 4 });
        return { ok: true, value: { runs, truncated: false, unaddressable: 9 } };
      },
    };
    const { textRuns } = harness(peer, transfer);

    // EQUALITY AND NOT A SUBSET, because this reader's whole job is to forward
    // what the host said: a `toMatchObject` on the indices would pass against
    // one that dropped the text and the extent, and both are what the grouping
    // and the chooser above it are made of.
    expect(await textRuns(imageOf(new Uint8Array([5])), 4)).toStrictEqual({ runs, truncated: false, unaddressable: 9 });
    expect(transfer.log).toStrictEqual(['write:001', 'remove:001']);
  });
});
