import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { z } from 'zod';

import { channelIds, channels } from '@monstera/contract';
import { CapabilityRegistry, DocumentService } from '@monstera/kernel';
import { type DocId, asDocVersion } from '@monstera/shared';

import { type AppInfo, createContractHandlers } from './contractHandlers.js';
import type { DocumentCommands } from './documentCommands.js';
import { createRecentFiles } from './recentFiles.js';
import { createEphemeralSettings } from './settingsFile.js';

/**
 * INVARIANT L11, MEASURED: no channel's payload scales with the document.
 *
 * ## Why this is a measurement and not a review
 *
 * The gate's own words are *"no channel's payload scales with document size per
 * operation"*, and every argument for it so far has been made per channel, in
 * prose, by whoever wrote that channel. That is the shape where the next
 * channel is the one nobody argued about — and the failure is invisible, since
 * a payload that scales works perfectly on the documents a developer opens.
 *
 * So this opens the SAME document twice at two very different sizes, calls
 * every channel against both, and compares what came back. A channel whose
 * answer grows with the document fails here whatever its author believed.
 *
 * ## The set is DERIVED from the registry, and that is the right direction
 *
 * Checklist 4c: derive from a set only when the failure you fear makes that set
 * BIGGER. Here it does — the danger is a channel being ADDED without anyone
 * asking this question — so `channelIds` is exactly the anchor that catches it.
 * A hand-kept list would go quiet on the channel nobody thought about, which is
 * the one this exists for.
 *
 * Every id must be either exercised or excluded with a reason. An id that is
 * neither fails, so a new channel arrives owing an answer rather than
 * inheriting silence.
 *
 * ## `document.readRange` is the one sanctioned crossing, and it is asked the
 * SAME question
 *
 * It carries bytes on purpose (ADR-0031), bounded by `MAX_RANGE_BYTES` and by
 * what the caller asked for. So it is measured at a FIXED request size against
 * both documents: what must not scale is the answer to one request, and a
 * transport that returned the whole document for a small range would fail here
 * exactly as any other channel would.
 */

/** How much bigger the large fixture is than the small one, in pages. */
const LARGE_PAGES = 400;

/**
 * How much a payload may grow between the two documents, in bytes.
 *
 * NOT zero, and the reason is not slack for scaling. Two answers about
 * different documents differ in their identifiers — a `DocId` is a minted
 * token, a byte length is a number with more digits — and a few dozen bytes of
 * that is not a payload following the document. The bound is far below any
 * per-page or per-byte term: at 400 pages, a payload carrying one BYTE per page
 * would exceed it, and one carrying a page's worth of anything would exceed it
 * by orders of magnitude.
 */
const ALLOWED_DRIFT = 256;

let workspace: string;
let service: DocumentService;
let capabilities: CapabilityRegistry;
let small: DocId;
let large: DocId;
let smallBytes: number;
let largeBytes: number;

/** A document of `pages` pages, each carrying text so the bytes are real. */
async function documentOf(pages: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let page = 0; page < pages; page += 1) {
    const sheet = document.addPage([612, 792]);
    // Enough text per page that the page's own bytes are not a rounding error —
    // a fixture whose large document is barely larger could not tell a payload
    // that scales from one that does not.
    for (let line = 0; line < 20; line += 1) {
      sheet.drawText(`page ${String(page)} line ${String(line)} the quick brown fox`, {
        x: 40,
        y: 740 - line * 18,
        size: 11,
        font,
      });
    }
  }
  return document.save({ useObjectStreams: false });
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'monstera-payload-'));
  capabilities = new CapabilityRegistry();
  service = new DocumentService(capabilities, { documentBytesCeiling: 512 * 1024 * 1024 });

  const write = async (name: string, pages: number): Promise<{ id: DocId; bytes: number }> => {
    const bytes = await documentOf(pages);
    const path = join(workspace, name);
    writeFileSync(path, bytes);
    const outcome = await service.open(capabilities.mint(path));
    if (outcome.kind !== 'opened') throw new Error(`fixture did not open: ${outcome.kind}`);
    return { id: outcome.docId, bytes: outcome.byteLength };
  };

  const one = await write('small.pdf', 1);
  const many = await write('large.pdf', LARGE_PAGES);
  small = one.id;
  large = many.id;
  smallBytes = one.bytes;
  largeBytes = many.bytes;
}, 120_000);

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/**
 * The handlers, over the real service.
 *
 * `commands` is absent because every channel this file can measure is answered
 * by the service or by a surface — the ones that need an engine session are
 * excluded below with their reason, since no engine host runs in a unit test.
 */
function handlers(): ReturnType<typeof createContractHandlers> {
  const appInfo: AppInfo = { version: '0.0.0', installChannel: 'development' };
  return createContractHandlers({
    appInfo,
    capabilities,
    commands: {} as unknown as DocumentCommands,
    documents: service,
    openedDocument: () => undefined,
    pickDocument: () => Promise.resolve(null),
    recent: createRecentFiles(createEphemeralSettings()),
    settings: createEphemeralSettings(),
    revealLog: () => Promise.resolve(false),
  });
}

/** The serialised size of a payload, counting bytes rather than characters. */
function payloadBytes(value: unknown): number {
  return Buffer.byteLength(
    JSON.stringify(value, (_key, held: unknown) =>
      // A `Uint8Array` serialises to an object of numeric keys, which is a
      // faithful-enough stand-in for the structured clone the real boundary
      // performs: it grows with the array, which is the property under test.
      held instanceof Uint8Array ? Array.from(held) : held,
    ),
    'utf8',
  );
}

/**
 * Channels this file does not exercise, each with the reason.
 *
 * Stated as a map rather than a list, so an exclusion carries an argument and
 * not just an absence — and so the failure below can print it.
 */
const EXCLUDED: Readonly<Record<string, string>> = {
  'app.info': 'answers about the application and never names a document',
  'settings.load': "carries the user's settings, which no document contributes to",
  'settings.save': 'answers a boolean',
  'log.reveal': 'answers a boolean',
  'document.open': 'drives a picker; its answer is measured through the service below',
  'document.openRecent': "same answer as document.open, by a handle rather than a picker",
  'document.recent': 'answers a bounded list of files the user opened, not about a document',
  // A `DocId` in, a boolean out. Nothing in either direction can grow with a
  // document, which is the rare case where L11's question has a one-line
  // answer rather than a bound.
  'document.close': 'takes an id and answers a boolean',
  // These four need an engine session, and no engine host runs in a unit test.
  // Their bounds are asserted where they can be: the search channel by
  // ADR-0035 and `documentCommands.test.ts`, the rest by the caller-stated
  // limits in their own schemas.
  'document.execute': 'needs an engine session',
  'document.undo': 'needs an engine session',
  'document.save': 'needs an engine session',
  // Needs an engine session for the flush, and a DIALOG besides — its whole
  // request is a `DocId` and its whole answer is a byte count and three
  // outcomes, so there is no payload here that could scale with anything.
  'document.saveCopy': 'needs an engine session and a save dialog',
  // `saveCopy`'s answer exactly — a byte count and three outcomes — and a
  // REQUEST that is the one thing here worth a second look: it carries a page
  // list, which is the only channel input that grows with the document. It is
  // bounded by `MAX_EXTRACT_PAGES` and it is an index per page rather than a
  // page per page, so a 4,000-page extract asks in kilobytes and answers with a
  // number. L11 is about payloads that scale with document SIZE, and this one
  // scales with page COUNT — which is the distinction `deletePages` already
  // makes as intent rather than payload.
  'document.extract': 'needs an engine session and a save dialog',
  // The extract's answer with a file count instead of a byte count, and a
  // request bounded on both axes — parts and pages-per-part — so the largest
  // honest ask is still an index per page.
  'document.split': 'needs an engine session and a folder dialog',
  'document.insertImage': 'needs an engine session and an image picker',
  'document.searchPage': 'needs an engine session',
  'document.viewModel': 'needs an engine session',
  'document.pageLinks': 'needs an engine session',
  'document.destinations': 'needs an engine session',
  'document.layers': 'needs an engine session',
  'document.duplicatePages': 'needs an engine session',
};

/**
 * Every array or string in a schema that a caller cannot bound.
 *
 * Read out of zod's own JSON Schema rather than by walking its internals:
 * `toJSONSchema` is the library's answer to *what does this schema permit*, and
 * a second opinion about that is what B3a forbids. It reports `maxItems` for
 * `.max()` on an array and `maxLength` for a string, so an unbounded one shows
 * up as an absence rather than being inferred.
 */
function unboundedMembers(schema: z.ZodType, path: string): readonly string[] {
  const found: string[] = [];
  const walk = (node: unknown, at: string): void => {
    if (typeof node !== 'object' || node === null) return;
    const held = node as Record<string, unknown>;
    // A literal or an enum is bounded by its own members, so a length bound
    // would be a second statement of the same fact — and requiring one would
    // put `.max()` on every `kind` discriminant in the contract.
    const enumerated = held['const'] !== undefined || held['enum'] !== undefined;
    if (held['type'] === 'array' && held['maxItems'] === undefined) found.push(`array  ${at}`);
    if (held['type'] === 'string' && held['maxLength'] === undefined && !enumerated) {
      found.push(`string ${at}`);
    }
    for (const [key, value] of Object.entries(held)) walk(value, `${at}.${key}`);
  };

  walk(
    // A branded string reaches JSON Schema through a transform, which has no
    // representation. `any` keeps the walk going rather than throwing on the
    // first one — and a branded id is bounded by its own minting.
    z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }),
    path,
  );
  return found;
}

/**
 * Channels whose result deliberately carries something unbounded.
 *
 * One entry, and it is the one place this build says a payload's size is not
 * its business: `settings.load` answers what a previous run stored, which the
 * settings registry validates and this boundary deliberately does not (B3a).
 * A bound here would be this build's opinion about last build's data, applied
 * before the component that knows how to read it.
 *
 * Written as a map so an exclusion carries its argument, and checked against
 * `channelIds` below so a reason for a channel that no longer exists cannot
 * sit here making the list look shorter than it is.
 */
const UNBOUNDED_BY_DESIGN: Readonly<Record<string, string>> = {
  'settings.load': 'stored values are the registry’s to validate, not the boundary’s',
};

describe('invariant L11: no channel answers with a payload that scales', () => {
  it('THE FIXTURES DIFFER BY ENOUGH THAT SCALING WOULD SHOW', () => {
    // The measurement's own resolution test (checklist 4a). Two documents of
    // similar size cannot separate a payload that follows the document from one
    // that does not, however carefully the rest is written.
    expect(largeBytes).toBeGreaterThan(smallBytes * 50);
  });

  it('readRange answers the SIZE THAT WAS ASKED FOR, on both documents', async () => {
    // Under the SMALL document's own length, because a range past the end is
    // refused — correctly, and by a rule that has nothing to do with this
    // measurement. What is being compared is one request answered against two
    // documents, so the request has to be one both can serve.
    const ask = 1024;
    const map = handlers();

    const answers = await Promise.all(
      [small, large].map(async (docId) => {
        const record = await map['document.readRange']({
          docId,
          version: asDocVersion(1),
          begin: 0,
          end: ask,
        });
        return record;
      }),
    );

    for (const answer of answers) {
      expect(answer.ok).toBe(true);
      if (!answer.ok || answer.value.kind !== 'bytes') throw new Error('expected bytes');
      // THE REQUEST'S SIZE, not the document's. A transport answering with more
      // than was asked for is the exact shape L11 forbids, and it is the one
      // channel here that carries bytes at all.
      expect(answer.value.bytes.byteLength).toBe(ask);
    }
  });

  it('CONTROL: the measurement SEES a payload that scales', async () => {
    // Without this the case above passes for a measurement that cannot tell the
    // two documents apart — which is what a wrong serialiser, a wrong fixture
    // or an accidentally-shared docId all produce.
    const whole = await Promise.all(
      [small, large].map(async (docId) => {
        const answer = await handlers()['document.readRange']({
          docId,
          version: asDocVersion(1),
          begin: 0,
          // The largest range the boundary permits, which for the small
          // document is more than it holds and for the large one is not.
          end: Math.min(docId === small ? smallBytes : largeBytes, 16 * 1024 * 1024),
        });
        return payloadBytes(answer);
      }),
    );

    const [smallPayload, largePayload] = whole;
    if (smallPayload === undefined || largePayload === undefined) throw new Error('two answers');
    expect(largePayload - smallPayload).toBeGreaterThan(ALLOWED_DRIFT);
  });

  it('EVERY ARRAY AND STRING A CHANNEL ANSWERS WITH CARRIES A BOUND', () => {
    // The half a two-document comparison cannot reach, and the half that found
    // something. Opening two documents exercises the handlers this build has;
    // it says nothing about what the BOUNDARY would accept from a handler that
    // got it wrong, and L11 is a property of what may cross.
    //
    // Read out of zod's own JSON Schema rather than by walking its internals:
    // `toJSONSchema` is the library's answer to *what does this schema permit*,
    // and a second opinion about that is exactly what B3a forbids. It reports
    // `maxItems` for `.max()` on an array and `maxLength` for a string, so an
    // unbounded one is visible as an absence rather than inferred.
    //
    // Found on its first run, 2026-09-03: `document.viewModel`'s `rotations`
    // took any length, and `document.searchPage`'s match `text` was a string
    // whose length the DOCUMENT chooses — up to 512 of them per call. Both are
    // bounded now.
    const unbounded = channelIds
      .filter((id) => UNBOUNDED_BY_DESIGN[id] === undefined)
      .flatMap((id) => unboundedMembers(channels[id].result as unknown as z.ZodType, id));

    expect(
      unbounded,
      `These are payload members a caller cannot bound:\n  ${unbounded.join('\n  ')}\n` +
        'Invariant L11 asks what may cross, not what this build happens to send. Give each one a ' +
        '`.max()`, or add its channel to UNBOUNDED_BY_DESIGN with the sentence that says why.',
    ).toStrictEqual([]);
  });

  it('CONTROL: the sweep REPORTS an unbounded array and an unbounded string', () => {
    // *Nothing unbounded* is what a clean contract answers, what a walk over
    // the wrong property answers, and what a walk that resolved no schema at
    // all answers — three states with one output, and the one everybody hopes
    // for (checklist 4b). So it is pointed at a schema known to hold both.
    const loose = z.object({
      rows: z.array(z.string()),
      bounded: z.array(z.string().max(8)).max(4),
    });

    expect(unboundedMembers(loose, 'fixture')).toStrictEqual([
      'array  fixture.properties.rows',
      'string fixture.properties.rows.items',
    ]);
    // AND IT DOES NOT REPORT THE BOUNDED PAIR, which is what separates *this
    // walk can see* from *this walk reports everything*.
  });

  it('every declared channel is exercised or EXCLUDED WITH A REASON', () => {
    // The anchor. A channel added without a thought about its payload lands
    // here rather than passing silently, which is the whole point of deriving
    // the set from the registry rather than keeping a list.
    const unaccounted = channelIds.filter(
      (id) => EXCLUDED[id] === undefined && id !== 'document.readRange',
    );

    expect(
      unaccounted,
      `These channels are neither measured here nor excluded with a reason:\n  ${unaccounted.join(
        '\n  ',
      )}\nInvariant L11 asks whether each one's payload scales with the document. Answer it — ` +
        'measure it here, or add it to EXCLUDED with the sentence that makes the answer obvious.',
    ).toStrictEqual([]);
    // AND THE EXCLUSIONS ARE REAL CHANNELS. A reason written for an id that no
    // longer exists is a paragraph nobody will delete, and it makes the list
    // above look shorter than the work it represents.
    expect(Object.keys(EXCLUDED).filter((id) => !channelIds.includes(id as never))).toStrictEqual(
      [],
    );
  });
});
