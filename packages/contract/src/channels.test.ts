import { asDocId, asDocVersion, asFileHandle, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { createClient, wrapHandlers } from './boundary.js';
import {
  MAX_LAYERS,
  MAX_RANGE_BYTES,
  channelIds,
  channels,
  type ContractHandlers,
} from './channels.js';
import type { Incident } from './incident.js';

/** Discards a diagnostic. The sink is required rather than defaulted. */
function ignore(_incident: Incident): void {
  // See incident.ts: forgetting a destination is a compile error, so "not
  // interested" has to be written down rather than left out.
}

/**
 * The **real** channel map, implemented once — the only place in the repository
 * that implements it.
 *
 * Everything else builds a *fixture* registry: `boundary.test.ts` has its own
 * two-channel map, and `scripts/proofs/contract.proof.mjs` compiles handler maps
 * from source held in strings. So nothing had ever asked whether the shipping
 * map can be satisfied at all, and a channel declared here with no handler was a
 * renderer call that hangs, caught only by a 51-second compile-fail proof.
 *
 * **What this does not fix, stated because the neighbouring finding is about
 * exactly that** (W-2): the compile-fail proof holds a second copy of
 * handler-map source *as strings*, and `typecheck` cannot see inside a string —
 * that is what a compile-fail proof is for, and it is also its cost. When
 * `Handlers` changed shape, this file's kind of fixture moved with it and that
 * one did not, leaving `proof:contract` red on `main` for three commits while
 * `typecheck` and `test` were green and right to be.
 */
const handlers: ContractHandlers = {
  'app.info': () => Promise.resolve(ok({ version: '0.0.0', installChannel: 'development' })),
  'document.open': () => Promise.resolve(ok({ kind: 'cancelled' as const })),
  // ONE ENTRY AND A DIRTY MARKER, for the layers fixture's reason: an empty
  // list and `lastExitClean: true` are what a boundary that dropped both fields
  // produces, and they are also the ordinary state — so the fixture that
  // separates them is the unusual one.
  'document.recent': () =>
    Promise.resolve(
      ok({
        entries: [{ handle: asFileHandle('handle-1'), name: 'annual.pdf' }],
        lastExitClean: false,
        // TWO ENTRIES, and neither is the newest recent one. That is the whole
        // point of recording a session rather than inferring it: a fixture
        // where the session is the head of the recent list cannot tell a
        // boundary that carries this field from one that rebuilt it.
        lastSession: [
          { handle: asFileHandle('handle-7'), name: 'draft.pdf' },
          { handle: asFileHandle('handle-8'), name: 'notes.pdf' },
        ],
      }),
    ),
  'document.openRecent': () => Promise.resolve(ok({ kind: 'absent' as const })),
  'document.undo': () => Promise.resolve(ok({ kind: 'nothing-to-undo' as const })),
  'document.execute': () =>
    Promise.resolve(ok({ version: asDocVersion(1), byteLength: 4096, historyDropped: 0 })),
  'document.save': () => Promise.resolve(ok({ kind: 'saved' as const, version: asDocVersion(1) })),
  // CANCELLED rather than copied, for the recent-files fixture's reason one
  // entry up: a byte count is the interesting answer, and a fixture that always
  // returns one cannot show that the dismissal path exists at all.
  'document.extract': () => Promise.resolve(ok({ kind: 'cancelled' as const })),
  'document.snapshotRegion': () => Promise.resolve(ok({ kind: 'cancelled' as const })),
  'document.exportFormData': () => Promise.resolve(ok({ kind: 'cancelled' as const })),
  'document.importFormData': () => Promise.resolve(ok({ kind: 'cancelled' as const })),
  'document.flatFieldCandidates': () =>
    Promise.resolve(ok({ version: asDocVersion(1), candidates: [], truncated: false })),
  'document.textLines': () =>
    Promise.resolve(ok({ version: asDocVersion(1), lines: [], truncated: false })),
  'document.split': () => Promise.resolve(ok({ kind: 'cancelled' as const })),
  'document.saveCopy': () => Promise.resolve(ok({ kind: 'cancelled' as const })),
  'document.insertImage': () => Promise.resolve(ok({ kind: 'cancelled' as const })),
  'document.placeImage': () => Promise.resolve(ok({ kind: 'cancelled' as const })),
  'document.readRange': ({ begin, end }) =>
    // Echoes the SIZE it was asked for, so the L11 cases below can assert what
    // crossed rather than that something did.
    Promise.resolve(ok({ kind: 'bytes' as const, bytes: new Uint8Array(end - begin) })),
  // Two pages and one of them turned, so a case can assert what crossed rather
  // than that something did. An all-zero model is the shape a dropped array and
  // a flat document produce alike.
  'document.viewModel': () =>
    Promise.resolve(ok({ version: asDocVersion(1), pageCount: 2, rotations: [0, 90] })),
  // ONE MATCH AND `truncated: false`, so a case can assert what crossed rather
  // than that something did. An empty list is the shape a dropped array and a
  // page with no hits produce alike — and it is search's reassuring answer.
  'document.searchPage': () =>
    Promise.resolve(
      ok({
        version: asDocVersion(1),
        // ENDING ON A DIFFERENT LINE, because the pair that separates a
        // spanning match from an ordinary one is `endLine !== line`, and a stub
        // where the two agree is satisfied by a surface that drops `endLine`
        // and echoes `line` back.
        matches: [
          { line: 2, offset: 7, endLine: 3, endOffset: 4, text: 'a line holding the query' },
        ],
        truncated: false,
      }),
    ),
  // ONE LINE WITH A BOX, for the search fixture's reason: an empty list is what
  // a dropped array and a blank page produce alike, and blank is the reassuring
  // answer for a layer nobody can select.
  'document.pageTextLayer': () =>
    Promise.resolve(
      ok({
        version: asDocVersion(1),
        lines: [{ text: 'a line of the page', box: { x0: 10, y0: 20, x1: 110, y1: 32 } }],
        truncated: false,
      }),
    ),
  // NON-ZERO AND ALL THREE DIFFERENT, so a case can assert which figure crossed.
  // A fixture of zeros is what a dropped field and an empty page produce alike.
  'document.pageWordCount': () =>
    Promise.resolve(
      ok({ version: asDocVersion(1), words: 5, characters: 27, charactersNoSpaces: 23 }),
    ),
  // ONE OF EACH KIND, for the search fixture's reason: a list holding only
  // internal links would let a boundary that dropped the external branch pass,
  // and the external branch is the one invariant 24 rests on.
  'document.pageLinks': () =>
    Promise.resolve(
      ok({
        version: asDocVersion(1),
        links: [
          { kind: 'internal' as const, page: 4, bounds: { x0: 1, y0: 2, x1: 3, y1: 4 } },
          {
            kind: 'external' as const,
            uri: 'https://example.org/',
            bounds: { x0: 5, y0: 6, x1: 7, y1: 8 },
          },
        ],
      }),
    ),
  // A NESTED ENTRY AND A PAGELESS ONE, for the links fixture's reason: a flat
  // list of resolvable entries would let a boundary that dropped the depth or
  // collapsed `null` pass, and both are states a panel has to render.
  'document.destinations': () =>
    Promise.resolve(
      ok({
        version: asDocVersion(1),
        destinations: [
          { title: 'Chapter one', page: 0, depth: 0 },
          { title: 'A section', page: 3, depth: 1 },
          { title: 'Somewhere unresolvable', page: null, depth: 1 },
        ],
      }),
    ),
  // ONE VISIBLE AND ONE HIDDEN, because a fixture where everything is visible
  // cannot tell a boundary that carried the flag from one that dropped it.
  'document.layers': () =>
    Promise.resolve(
      ok({
        version: asDocVersion(1),
        layers: [
          { index: 0, name: 'Shown', visible: true },
          { index: 1, name: 'Hidden', visible: false },
        ],
      }),
    ),
  // TWO GROUPS AND `truncated: false`, for the layers fixture's reason: one
  // group would let a boundary that dropped everything after the first answer
  // correctly, and `truncated: true` is the state a boundary defaulting the
  // flag cannot produce — so the fixture uses the value a default would give
  // and the case below is what separates them.
  'document.annotations': () =>
    Promise.resolve(
      ok({ version: asDocVersion(1), annotations: [], truncated: false }),
    ),
  // TWO FIELDS OF DIFFERENT KINDS, for the duplicate fixture's reason and one
  // more of its own: a boundary that dropped everything after the first would
  // answer correctly from a one-field fixture, and the two carry the values a
  // transposition would swap — `on` is null on the text field and false on the
  // checkbox, so a boundary that defaulted either would be visible.
  'document.formFields': () =>
    Promise.resolve(
      ok({
        version: asDocVersion(1),
        fields: [
          {
            page: 0,
            index: 0,
            kind: 'text' as const,
            name: 'applicant.name',
            values: ['Ada'],
            on: null,
            options: [],
            readOnly: false,
            rect: { x0: 10, y0: 20, x1: 110, y1: 40 },
          },
          {
            page: 1,
            index: 0,
            kind: 'checkbox' as const,
            name: 'applicant.agrees',
            values: [],
            on: false,
            options: [],
            readOnly: true,
            rect: null,
          },
        ],
        truncated: false,
      }),
    ),
  'document.duplicatePages': () =>
    Promise.resolve(
      ok({
        version: asDocVersion(1),
        groups: [{ pages: [0, 3] }, { pages: [1, 2, 4] }],
        truncated: false,
      }),
    ),
  // `true`, because the interesting fixture is a document that WAS there: a
  // handler answering `false` unconditionally satisfies the schema and tells
  // every caller their close did nothing.
  'document.close': () => Promise.resolve(ok({ closed: true })),
  'settings.load': () => Promise.resolve(ok({ stored: {} })),
  // Echoes what it was handed, so a case can assert the values SURVIVED the
  // boundary rather than that the call was accepted. A settings payload is the
  // one place here whose values are deliberately unvalidated, which makes "did
  // the schema quietly rewrite this" a real question rather than a rhetorical
  // one.
  'settings.save': () => Promise.resolve(ok({ stored: true as const })),
  'log.reveal': () => Promise.resolve(ok({ revealed: true })),
  'spelling.dictionary': () =>
    Promise.resolve(
      ok({
        kind: 'dictionary' as const,
        language: 'en' as const,
        affix: new Uint8Array(),
        words: new Uint8Array(),
      }),
    ),
};

describe('the shipping contract, exercised through its own map', () => {
  it('every declared channel has a handler, and the map has no others', () => {
    // The mapped type already makes both a compile error. This asserts the
    // runtime consequence the type cannot: that the id list the registration
    // loop iterates and the map it indexes are the same set. A channel declared
    // and unhandled is a renderer call that hangs.
    expect(Object.keys(handlers).sort()).toStrictEqual([...channelIds].sort());
  });

  it('a real channel round-trips from client to handler and back', async () => {
    const client = createClient(channels, (id, params) =>
      wrapHandlers(channels, handlers, ignore)[id](params),
    );

    await expect(
      client['document.execute']({
        docId: asDocId('doc-1'),
        command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
      }),
    ).resolves.toStrictEqual(ok({ version: 1, byteLength: 4096, historyDropped: 0 }));
  });

  it('the params schema REFUSES a command the union does not declare', async () => {
    // The boundary validates inbound params in one place, and this is the
    // channel where that matters most: a command is the renderer asking for a
    // mutation, and an unrecognised one must not reach the routing table.
    const client = createClient(channels, (id, params) =>
      wrapHandlers(channels, handlers, ignore)[id](params),
    );

    const result = await client['document.execute']({
      docId: asDocId('doc-1'),
      // Deliberately not a declared kind. Cast because the point is the runtime
      // check for what the type cannot see — a renderer on a drifted build.
      command: { kind: 'formatHardDrive' } as unknown as never,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal');
  });

  // ---------------------------------------------------------------------------
  // Invariant L11, which this file's own header says is owed by the first
  // document-carrying channel. The mechanism is MAX_RANGE_BYTES in the params
  // schema, so these cases are about the BOUNDARY refusing rather than about a
  // handler declining — a handler-side check would be a rule the next channel's
  // author has to remember.
  // ---------------------------------------------------------------------------

  it('L11: a range larger than the bound is REFUSED at the boundary', async () => {
    const client = createClient(channels, (id, params) =>
      wrapHandlers(channels, handlers, ignore)[id](params),
    );

    const result = await client['document.readRange']({
      docId: asDocId('doc-1'),
      version: asDocVersion(1),
      begin: 0,
      end: MAX_RANGE_BYTES + 1,
    });

    expect(result.ok).toBe(false);
  });

  it('CONTROL: a range AT the bound is served, so the refusal is not "everything"', async () => {
    // The case above passes for a schema that refuses every range — which is
    // also what a typo in the refinement produces, and which would take the
    // renderer's whole read path with it. The bound must be the largest
    // permitted value, not merely some value that is refused.
    const client = createClient(channels, (id, params) =>
      wrapHandlers(channels, handlers, ignore)[id](params),
    );

    const result = await client['document.readRange']({
      docId: asDocId('doc-1'),
      version: asDocVersion(1),
      begin: 0,
      end: MAX_RANGE_BYTES,
    });

    expect(result.ok).toBe(true);
    // The handler echoes the size it was asked for, so this asserts what
    // crossed rather than that something did.
    if (result.ok && result.value.kind === 'bytes') {
      expect(result.value.bytes.byteLength).toBe(MAX_RANGE_BYTES);
    }
  });

  it('a layer list past the bound is REFUSED, so the bound is reachable', async () => {
    // FOUND BY THE STAGE AUDIT of `87540a5..HEAD`. `readLayers` clamped its
    // own count with `Math.min(groups.length, MAX_LAYERS)`, so the array
    // reaching this schema had already been cut to fit and `.max(MAX_LAYERS)`
    // was a check that could not fail — while the reader was shown a subset of
    // their document's layers with nothing saying so.
    //
    // The kernel no longer clamps, and this is what makes that bound live.
    const many = Array.from({ length: MAX_LAYERS + 1 }, (_unused, index) => ({
      index,
      name: 'Layer',
      visible: true,
    }));
    const client = createClient(channels, (id, params) =>
      wrapHandlers(channels, { ...handlers, 'document.layers': () =>
        Promise.resolve(ok({ version: asDocVersion(1), layers: many })),
      }, ignore)[id](params),
    );

    const result = await client['document.layers']({ docId: asDocId('doc-1') });

    expect(result.ok).toBe(false);
  });

  it('CONTROL: a layer list AT the bound is served, so the refusal is not "everything"', async () => {
    // `readRange`'s control, for `readRange`'s reason: the case above passes
    // for a schema that refuses every layer list, which is also what a typo in
    // the bound produces and which would take the whole panel with it.
    const exactly = Array.from({ length: MAX_LAYERS }, (_unused, index) => ({
      index,
      name: 'Layer',
      visible: true,
    }));
    const client = createClient(channels, (id, params) =>
      wrapHandlers(channels, { ...handlers, 'document.layers': () =>
        Promise.resolve(ok({ version: asDocVersion(1), layers: exactly })),
      }, ignore)[id](params),
    );

    const result = await client['document.layers']({ docId: asDocId('doc-1') });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.layers).toHaveLength(MAX_LAYERS);
  });

  it('L11: the bound is on the SIZE, not on the offset, so a late range is served', async () => {
    // A bound written as `end <= MAX_RANGE_BYTES` reads almost identically and
    // is a different rule: it would refuse every read past 16 MiB into a
    // document, which is most of a large one. The two agree for every range
    // starting at zero — which is what the two cases above use — so this is the
    // fixture that separates them.
    const client = createClient(channels, (id, params) =>
      wrapHandlers(channels, handlers, ignore)[id](params),
    );

    const result = await client['document.readRange']({
      docId: asDocId('doc-1'),
      version: asDocVersion(1),
      begin: 100_000_000,
      end: 100_065_536,
    });

    expect(result.ok).toBe(true);
  });

  it('a range whose end precedes its begin is refused', async () => {
    const client = createClient(channels, (id, params) =>
      wrapHandlers(channels, handlers, ignore)[id](params),
    );

    const result = await client['document.readRange']({
      docId: asDocId('doc-1'),
      version: asDocVersion(1),
      begin: 500,
      end: 100,
    });

    expect(result.ok).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // A measurement's scale, which is the one number in a command that a person
  // types rather than a gesture producing. `measureScaleSchema` used to spell
  // `.finite()` and zod 4 deprecates it as a no-op — so these two cases exist to
  // say the property survived the call being deleted rather than the deprecation
  // being obeyed. A no-op is a claim about the library's current default, and a
  // default is exactly the thing that moves.
  // ---------------------------------------------------------------------------

  /** Sends a measurement whose scale is `perPoint`, and answers whether it was served. */
  async function scaled(perPoint: number): Promise<boolean> {
    const client = createClient(channels, (id, params) =>
      wrapHandlers(channels, handlers, ignore)[id](params),
    );
    const result = await client['document.execute']({
      docId: asDocId('doc-1'),
      command: {
        kind: 'addAnnotation',
        page: 0,
        annotation: {
          type: 'measure-distance',
          points: [
            { x: 10, y: 10 },
            { x: 110, y: 10 },
          ],
          scale: { perPoint, unit: 'mm' },
          colour: [0.1, 0.45, 0.9],
          opacity: 1,
          borderWidth: 2,
        },
      },
    });
    return result.ok;
  }

  it('an INFINITE scale is refused, though nothing spells finite any more', async () => {
    // An infinite ratio produces `Infinity mm` as a label and an `/X` array a
    // reader cannot use — and it arrives from a settings field, which is a
    // person typing rather than a gesture. `1e400` is the literal that IS
    // `Infinity`; a large finite number is a different case and is legal.
    expect(await scaled(Number.POSITIVE_INFINITY)).toBe(false);
    expect(await scaled(Number.NaN)).toBe(false);
    expect(await scaled(0)).toBe(false);
  });

  it('CONTROL: an ordinary scale is served, so the refusal is not "everything"', async () => {
    // Without this the case above passes for a schema that refuses every
    // measurement — which is also what a mistyped field name produces, and
    // which would take the whole feature out at the boundary with three green
    // refusals reading as rigour.
    expect(await scaled(0.5)).toBe(true);
  });
});
