import {
  type ChannelMap,
  ENGINE_ANSWER_FILE_MAX_BYTES,
  ENGINE_HOST_FRAME_MAX_BYTES,
  WORST_BYTES_PER_CHAR,
  commandSchema,
  createFormFieldSchema,
  createdFieldPlacementSchema,
  hostRouteViolations,
  keepableSignatureSchema,
  maxEncodedBytes,
  unboundedMembers,
  MAX_CREATED_FIELDS,
} from '@monstera/contract';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { composeChannels } from './composeChannels.js';
import { engineChannels } from './engineChannels.js';
import { pdfiumChannels } from './pdfiumChannels.js';

/**
 * EVERY CONTAINED HOST'S CHANNELS ARE ON A ROUTE THAT CAN CARRY WHAT THEIR SCHEMAS ADMIT (ADR-0125).
 *
 * The owner's install of 0.1.5.0 ended the PDFium host on Edit text because `engine/text-runs`' schema admitted far more
 * than a frame and a real page produced it. A channel added tomorrow with an unbounded result, framed, is the same
 * defect waiting for its document; this is the line that goes red the day it is declared rather than the day a person's
 * file finds it.
 */
const HOSTS = { 'MuPDF host': engineChannels, 'PDFium host': pdfiumChannels, 'compose host': composeChannels };

const violationsOf = (channels: ChannelMap) =>
  hostRouteViolations(channels, ENGINE_HOST_FRAME_MAX_BYTES, ENGINE_ANSWER_FILE_MAX_BYTES);

/**
 * THE REQUESTS NO SCHEMA CAN BOUND, pinned by exact set per host so a channel that joins is red and one that leaves
 * must be taken off (ADR-0138 Decision 4). Every one is file-requested; no framed request is past the frame.
 *
 * - `engine/invert`: its params are a capture's answer, which crossed under the same ceiling to reach main.
 * - `engine/applyPdfLib`: its pre-read is `engine/ocr-page`'s or `engine/destinations`' answer, by the same argument;
 *   the case below holds the rest of its params to the ceiling.
 *
 * PDFium's `engine/apply` and `engine/capture` LEFT this set with ADR-0142: its two text edits carry one list and one
 * text each, so their worst is a sum under the ceiling (`commands.test.ts` measures both).
 */
const PAST_THE_ROUTE: Readonly<Record<keyof typeof HOSTS, readonly string[]>> = {
  'MuPDF host': ['engine/invert', 'engine/applyPdfLib'],
  'PDFium host': ['engine/invert'],
  'compose host': [],
};

describe('the engine hosts’ declared routes', () => {
  for (const [host, channels] of Object.entries(HOSTS)) {
    it(`${host}: every answer's route carries what its schema admits`, () => {
      expect(violationsOf(channels).filter((found) => found.direction === 'answer')).toStrictEqual([]);
    });

    it(`${host}: no framed request outgrows the frame, and the file requests past the ceiling are the pinned ones`, () => {
      const requests = violationsOf(channels).filter((found) => found.direction === 'request');
      const map: ChannelMap = channels;
      expect(requests.filter((found) => map[found.channel]?.request === 'frame')).toStrictEqual([]);
      expect(requests.map((found) => found.channel).sort()).toStrictEqual([...PAST_THE_ROUTE[host as keyof typeof HOSTS]].sort());
    });
  }

  /** The pre-read is exempt by the route that brought it; the command beside it is not. */
  it('engine/applyPdfLib, its pre-read left out, fits the file ceiling at its worst', () => {
    const rest = engineChannels['engine/applyPdfLib'].params.omit({ reads: true });
    expect(maxEncodedBytes(rest, WORST_BYTES_PER_CHAR, 'input')).toBeLessThan(ENGINE_ANSWER_FILE_MAX_BYTES);
  });

  /**
   * GENERATE TOC ON A REAL OUTLINE, the size that failed (JOURNAL, *No document-size refusals*, table A row 5): about
   * 3,500 bookmarks of ordinary length were past the 256 KiB request frame, so the table of contents failed as
   * `internal`. The pre-read crosses in a file (ADR-0138); `proof:hostfileanswers` drives that route through the real
   * host. This holds the outline at the size that broke: admitted by the schema, and past the frame it once travelled in.
   */
  it('engine/applyPdfLib takes 3,600 ordinary bookmarks, which no frame carries, by the file route', () => {
    const outline = Array.from({ length: 3600 }, (_, index) => ({
      title: `Section ${String(index + 1)}: a heading of ordinary length`,
      page: index,
      depth: index % 3,
    }));
    const channel = engineChannels['engine/applyPdfLib'];
    expect(channel.params.shape.reads.safeParse(outline).success).toBe(true);
    expect(channel.request).toBe('file');
    // THE INPUT IS AT THE BREAKING SIZE: an outline a frame carries would pass here against the framed route too.
    expect(new TextEncoder().encode(JSON.stringify(outline)).byteLength).toBeGreaterThan(ENGINE_HOST_FRAME_MAX_BYTES);
  });

  /** THE CONTROL: with the pre-read in, the same channel is past the ceiling, so the exemption above is load-bearing. */
  it('CONTROL: and with its pre-read in, it is past the ceiling', () => {
    expect(maxEncodedBytes(engineChannels['engine/applyPdfLib'].params, WORST_BYTES_PER_CHAR, 'input')).toBeGreaterThan(
      ENGINE_ANSWER_FILE_MAX_BYTES,
    );
  });
});

/**
 * EACH COMMAND KIND, ON ITS WRITER'S CHANNEL, FITS THAT CHANNEL'S ROUTE (ADR-0138). Read as the wire parses it: the
 * union each host's `engine/apply` declares, on the input side, with no `.strict()` forced on. A kind past its route is
 * a person's ordinary action refused as too large.
 */
const WRITERS = {
  mupdf: engineChannels['engine/apply'],
  'pdf-lib': engineChannels['engine/applyPdfLib'],
  pdfium: pdfiumChannels['engine/apply'],
};

/** Where a kind on that writer's channel has to fit. */
const capacityOf = (route: 'frame' | 'file'): number =>
  route === 'frame' ? ENGINE_HOST_FRAME_MAX_BYTES : ENGINE_ANSWER_FILE_MAX_BYTES;

/**
 * Kinds past their writer's route, by exact set: none since ADR-0142 reshaped PDFium's two text edits, which were the
 * two. Empty and still pinned, so a kind that grows past its route is red rather than tolerated.
 */
const KINDS_PAST_THE_ROUTE: readonly string[] = [];

type KindOption = z.ZodObject<{ kind: z.ZodLiteral<string> }>;

function kindsOf(union: z.ZodType): readonly KindOption[] {
  return (union as unknown as { readonly options: readonly KindOption[] }).options;
}

describe('every command kind, on its writer’s channel', () => {
  it('has a worst at all: no kind reads as unbounded on the wire', () => {
    const unbounded = Object.values(WRITERS).flatMap((writer) =>
      kindsOf(writer.params.shape.command)
        .filter((option) => maxEncodedBytes(option, WORST_BYTES_PER_CHAR, 'input') === Infinity)
        .map((option) => option.shape.kind.value),
    );
    expect(unbounded).toStrictEqual([]);
  });

  /** The 22 kinds the audit could not measure, and the 31 that only measured because the check forced `.strict()`. */
  it('CONTROL: a command object that is not strict reads as unbounded on the wire', () => {
    const open = z.object({ kind: z.literal('rotatePages'), page: z.number().int().min(0).max(10) });
    expect(maxEncodedBytes(open, WORST_BYTES_PER_CHAR, 'input')).toBe(Infinity);
    expect(maxEncodedBytes(open.strict(), WORST_BYTES_PER_CHAR, 'input')).toBeLessThan(100);
  });

  it('fits its writer’s route at its worst, and the exceptions are exactly the pinned ones', () => {
    const past: string[] = [];
    for (const writer of Object.values(WRITERS)) {
      for (const option of kindsOf(writer.params.shape.command)) {
        if (maxEncodedBytes(option, WORST_BYTES_PER_CHAR, 'input') > capacityOf(writer.request)) {
          past.push(option.shape.kind.value);
        }
      }
    }
    expect(past.sort()).toStrictEqual([...KINDS_PAST_THE_ROUTE].sort());
  });

  /**
   * Each writer's union is the command union's members routed there, so no kind that crosses a host escapes the three
   * channels. `signDocument` is the one that crosses none: `signpdf` is pure JavaScript, composed in `main`.
   */
  it('the three writers’ unions carry every kind of the command union but the one written in main', () => {
    const carried = Object.values(WRITERS).flatMap((writer) =>
      kindsOf(writer.params.shape.command).map((option) => option.shape.kind.value),
    );
    expect(new Set([...carried, 'signDocument'])).toStrictEqual(
      new Set(commandSchema.options.map((option) => option.shape.kind.value)),
    );
    expect(carried).not.toContain('signDocument');
  });

  it('createFormField, carrying many simple fields or one of any kind, fits the file ceiling (DDDDDDD-10)', () => {
    expect(maxEncodedBytes(createFormFieldSchema, WORST_BYTES_PER_CHAR, 'input')).toBeLessThan(
      ENGINE_ANSWER_FILE_MAX_BYTES,
    );
  });

  /** THE CONTROL: the shape it had, any field kind up to the bound, is far past the ceiling by the same reading. */
  it('CONTROL: createFormField as it was, any kind up to 256 fields, is past the ceiling', () => {
    const before = createFormFieldSchema
      .extend({ fields: z.array(createdFieldPlacementSchema).min(1).max(MAX_CREATED_FIELDS) })
      .strict();
    expect(maxEncodedBytes(before, WORST_BYTES_PER_CHAR, 'input')).toBeGreaterThan(ENGINE_ANSWER_FILE_MAX_BYTES * 10);
  });

  it('a placed drawing at its bound is under three quarters of the frame', () => {
    const placing = commandSchema.options.find((option) => option.shape.kind.value === 'placeSignatureMark');
    if (placing === undefined) throw new Error('placeSignatureMark is not in the command union');
    expect(maxEncodedBytes(placing, WORST_BYTES_PER_CHAR, 'input')).toBeLessThan(ENGINE_HOST_FRAME_MAX_BYTES * 0.75);
  });

  /** THE CONTROL: the command as it was, carrying a kept drawing's strokes, is past the frame by the same reading. */
  it('CONTROL: placeSignatureMark carrying a kept drawing, as before DDDDDDD-1, is past the frame', () => {
    const placing = commandSchema.options.find((option) => option.shape.kind.value === 'placeSignatureMark');
    if (placing === undefined) throw new Error('placeSignatureMark is not in the command union');
    const before = placing.extend({ mark: keepableSignatureSchema }).strict();
    expect(maxEncodedBytes(before, WORST_BYTES_PER_CHAR, 'input')).toBeGreaterThan(ENGINE_HOST_FRAME_MAX_BYTES);
  });

  /** Decision D: every page list is a bounded page set, so no array or string anywhere in a command is unbounded. */
  it('no array or string in the command union is unbounded — page lists included', () => {
    expect(unboundedMembers(commandSchema, 'command')).toStrictEqual([]);
  });

  /**
   * THE CONTROL, because an empty list is also what a blind walk answers: the page list as it was before decision D,
   * one index per page, is reported by the same reader.
   */
  it('CONTROL: the index list the fifteen commands took before decision D is reported unbounded', () => {
    const before = z.object({ kind: z.literal('rotatePages'), pages: z.array(z.number().int().nonnegative()).min(1) });
    expect(unboundedMembers(before, 'command')).toStrictEqual(['array  command.properties.pages']);
  });
});

describe('the walk can see', () => {
  /**
   * THE WALK CAN SEE THE CHANNEL THE OWNER HIT. An empty list above is the reassuring answer, and a walk that answered
   * small for everything would print it too.
   */
  it('CONTROL: engine/text-runs admits more than a frame, so the empty lists above are the routes and not a blind walk', () => {
    expect(maxEncodedBytes(pdfiumChannels['engine/text-runs'].result, 1)).toBeGreaterThan(ENGINE_HOST_FRAME_MAX_BYTES);
  });

  /** The owner's defect, re-declared: the same channel framed, as it was in 0.1.5.0, is reported. */
  it('CONTROL: and engine/text-runs declared in the frame, as 0.1.5.0 shipped it, is reported', () => {
    const shipped = { 'engine/text-runs': { ...pdfiumChannels['engine/text-runs'], answer: 'frame' as const } };
    expect(violationsOf(shipped)).toMatchObject([{ channel: 'engine/text-runs', direction: 'answer' }]);
  });

  /** Undo's pair, re-declared before its addendum: the prior framed back as invert's params is reported. */
  it('CONTROL: engine/invert with its params framed, as before the addendum, is reported', () => {
    const framed = { 'engine/invert': { ...engineChannels['engine/invert'], request: 'frame' as const } };
    expect(violationsOf(framed)).toMatchObject([{ channel: 'engine/invert', direction: 'request' }]);
  });

  /** ADR-0138's own control: the pdf-lib channel framed, as it was, is reported past the frame. */
  it('CONTROL: engine/applyPdfLib with its params framed, as before ADR-0138, is reported past the frame', () => {
    const framed = { 'engine/applyPdfLib': { ...engineChannels['engine/applyPdfLib'], request: 'frame' as const } };
    expect(violationsOf(framed)).toMatchObject([
      { channel: 'engine/applyPdfLib', direction: 'request', reason: expect.stringMatching(/frame/u) as unknown },
    ]);
  });
});
