import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { byteImageWire, coreEngineChannels, engineChannels } from './engineChannels.js';

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
  'engine/close',
  'engine/apply',
  'engine/capture',
  'engine/invert',
] as const;

/**
 * The channel a **live-session** engine owes on top of the six.
 *
 * `engine/serialise` was in {@link CORE} until 2026-09-09, and its leaving is
 * ADR-0048's correction rather than a tidy-up: a byte-image host's session has
 * no current bytes to write, so the channel has nothing behind it there. This
 * list is one name long and is a list anyway, because the question it answers —
 * *which channels belong to a writer SHAPE rather than to an engine* — is the
 * one the seven-way split got wrong, and a bare constant would not be a place
 * for a second such channel to arrive.
 */
const LIVE_SESSION = ['engine/serialise'] as const;

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
  // THE REAL BYTE-IMAGE WIRE, so the fixture exercises the half of the factory
  // MuPDF's own call leaves empty — with the live-session wire here the spreads
  // would contribute nothing and a factory that dropped them would pass.
  //
  // The constant rather than a hand-built shape, because the pair IS the
  // subject: ADR-0048's correction says the wire belongs to `writerShapes` and
  // not to an engine, and a fixture inventing a third arrangement would be
  // testing something the design says cannot exist.
  wire: byteImageWire,
} as const;

describe('the core channel set', () => {
  it('is EXACTLY the six a host owes whatever engine it holds', () => {
    expect(Object.keys(coreEngineChannels(OTHER)).sort()).toStrictEqual([...CORE].sort());
  });

  it('does NOT include engine/serialise, which belongs to the live-session shape', () => {
    // The half the case above cannot state on its own: a set of six that
    // happened to contain `engine/serialise` and to be missing something else
    // would fail that case with a confusing diff, and a reader would fix the
    // list rather than the factory. This names the channel and the reason.
    expect(Object.keys(coreEngineChannels(OTHER))).not.toContain('engine/serialise');
  });

  it('carries the engine’s READ and WRITE fields on apply, and only the read on capture', () => {
    // ADR-0048's correction in the wire shape: a byte-image engine names where
    // its image is and where the result goes, and a capture produces no bytes
    // so it names only the first. Asserted by REFUSAL as well as acceptance —
    // `.strict()` means a field the schema does not carry is rejected, so the
    // second half is what separates *the spread reached this channel* from
    // *the schema accepts anything*.
    const channels = coreEngineChannels(OTHER);
    const session = 'a'.repeat(43);
    const command = { kind: 'replaceTextObject' };

    expect(
      channels['engine/apply'].params.safeParse({ session, command, from: 'ab', into: 'cd' })
        .success,
    ).toBe(true);
    expect(
      channels['engine/apply'].params.safeParse({ session, command, from: 'ab' }).success,
      'an apply without `into` must be refused: a byte-image write with nowhere to land',
    ).toBe(false);

    expect(channels['engine/capture'].params.safeParse({ session, command, from: 'ab' }).success)
      .toBe(true);
    expect(
      channels['engine/capture'].params.safeParse({ session, command, from: 'ab', into: 'cd' })
        .success,
      'a capture must not carry `into`: it reads prior state and produces no bytes',
    ).toBe(false);
  });

  it('declares the engine’s own transfer failure on invert, and MuPDF’s does not', () => {
    // A byte-image invert reads an input image and can find it gone; a
    // live-session one cannot, because there is no file for it to look for.
    // Both halves, because a list that always carried `asset-missing` would
    // satisfy the first and put a failure with nothing behind it on MuPDF's
    // wire — which is what ADR-0048 refuses one channel up.
    expect(coreEngineChannels(OTHER)['engine/invert'].failures).toStrictEqual([
      'no-such-session',
      'asset-missing',
      'engine-refused',
    ]);
    expect(engineChannels['engine/invert'].failures).toStrictEqual(['no-such-session']);
  });

  it('a byte-image OPEN registers an area: no snapshotName, and no declared failure', () => {
    // ADR-0048's withdrawn Decision 3, asserted as a property of the wire.
    // Both halves, because either alone is satisfied by the wrong thing: a
    // schema that merely ACCEPTED a message without `snapshotName` would pass
    // the first if it were not `.strict()`, and an empty failure list means
    // nothing unless the live-session side is checked to be non-empty.
    const open = coreEngineChannels(OTHER)['engine/open'];
    expect(
      open.params.safeParse({ snapshotDirectory: 'C:\\a', outputDirectory: 'C:\\b' }).success,
    ).toBe(true);
    expect(
      open.params.safeParse({
        snapshotDirectory: 'C:\\a',
        outputDirectory: 'C:\\b',
        snapshotName: 'abc',
      }).success,
      'a byte-image open must not accept a document name: at that moment there is no document',
    ).toBe(false);
    expect(open.failures).toStrictEqual([]);

    // AND THE LIVE-SESSION SIDE, which is what makes the pair a property rather
    // than a description of one object.
    expect(engineChannels['engine/open'].failures).toStrictEqual(['open-failed']);
    expect(
      engineChannels['engine/open'].params.safeParse({
        snapshotDirectory: 'C:\\a',
        outputDirectory: 'C:\\b',
      }).success,
      'a live-session open must REQUIRE the document it is going to parse',
    ).toBe(false);
  });

  it('answers a write with the engine’s own result shape', () => {
    // `CommandExecution<W>.apply` returns a `ByteImage` for a byte-image writer
    // and nothing for a live-session one. This is that on the wire, and the
    // refusal is what says the parameter was used rather than defaulted to
    // `z.object({})`, which accepts an empty object and would pass on both.
    const applied = coreEngineChannels(OTHER)['engine/apply'].result;
    expect(applied.safeParse({ bytes: 12 }).success).toBe(true);
    expect(applied.safeParse({}).success).toBe(false);
  });

  it('takes the engine’s command union rather than closing over MuPDF’s', () => {
    // THE PARAMETER REACHES THE CHANNEL, asserted by feeding the params schema
    // a command only the fixture's union accepts. A factory that ignored its
    // argument would refuse this and pass every name-shaped case above.
    const apply = coreEngineChannels(OTHER)['engine/apply'].params;
    const accepted = apply.safeParse({
      session: 'a'.repeat(43),
      command: { kind: 'replaceTextObject' },
      from: 'ab',
      into: 'cd',
    });
    expect(accepted.success, JSON.stringify(accepted.error?.issues ?? [])).toBe(true);

    // AND THE CONTROL, which is the half that separates *the schema was used*
    // from *the schema accepts anything*: a MuPDF command must be refused by a
    // core set built for a different engine.
    expect(
      apply.safeParse({
        session: 'a'.repeat(43),
        command: { kind: 'rotatePages' },
        from: 'ab',
        into: 'cd',
      }).success,
    ).toBe(false);
  });
});

describe('MuPDF’s channel map', () => {
  it('is the core six, the live-session one, and its own twelve reads', () => {
    expect(Object.keys(engineChannels).sort()).toStrictEqual(
      [...CORE, ...LIVE_SESSION, ...MUPDF_READS].sort(),
    );
  });

  it('shares no member between the three groups', () => {
    // The property the lists above cannot state on their own: a name in two of
    // them would satisfy each separately and make the union's length disagree
    // with the sum, which nothing here reads.
    const all = [...CORE, ...LIVE_SESSION, ...MUPDF_READS];
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(Object.keys(engineChannels).length);
  });

  it('answers an apply with NOTHING, which is the live-session shape on the wire', () => {
    // The other side of the byte-image case above, and the pair is what makes
    // either mean anything: `CommandExecution<'mupdf'>.apply` returns
    // `Promise<void>`, so this result must accept an empty object and refuse a
    // byte count. Without the refusal a schema of `z.object({})` non-strict
    // would satisfy both engines and the parameter would be doing nothing.
    const applied = engineChannels['engine/apply'].result;
    expect(applied.safeParse({}).success).toBe(true);
    expect(applied.safeParse({ bytes: 12 }).success).toBe(false);
  });
});
