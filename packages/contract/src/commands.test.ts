import { describe, expect, it } from 'vitest';

import { MAX_TEXT_REPLACEMENTS, replaceTextObjectSchema } from './commands.js';

/**
 * What `replaceTextObject`'s payload REFUSES, which is the half a shape test
 * cannot see.
 *
 * ## Why this file exists at all
 *
 * The command carries a list so that a visual line — several text objects,
 * because PDFium answers one rect per run — is one command, one content
 * regeneration and one undo step. A list brings two rules a single field did
 * not have, and both are refusals: **at least one entry**, and **no index
 * twice**. Neither is visible in a case that parses a well-formed payload, and
 * an accept-only file would pass identically against a schema that accepted
 * anything.
 *
 * So every case below that matters asserts a REJECTION, and each is paired with
 * the nearest accepted payload — otherwise a schema that refused everything
 * would satisfy the refusals and nothing would say so.
 */
const version = 3 as never;

/** A payload that parses, which every case here varies one field of. */
const good = {
  kind: 'replaceTextObject' as const,
  page: 0,
  replacements: [{ index: 4, text: 'HELLO' }],
  version,
};

describe('the in-place text edit payload', () => {
  it('accepts a single replacement, which is what region replacement sends', () => {
    // THE POSITIVE CONTROL for every refusal below. Without it, a schema that
    // rejected all input would pass this whole file.
    expect(replaceTextObjectSchema.safeParse(good).success).toBe(true);
  });

  it('accepts several replacements on ONE page, which is what a line edit sends', () => {
    expect(
      replaceTextObjectSchema.safeParse({
        ...good,
        replacements: [
          { index: 4, text: 'LEFT HALF ' },
          { index: 9, text: 'RIGHT HALF' },
        ],
      }).success,
    ).toBe(true);
  });

  it('REFUSES a list naming one object twice', () => {
    // TWO OPINIONS ABOUT ONE OBJECT, and every rule for choosing between them
    // — last wins, first wins, concatenate — is a rule a reader has to look up.
    // The boundary refuses it so that no layer below needs one; in particular
    // the capture, which records one prior per index, cannot be handed a list
    // whose priors would collide and leave an inverse that restores a string
    // the object never held.
    //
    // The two entries carry DIFFERENT text, which is the shape that actually
    // conflicts: a duplicate with identical text would be refused by any
    // de-duplicating implementation too, and would separate nothing.
    const parsed = replaceTextObjectSchema.safeParse({
      ...good,
      replacements: [
        { index: 4, text: 'ONE' },
        { index: 4, text: 'ANOTHER' },
      ],
    });

    expect(parsed.success).toBe(false);
    // THE MESSAGE, not merely the refusal. A payload can fail for a dozen
    // reasons and `success: false` cannot tell which — the seven-character
    // `--sha` case is this project's record of a refusal that fell through to a
    // different rule whose message read the same.
    expect(parsed.error?.issues[0]?.message).toContain('more than once');
  });

  it('REFUSES an empty list', () => {
    // A command naming nothing would regenerate a page's content stream for no
    // change, which is the whole cost of an edit paid for nothing. The adapter
    // throws on it as well; refusing here means the throw is unreachable from a
    // renderer rather than a caught exception at the boundary.
    expect(replaceTextObjectSchema.safeParse({ ...good, replacements: [] }).success).toBe(false);
  });

  it('REFUSES a list longer than a page’s worth, and accepts one exactly that long', () => {
    // BOTH SIDES OF THE BOUND, because a schema with no `.max` passes the
    // accept case and a schema bounded at anything smaller fails it. The
    // fixture is built FROM the constant, which is the direction that cannot go
    // stale: a raised bound moves both cases together.
    const entry = (index: number) => ({ index, text: 'x' });
    const exactly = Array.from({ length: MAX_TEXT_REPLACEMENTS }, (_, at) => entry(at));

    expect(replaceTextObjectSchema.safeParse({ ...good, replacements: exactly }).success).toBe(
      true,
    );
    expect(
      replaceTextObjectSchema.safeParse({
        ...good,
        replacements: [...exactly, entry(MAX_TEXT_REPLACEMENTS)],
      }).success,
    ).toBe(false);
  });

  it('REFUSES a per-entry page, so one command cannot span two pages', () => {
    // The page is shared, and the reason is the cost model rather than tidiness:
    // `FPDFPage_GenerateContent` is paid per page, so a payload that could name
    // two would be a command whose cost is not the one the shape promises. A
    // schema that merely ignored the extra key would leave a caller believing
    // it had been honoured.
    expect(
      replaceTextObjectSchema.safeParse({
        ...good,
        replacements: [{ index: 4, text: 'HELLO', page: 1 }],
      }).success,
    ).toBe(false);
  });
});
