import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { coreEngineChannels, engineChannels } from './engineChannels.js';

/**
 * The split [ADR-0048](../../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md)
 * Decision 1 makes, asserted as a property of the two sets rather than restated
 * entry by entry.
 *
 * ## Why this is a case and not a comment
 *
 * The decision is *a second engine owes the seven engine-agnostic channels and
 * its own reads, and none of the twelve MuPDF document-model ones*. Nothing in
 * the type system says which side a channel belongs on: a reader added to the
 * factory compiles, and so does a core channel moved into MuPDF's literal. The
 * cost of either is not a build failure — it is a second host inheriting a
 * question about MuPDF's document model, or failing to inherit a channel it
 * cannot serve without.
 *
 * ## The lists are LITERAL, and 4c is what decides that
 *
 * The failure feared runs both ways here, and only one of them makes a set
 * bigger. A channel **arriving** in the factory is caught by a derived count as
 * well as by a list. A channel **moving** from the reader side to the core side
 * leaves both totals unchanged, and a count derived from either object agrees
 * with it — so the names have to be written down. They are the independent
 * claim, and the diff that edits one of them is where the decision gets
 * re-taken deliberately rather than by accident.
 */
const CORE = [
  'engine/probe-containment',
  'engine/open',
  'engine/serialise',
  'engine/close',
  'engine/apply',
  'engine/capture',
  'engine/invert',
] as const;

/** MuPDF's document model, which is the half a second engine owes none of. */
const MUPDF_READS = [
  'engine/extract',
  'engine/snapshotRegion',
  'engine/page-geometry',
  'engine/page-text',
  'engine/page-links',
  'engine/destinations',
  'engine/layers',
  'engine/annotations',
  'engine/form-fields',
  'engine/exportFormData',
  'engine/flat-fields',
  'engine/duplicate-pages',
] as const;

/**
 * Three schemas that are not MuPDF's, so the factory is exercised as a factory.
 *
 * Passing `mupdfCommandSchema` here would make every case below pass against a
 * `coreEngineChannels` that ignored its argument and closed over MuPDF's — the
 * fixture would contain none of the thing the defect keys on.
 */
const OTHER = {
  command: z.object({ kind: z.literal('replaceTextObject') }).strict(),
  capture: z.object({ captured: z.literal(false) }).strict(),
  inverse: z.object({ kind: z.literal('replaceTextObject') }).strict(),
};

describe('the core channel set', () => {
  it('is EXACTLY the seven a host owes whatever engine it holds', () => {
    expect(Object.keys(coreEngineChannels(OTHER)).sort()).toStrictEqual([...CORE].sort());
  });

  it('takes the engine’s command union rather than closing over MuPDF’s', () => {
    // THE PARAMETER REACHES THE CHANNEL, asserted by feeding the params schema
    // a command only the fixture's union accepts. A factory that ignored its
    // argument would refuse this and pass every name-shaped case above.
    const apply = coreEngineChannels(OTHER)['engine/apply'].params;
    const accepted = apply.safeParse({
      session: 'a'.repeat(43),
      command: { kind: 'replaceTextObject' },
    });
    expect(accepted.success, JSON.stringify(accepted.error?.issues ?? [])).toBe(true);

    // AND THE CONTROL, which is the half that separates *the schema was used*
    // from *the schema accepts anything*: a MuPDF command must be refused by a
    // core set built for a different engine.
    expect(
      apply.safeParse({ session: 'a'.repeat(43), command: { kind: 'rotatePages' } }).success,
    ).toBe(false);
  });
});

describe('MuPDF’s channel map', () => {
  it('is the core seven plus its own twelve reads, and nothing else', () => {
    expect(Object.keys(engineChannels).sort()).toStrictEqual(
      [...CORE, ...MUPDF_READS].sort(),
    );
  });

  it('shares no member between the two halves', () => {
    // The property the two lists above cannot state on their own: a name in
    // both would satisfy each of them separately and make the union's length
    // disagree with the sum, which nothing here reads.
    const overlap = MUPDF_READS.filter((id) => (CORE as readonly string[]).includes(id));
    expect(overlap).toStrictEqual([]);
    expect(CORE.length + MUPDF_READS.length).toBe(Object.keys(engineChannels).length);
  });
});
