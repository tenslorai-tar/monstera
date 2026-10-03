import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  MAX_EDIT_RUNS,
  MAX_EDIT_TEXT,
  blockEditOf,
  blocksOfEdit,
  editTextBlockSchema,
  replaceTextObjectSchema,
  replacementFieldsOf,
  replacementsOf,
  styleAnnotationSchema,
  targetVersionOf,
  withTargetVersion,
} from './commands.js';
import { asDocVersion } from '@monstera/shared';
import { ENGINE_ANSWER_FILE_MAX_BYTES } from './hostProtocol.js';
import { WORST_BYTES_PER_CHAR, maxEncodedBytes } from './schemaBound.js';

/**
 * What the two in-place text edits REFUSE, which is the half a shape test cannot see.
 *
 * ## Why this file exists at all
 *
 * `replaceTextObject` names several objects so that a visual line — several text objects, because PDFium answers one
 * rect per run — is one command, one content regeneration and one undo step. A list brings rules a single field did
 * not have, and each is a refusal: **at least one object**, **no object twice**, and, in the wire form ADR-0142 gave
 * both edits — one list and one text, with where each entry starts — **starts that describe the lists**. None is
 * visible in a case that parses a well-formed payload, and an accept-only file would pass identically against a
 * schema that accepted anything.
 *
 * So every case below that matters asserts a REJECTION, and each is paired with the nearest accepted payload —
 * otherwise a schema that refused everything would satisfy the refusals and nothing would say so.
 */
const version = 3 as never;

/** A payload that parses, which every case here varies one field of. */
const good = {
  kind: 'replaceTextObject' as const,
  page: 0,
  ...replacementFieldsOf([{ index: 4, text: 'HELLO' }]),
  version,
};

describe('the in-place text edit payload', () => {
  it('accepts a single replacement, which is what region replacement sends', () => {
    // THE POSITIVE CONTROL for every refusal below. Without it, a schema that rejected all input would pass this file.
    expect(replaceTextObjectSchema.safeParse(good).success).toBe(true);
  });

  it('accepts several replacements on ONE page, and reads them back as they were built', () => {
    const replacements = [
      { index: 4, text: 'LEFT HALF ' },
      { index: 9, text: '' },
      { index: 2, text: 'RIGHT HALF' },
    ];
    const command = { ...good, ...replacementFieldsOf(replacements) };
    expect(replaceTextObjectSchema.safeParse(command).success).toBe(true);
    // THE ROUND TRIP, with an EMPTY text in the middle: two starts at one offset, which a decoder slicing to the next
    // DISTINCT start would read as the following object's words.
    expect(replacementsOf(command)).toStrictEqual(replacements);
  });

  it('REFUSES a list naming one object twice', () => {
    // TWO OPINIONS ABOUT ONE OBJECT, and every rule for choosing between them — last wins, first wins, concatenate —
    // is a rule a reader has to look up. The two entries carry DIFFERENT text, the shape that actually conflicts.
    const parsed = replaceTextObjectSchema.safeParse({
      ...good,
      ...replacementFieldsOf([
        { index: 4, text: 'ONE' },
        { index: 4, text: 'ANOTHER' },
      ]),
    });
    expect(parsed.success).toBe(false);
    // THE MESSAGE, not merely the refusal: a payload can fail for a dozen reasons and `success: false` cannot tell
    // which.
    expect(parsed.error?.issues[0]?.message).toContain('more than once');
  });

  it('REFUSES an empty list', () => {
    // A command naming nothing would regenerate a page's content stream for no change.
    expect(replaceTextObjectSchema.safeParse({ ...good, objects: [], starts: [], text: '' }).success).toBe(false);
  });

  it('REFUSES starts that do not describe the text: too few, out of order, or past its end', () => {
    const two = { ...good, ...replacementFieldsOf([{ index: 1, text: 'ab' }, { index: 2, text: 'cd' }]) };
    expect(replaceTextObjectSchema.safeParse(two).success).toBe(true);
    for (const starts of [[0], [2, 0], [1, 2], [0, 5]]) {
      expect(replaceTextObjectSchema.safeParse({ ...two, starts }).success, JSON.stringify(starts)).toBe(false);
    }
  });

  it('REFUSES a list longer than a page’s runs, and accepts one exactly that long', () => {
    // BOTH SIDES OF THE BOUND, built FROM the constant, so a raised bound moves both cases together.
    const exactly = Array.from({ length: MAX_EDIT_RUNS }, (_, at) => ({ index: at, text: 'x' }));
    expect(replaceTextObjectSchema.safeParse({ ...good, ...replacementFieldsOf(exactly) }).success).toBe(true);
    const over = [...exactly, { index: MAX_EDIT_RUNS, text: 'x' }];
    expect(replaceTextObjectSchema.safeParse({ ...good, ...replacementFieldsOf(over) }).success).toBe(false);
  });

  it('REFUSES a field it does not declare, so one command cannot span two pages', () => {
    // The page is shared, and the reason is the cost model: `FPDFPage_GenerateContent` is paid per page. A schema that
    // ignored an extra key would leave a caller believing it had been honoured.
    expect(replaceTextObjectSchema.safeParse({ ...good, pages: [1] }).success).toBe(false);
  });
});

describe('the block edit payload (ADR-0142)', () => {
  const blocks = [
    { lines: [[3, 4], [7]], text: 'First block\nsecond line' },
    { lines: [[9]], text: '' },
    { lines: [[12, 11, 10]], text: 'Third' },
  ];
  const command = { kind: 'editTextBlock' as const, page: 2, ...blockEditOf(blocks), fit: 'reflow' as const, version };

  it('accepts blocks built by the encoder, and the decoder reads back exactly those blocks', () => {
    expect(editTextBlockSchema.safeParse(command).success).toBe(true);
    // An EMPTY block's words in the middle and runs out of numeric order: the two places a decoder slicing by the
    // wrong boundary would go wrong.
    expect(blocksOfEdit(command)).toStrictEqual(blocks);
  });

  it('takes a translated paragraph past the 4,096 characters one text once had (table A row 10)', () => {
    const long = 'Une phrase traduite qui continue. '.repeat(160);
    expect(long.length).toBeGreaterThan(4096);
    const edit = { ...command, ...blockEditOf([{ lines: [[1]], text: long }]) };
    expect(editTextBlockSchema.safeParse(edit).success).toBe(true);
    // CONTROL: the bound is still there, at the page's text.
    const past = { ...command, ...blockEditOf([{ lines: [[1]], text: 'x'.repeat(MAX_EDIT_TEXT + 1) }]) };
    expect(editTextBlockSchema.safeParse(past).success).toBe(false);
  });

  it('REFUSES a run named in two blocks, which would be written twice', () => {
    const twice = { ...command, ...blockEditOf([{ lines: [[1]], text: 'a' }, { lines: [[1]], text: 'b' }]) };
    expect(editTextBlockSchema.safeParse(twice).success).toBe(false);
  });

  it('REFUSES starts that leave a line with no run or a block with no line', () => {
    const emptyLine = { ...command, lineStarts: [0, 0, 2, 3, 4] };
    const emptyBlock = { ...command, blockStarts: [0, 0, 2] };
    expect(editTextBlockSchema.safeParse(emptyLine).success).toBe(false);
    expect(editTextBlockSchema.safeParse(emptyBlock).success).toBe(false);
  });

  it('REFUSES a text start per block that does not match, or a fit per block', () => {
    expect(editTextBlockSchema.safeParse({ ...command, textStarts: [0, 23] }).success).toBe(false);
    expect(editTextBlockSchema.safeParse({ ...command, fit: ['reflow'] }).success).toBe(false);
  });
});

describe('both text edits fit the file a PDFium command crosses in, at their worst (ADR-0142, item H)', () => {
  // ADR-0138 read 12,601,952 B for `replaceTextObject` and 4,589,655,126 B for `editTextBlock`: nested per-entry
  // bounds the walk multiplies. One list and one text make it a sum. Measured by the walk the route rule uses, on the
  // side the JSON is parsed against.
  const worst = (schema: Parameters<typeof maxEncodedBytes>[0]): number =>
    maxEncodedBytes(schema, WORST_BYTES_PER_CHAR, 'input');

  it('replaceTextObject and editTextBlock are each under the 8 MiB ceiling', () => {
    expect(worst(replaceTextObjectSchema)).toBeLessThan(ENGINE_ANSWER_FILE_MAX_BYTES);
    expect(worst(editTextBlockSchema)).toBeLessThan(ENGINE_ANSWER_FILE_MAX_BYTES);
  });

  it('CONTROL: the same walk reads the nested shape this replaced as past the ceiling, and sees the text', () => {
    // The figure above is the shape's and not a walk that cannot see nesting or strings: the old `editTextBlock`
    // blocks, rebuilt with their old bounds, read past the ceiling, and the new worst includes the whole text.
    const index = z.number().int().nonnegative();
    const nested = z
      .object({
        blocks: z
          .array(
            z.object({ lines: z.array(z.array(index).max(512)).max(512), text: z.string().max(4096) }).strict(),
          )
          .max(1024),
      })
      .strict();
    expect(worst(nested)).toBeGreaterThan(ENGINE_ANSWER_FILE_MAX_BYTES);
    expect(worst(editTextBlockSchema)).toBeGreaterThan(MAX_EDIT_TEXT * WORST_BYTES_PER_CHAR);
  });
});

describe('the restyle payload', () => {
  const named = { kind: 'styleAnnotation', page: 0, indices: [1, 2], version: 3 } as const;

  it('takes any ONE of colour, opacity and line width, which is how the Properties tab sends them', () => {
    expect(styleAnnotationSchema.safeParse({ ...named, colour: [0, 0, 1] }).success).toBe(true);
    expect(styleAnnotationSchema.safeParse({ ...named, opacity: 0.4 }).success).toBe(true);
    expect(styleAnnotationSchema.safeParse({ ...named, borderWidth: 3 }).success).toBe(true);
  });

  it('REFUSES one naming none of them, which would be an undo step for no change', () => {
    expect(styleAnnotationSchema.safeParse(named).success).toBe(false);
  });
});

describe('withTargetVersion (ADR-0149)', () => {
  it('re-binds the version a command names, and targetVersionOf reads the new one back', () => {
    const edit = { kind: 'replaceTextObject' as const, page: 0, ...replacementFieldsOf([{ index: 2, text: 'hi' }]), version: asDocVersion(7) };
    const moved = withTargetVersion(edit, asDocVersion(1));
    expect(targetVersionOf(moved)).toBe(asDocVersion(1));
    expect({ ...moved, version: edit.version }).toStrictEqual(edit);
  });

  it('CONTROL: a command that names no version comes back as it was', () => {
    const rotate = { kind: 'rotatePages' as const, pages: [0], quarterTurns: 1 as const };
    expect(withTargetVersion(rotate, asDocVersion(1))).toStrictEqual(rotate);
  });
});
