import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandKind, Command } from '@monstera/contract';

import { commandSpecs } from './commandSpecs.js';
import { declaredCommands } from './commandDeclarations.js';
import type { MupdfSession } from './engineSeam.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';

/**
 * Every command declaring `purpose: 'removal'` produces bytes its removal is
 * gone from.
 *
 * ## Why this file exists rather than a case inside `formFields.test.ts`
 *
 * [ADR-0045](../../../docs/DECISIONS/0045-a-removals-garbage-collection-belongs-to-the-command.md)
 * puts the collection on the session — `withDocumentRemoving` marks it and
 * `serialise` collects from then on — and nothing in a type stops a future
 * removal command from calling the ordinary helper instead. The name is not the
 * mechanism; **this roster is**, and it is derived from `declaredCommands`, so
 * a command added to that axis arrives here owing its own evidence rather than
 * inheriting flatten's.
 *
 * That is 4c's rule in the direction it allows: the failure feared is the set
 * getting **bigger** — a new removal command nobody wrote a case for — and a
 * derived roster tracks growth perfectly. The shrink direction, a removal
 * command quietly re-declared `'ordinary'`, is held by {@link EXPECTED} below,
 * which is an independent claim about which kinds are on the axis.
 *
 * ## The observable, and why it is not the field's value
 *
 * The reassuring answer here is *the value is not in the bytes*, and searching
 * for it is the fixture the bug also passes: a correct flatten **draws** the
 * field's text into the page's content stream, so the string is there either
 * way. What separates them is the **objects**, read through
 * `enumerateIndirectObjects` rather than by walking the catalog — a bake
 * unlinks the widgets, so anything that walks from the catalog reports them
 * gone whether or not they were written out.
 */

/**
 * Which kinds are expected to declare `purpose: 'removal'`.
 *
 * **The anchor**, and it is not derived on purpose. The roster below is
 * computed from the declaration table and therefore agrees with any shrink: a
 * command re-declared `'ordinary'` leaves the roster silently and every case
 * still passes. This list is the independent claim that has to be edited
 * separately, so removing a command from the axis is a visible decision.
 */
const EXPECTED: readonly CommandKind[] = ['flattenFormFields', 'applyRedactions'];

/** The kinds the declaration table actually puts on the removal axis. */
const REMOVALS = (Object.keys(declaredCommands) as CommandKind[]).filter(
  (kind) => declaredCommands[kind].purpose === 'removal',
);

/**
 * A form carrying one field of each type, plus a push button and a read-only.
 *
 * Nine widgets across six kinds. `formFields.test.ts` builds the same shape for
 * the reader's cases; it is rebuilt here rather than exported from there
 * because a fixture shared between two files is a fixture neither can change.
 */
async function form(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fields = document.getForm();

  const text = fields.createTextField('applicant.name');
  text.setText('GRACE HOPPER');
  text.addToPage(page, { x: 20, y: 540, width: 200, height: 20, font });

  const checkbox = fields.createCheckBox('applicant.agrees');
  checkbox.check();
  checkbox.addToPage(page, { x: 20, y: 500, width: 16, height: 16 });

  const radio = fields.createRadioGroup('applicant.post');
  radio.addOptionToPage('first', page, { x: 20, y: 460, width: 16, height: 16 });
  radio.addOptionToPage('second', page, { x: 60, y: 460, width: 16, height: 16 });
  radio.select('first');

  const dropdown = fields.createDropdown('applicant.title');
  dropdown.addOptions(['Dr', 'Mr', 'Ms']);
  dropdown.select('Dr');
  dropdown.addToPage(page, { x: 20, y: 420, width: 100, height: 20, font });

  const listbox = fields.createOptionList('applicant.languages');
  listbox.addOptions(['English', 'Dutch', 'Welsh']);
  listbox.select('Dutch');
  listbox.addToPage(page, { x: 20, y: 340, width: 100, height: 60, font });

  const locked = fields.createTextField('applicant.reference');
  locked.setText('LOCKED');
  locked.enableReadOnly();
  locked.addToPage(page, { x: 20, y: 300, width: 200, height: 20, font });

  const push = fields.createButton('applicant.submit');
  push.addToPage('Send', page, { x: 20, y: 200, width: 60, height: 20, font });

  const context = document.context;
  const signature = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Widget'),
    FT: PDFName.of('Sig'),
    T: PDFString.of('applicant.signature'),
    Rect: context.obj([20, 240, 220, 280]),
    F: 4,
  });
  const signatureRef = context.register(signature);
  page.node.addAnnot(signatureRef);
  document.catalog
    .lookup(PDFName.of('AcroForm'), PDFDict)
    .lookup(PDFName.of('Fields'), PDFArray)
    .push(signatureRef);

  return document.save();
}

/**
 * Widget and field dictionaries still IN the bytes, whatever references them.
 *
 * `enumerateIndirectObjects` reads the cross-reference table. A walk from the
 * catalog cannot see an unlinked object, which is exactly the object at issue.
 */
async function residue(
  bytes: Uint8Array,
): Promise<{ objects: number; widgets: number; fields: number }> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const all = document.context.enumerateIndirectObjects();
  let widgets = 0;
  let fields = 0;
  for (const [, object] of all) {
    if (!(object instanceof PDFDict)) continue;
    if (object.lookupMaybe(PDFName.of('Subtype'), PDFName) === PDFName.of('Widget')) widgets += 1;
    if (object.get(PDFName.of('FT')) !== undefined) fields += 1;
  }
  return { objects: all.length, widgets, fields };
}

/**
 * A one-page document with text and a `/Redact` mark over the first line.
 *
 * Built through MuPDF rather than pdf-lib, because `createAnnotation('Redact')`
 * is the writer of record's own call and a hand-built dictionary would be this
 * file deciding what a redact mark is.
 */
async function marked(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([400, 600]).drawText('CONFIDENTIAL', { font, size: 18, x: 20, y: 540 });
  const plain = await document.save();

  const session = await mupdfWriter.open(plain);
  try {
    await withDocument(session, (opened) => {
      const page = opened.loadPage(0);
      const structured = JSON.parse(page.toStructuredText().asJSON()) as {
        blocks: readonly { lines: readonly { bbox: { x: number; y: number; w: number; h: number } }[] }[];
      };
      const box = structured.blocks[0]?.lines[0]?.bbox;
      if (box === undefined) throw new Error('the fixture has no text to mark');
      const annotation = page.createAnnotation('Redact');
      annotation.setRect([box.x, box.y, box.x + box.w, box.y + box.h]);
      annotation.update();
    });
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * `/Redact` annotation dictionaries still IN the bytes, whatever references
 * them.
 *
 * {@link residue}'s reason exactly: `enumerateIndirectObjects` reads the
 * cross-reference table, and a walk from the catalog cannot see the unlinked
 * object that is the whole question.
 */
async function redactAnnotations(bytes: Uint8Array): Promise<number> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  let found = 0;
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (object.lookupMaybe(PDFName.of('Subtype'), PDFName) === PDFName.of('Redact')) found += 1;
  }
  return found;
}

async function onSession<T>(
  bytes: Uint8Array,
  work: (session: MupdfSession) => Promise<T>,
): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * What each removal kind is exercised with, and what its removal IS.
 *
 * ## Why this became a table of three things rather than a table of payloads
 *
 * It held payloads alone while `flattenFormFields` was the only kind on the
 * axis, and the per-kind case asserted *no widget or field dictionary* — which
 * is **flatten's** claim, not the axis's. `applyRedactions` joined the axis on
 * 2026-09-12 and passes that assertion on a form fixture by doing nothing at
 * all, which is the shape a roster is for and the shape a shared assertion
 * hides.
 *
 * So each kind now supplies its own fixture, its own payload, and its own
 * **residue** — what must not be in the bytes afterwards. The axis's claim is
 * the one they have in common: *the objects this command unlinked are not
 * written out*, and only the kind knows which objects those are.
 */
interface RemovalCase {
  /** Bytes with the thing this command removes in them. */
  readonly fixture: () => Promise<Uint8Array>;
  readonly payload: Command;
  /** How many of the removed object are in these bytes. */
  readonly residue: (bytes: Uint8Array) => Promise<number>;
  /** What {@link RemovalCase.residue} answers before the command runs. */
  readonly before: number;
}

const REMOVAL_CASES: Readonly<Record<string, RemovalCase>> = {
  flattenFormFields: {
    fixture: form,
    payload: { kind: 'flattenFormFields' },
    residue: async (bytes) => (await residue(bytes)).widgets,
    before: 9,
  },
  applyRedactions: {
    fixture: marked,
    payload: { kind: 'applyRedactions', pages: 'all', cover: 'solid', images: 'pixels' },
    residue: redactAnnotations,
    before: 1,
  },
};

describe('a command whose purpose is removal', () => {
  it('THE ANCHOR: the declaration table puts exactly the expected kinds on the axis', () => {
    // Without this, a command re-declared `'ordinary'` would leave the derived
    // roster below and every case in this file would still pass — a count
    // computed from the list it polices agrees with any shrink.
    expect([...REMOVALS].sort()).toEqual([...EXPECTED].sort());
  });

  it('CONTROL: the fixture carries widget and field dictionaries before anything is applied', async () => {
    // The mirror of every case below. `no widget dictionaries left` is also
    // what a detector that cannot recognise one answers, so the detector has to
    // find them in the untouched document first.
    const before = await residue(await form());
    expect(before.widgets).toBe(9);
    expect(before.fields).toBe(8);
  });

  it('CONTROL: an ordinary session serialises WITHOUT collecting, so the collection is the removal’s', async () => {
    // The direction that matters. If a plain serialise also came back with zero
    // widget dictionaries, every case below would pass for a reason that has
    // nothing to do with the purpose axis — the mutation would land nowhere.
    const bytes = await form();
    const plain = await onSession(bytes, (session) => mupdfWriter.serialise(session));
    const after = await residue(plain);
    expect(after.widgets).toBe(9);
    expect(after.fields).toBe(8);
  });

  for (const kind of REMOVALS) {
    it(`${kind}: what it unlinked is not in the bytes afterwards`, async () => {
      const removal = REMOVAL_CASES[kind];
      // A kind on the axis with no case here is one that would silently not
      // run. It throws instead, which is what makes the roster owe evidence
      // rather than merely list a name.
      expect(removal, `${kind} declares purpose 'removal' and has no case here`).toBeDefined();
      if (removal === undefined) return;

      const bytes = await removal.fixture();
      // THE FIXTURE'S OWN CONTROL, per kind. *None left* is also what a probe
      // that cannot recognise the object answers, so each kind's residue reader
      // has to find them in the untouched document first.
      expect(await removal.residue(bytes)).toBe(removal.before);

      // AND THE DIRECTION THAT MATTERS, per kind: a plain serialise of the same
      // fixture must still carry them, or the case below would pass for a
      // reason that has nothing to do with the purpose axis.
      const plain = await onSession(bytes, (session) => mupdfWriter.serialise(session));
      expect(await removal.residue(plain)).toBe(removal.before);

      const collected = await onSession(bytes, async (session) => {
        // Through `commandSpecs`, not by importing the apply directly: the
        // question is whether the command as REGISTERED collects, and an apply
        // called by name would prove it about a function nothing routes to.
        const spec = commandSpecs[kind];
        await spec.apply(
          session as never,
          removal.payload as never,
          undefined as never,
          undefined as never,
        );
        return mupdfWriter.serialise(session);
      });

      expect(await removal.residue(collected)).toBe(0);
    });
  }
});
