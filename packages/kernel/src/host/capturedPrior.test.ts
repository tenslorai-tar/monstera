import { PDFArray, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import type { CommandKind, CommandOfKind } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';

import { type DeclaredCommands, declaredCommands } from '../commandDeclarations.js';
import { localMupdfExecution } from '../commandSpecs.js';
import type { ByteImage, MupdfSession } from '../engineSeam.js';
import { mupdfWriter } from '../mupdfWriter.js';
import { engineChannels, taggedPrior } from './engineChannels.js';

/**
 * Every invertible MuPDF command's prior, over the capture channel's own schema.
 *
 * ## The defect this exists for, measured 2026-09-07
 *
 * `engine/capture`'s declared result carried members for **two** of the nine
 * invertible MuPDF commands. `safeParse` accepted a `rotatePages` prior and
 * refused `swapPages` and `movePage` — so on a real engine host those commands
 * answered a value the outbound validation rejected, which `wrapHandler` turns
 * into `internal` plus an incident. The command did not run at all.
 *
 * ## Why nothing saw it, and what that says about this file's shape
 *
 * Every existing case that drives this channel uses `rotatePages`. A set that
 * holds one argument constant is one-sided in a way no individual case looks
 * wrong for (NNN-1), and a member being **absent** produces the same green as a
 * member being **unexercised**.
 *
 * So the list here is derived from the declaration table rather than written
 * out, and the derivation is in 4c's safe direction: the failure feared makes
 * the set bigger — a tenth invertible command arriving with no member — and a
 * derived list gains a case by existing. The **shrink** direction is covered by
 * the anchor at the bottom, which names three kinds this table is known to hold.
 *
 * ## The priors are REAL, which is the half a compile-time tie cannot give
 *
 * `engineChannels.ts` ties the schema to `CommandPrior` in both directions, so a
 * missing member and a wrong shape are compile errors. That tie is a statement
 * about types. This file runs the actual capture against an actual document and
 * puts what comes back through the actual schema — which is what separates *the
 * type says it fits* from *the value parses*, and those differ wherever zod is
 * stricter than TypeScript (`.strict()` on an object the kernel gives an extra
 * key, a number the schema requires to be an integer).
 */

let base: ByteImage;

beforeAll(async () => {
  const document = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) document.addPage([200, 300]);

  // AN OPTIONAL-CONTENT GROUP, because `setLayerVisibility` is one of the nine
  // and its capture refuses on a document with no layers — which would leave
  // that kind's case unable to produce a prior and quietly skipped.
  const context = document.context;
  const group = (name: string): ReturnType<typeof context.register> =>
    context.register(context.obj({ Type: PDFName.of('OCG'), Name: PDFString.of(name) }));
  const all = PDFArray.withContext(context);
  all.push(group('Visible layer'));
  document.catalog.set(
    PDFName.of('OCProperties'),
    context.obj({ OCGs: all, D: context.obj({ Order: all }) }),
  );

  // A TEXT FIELD, for the layer group's reason one kind along: `fillFormField`
  // is one of the ten and its capture refuses on a page with no widget at the
  // index it names.
  const font = await document.embedFont(StandardFonts.Helvetica);
  const text = document.getForm().createTextField('applicant.name');
  text.setText('Ada');
  const first = document.getPages()[0];
  if (first === undefined) throw new Error('the fixture must have a first page');
  text.addToPage(first, { x: 20, y: 240, width: 120, height: 20, font });

  base = await document.save({ useObjectStreams: false });
});

/**
 * The kinds this file owes a command for, as the declaration table states them.
 *
 * Written as a type as well as derived at run time below, and the two do
 * different jobs: this makes {@link COMMANDS} exhaustive at compile time — a
 * tenth invertible command is a missing property, named — while the runtime
 * derivation is what drives the loop over real documents.
 */
type InvertibleKind = {
  [K in CommandKind]: DeclaredCommands[K]['writer'] extends 'mupdf'
    ? DeclaredCommands[K]['invertible'] extends true
      ? K
      : never
    : never;
}[CommandKind];

/**
 * One command per invertible kind, each chosen to CHANGE the document.
 *
 * A command that changes nothing still captures a prior, so the choice matters
 * less than it looks — but a `movePage` from 0 to 0 would produce a prior whose
 * two numbers are equal, and an inverse that transposed them would parse and
 * pass. Every command here moves the document somewhere it was not.
 */
const COMMANDS: { readonly [K in InvertibleKind]: CommandOfKind<K> } = {
  rotatePages: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
  setLayerVisibility: { kind: 'setLayerVisibility', layer: 0, visible: false },
  movePage: { kind: 'movePage', from: 0, to: 2 },
  duplicatePage: { kind: 'duplicatePage', page: 1 },
  swapPages: { kind: 'swapPages', a: 0, b: 2 },
  insertBlankPage: { kind: 'insertBlankPage', at: 1 },
  cropPages: {
    kind: 'cropPages',
    pages: [0, 2],
    margins: { top: 5, right: 6, bottom: 7, left: 8 },
  },
  resizePages: { kind: 'resizePages', pages: 'all', widthPoints: 400, heightPoints: 500 },
  setPageTransition: {
    kind: 'setPageTransition',
    pages: [1],
    style: 'blinds',
    durationSeconds: 2,
  },
  fillFormField: {
    kind: 'fillFormField',
    page: 0,
    index: 0,
    value: { set: 'text', text: 'Grace' },
    // THE VERSION THE BUS COMPARES, not one this file checks: `capture` is
    // called below directly, and the staleness refusal happens before the bus
    // reaches a spec. Any version parses here.
    version: asDocVersion(1),
  },
};

/** The kinds the declaration table says are MuPDF-routed and invertible. */
const INVERTIBLE = (Object.keys(declaredCommands) as readonly CommandKind[]).filter(
  // THE PREDICATE IS {@link InvertibleKind}'S OWN CONDITION, written a second
  // time because a type cannot be read at run time. The compiler takes this
  // narrowing on trust; what checks it is the first case below, which requires
  // the two spellings to select the same set.
  (kind): kind is InvertibleKind =>
    declaredCommands[kind].writer === 'mupdf' && declaredCommands[kind].invertible,
);

async function onSession<T>(work: (session: MupdfSession) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(base);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

describe("engine/capture's declared result", () => {
  it('HAS A CASE FOR EVERY INVERTIBLE MuPDF KIND, derived from the declarations', () => {
    // The list above is hand-written and the set is derived, so this is what
    // makes a tenth command meet a red build here rather than a green one. It
    // is the same 4c argument the derivation itself rests on, one level up.
    expect(Object.keys(COMMANDS).sort()).toStrictEqual([...INVERTIBLE].sort());
  });

  it('ACCEPTS THE PRIOR EACH CAPTURE ACTUALLY PRODUCES', async () => {
    const result = engineChannels['engine/capture'].result;
    /** Kind → what the schema said about the prior the kernel captured. */
    const verdicts: Record<string, string> = {};

    for (const kind of INVERTIBLE) {
      const command = COMMANDS[kind];
      // ONE SESSION PER KIND, in order. A shared session would carry the
      // previous command's document into the next capture, and several of these
      // change the page count — so `cropPages` on page 2 would be asking about
      // a page `duplicatePage` created.
      const captured = await onSession((session) => localMupdfExecution.capture(session, command));
      if (!captured.captured) {
        verdicts[kind] = `the capture refused: ${captured.reason}`;
        continue;
      }
      const parsed = result.safeParse({
        captured: true,
        value: taggedPrior(kind, captured.prior),
      });
      verdicts[kind] = parsed.success ? 'accepted' : `REFUSED: ${parsed.error.message}`;
    }

    // ONE ASSERTION OVER THE WHOLE MAP rather than one per kind, so a run names
    // every kind that fails instead of stopping at the first — which is what a
    // reader needs when a schema and a table have drifted.
    expect(verdicts).toStrictEqual(
      Object.fromEntries(INVERTIBLE.map((kind) => [kind, 'accepted'])),
    );
  });

  it('CONTROL: it refuses a prior whose shape is wrong for the kind it names', async () => {
    // Without this, the case above passes against a schema that accepts
    // anything — `z.unknown()` in place of every member would satisfy it
    // perfectly, and *the answer was accepted* is this file's reassuring
    // answer. The prior here is a REAL one, taken from a different kind, so
    // what is being refused is a mismatch rather than nonsense.
    const rotation = await onSession((session) =>
      localMupdfExecution.capture(session, COMMANDS.rotatePages),
    );
    if (!rotation.captured) throw new Error('the fixture must capture a rotation');

    const parsed = engineChannels['engine/capture'].result.safeParse({
      captured: true,
      value: { kind: 'swapPages', prior: rotation.prior },
    });
    expect(parsed.success).toBe(false);
  });

  it('CONTROL: three kinds this schema is known to carry, so a shrink is visible', () => {
    // 4c's other direction. The case above derives its expectation from the
    // declarations, so a kind LEAVING that table takes its own case with it and
    // the map still matches. These three are an independent claim.
    const kinds = new Set(INVERTIBLE);
    expect([...kinds].sort()).toContain('swapPages');
    expect([...kinds].sort()).toContain('movePage');
    expect([...kinds].sort()).toContain('setPageTransition');
  });
});
