import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { AnnotationRect, CommandOfKind } from '@monstera/contract';
import { createFormFieldSchema } from '@monstera/contract';

import {
  applyCreateFormField,
  captureCreateFormField,
  invertCreateFormField,
} from './formFieldCreate.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';

/**
 * Creating a form field, read back through **MuPDF** — a different library from
 * the one that wrote it.
 *
 * That is not a stylistic preference here, it is the only thing that can catch
 * the defect this row is exposed to. pdf-lib's own reader agrees with pdf-lib's
 * writer about which space a rectangle is in, whichever space that turns out to
 * be, so a round trip through one library is satisfied by a field on the wrong
 * part of the page.
 *
 * ## THE THIRD THING THAT NAMES BOTH NUMBERS
 *
 * `CLAUDE.md`'s wired-tools rule says a kernel proof and a UI test prove nothing
 * where the two halves speak different coordinate systems, and that the remedy
 * is a third thing stating the correspondence once. Here the two frames are the
 * command's rectangle (PDF user space, absolute) and pdf-lib's `addToPage`
 * argument (which turns about its anchor), and {@link PLACED} is that third
 * thing: **one rectangle, asserted to arrive verbatim in `/Rect` on every page
 * shape**. A case reading the rectangle back through the command's own idea of
 * where it put it would be the round trip that agrees with itself.
 */
const PLACED: AnnotationRect = { x0: 100, y0: 100, x1: 220, y1: 124 };

/** What `PLACED` must read as in the file, in the order `/Rect` holds. */
const PLACED_RECT = [100, 100, 220, 124] as const;

/**
 * The clause only THIS build's refusal carries.
 *
 * pdf-lib's own message says *"A field already exists with the specified
 * name"*, and so did this build's until 2026-09-08 — at which point deleting
 * the guard entirely left all 22 cases green, because the value fell through to
 * a refusal that says the same words. Matching a clause pdf-lib never writes is
 * what makes a green here mean the guard ran.
 */
const OURS = /either is a path prefix of the other/iu;

/** One placement, which is what these cases vary. */
const TEXT_FIELD: CommandOfKind<'createFormField'>['fields'][number] = {
  rect: PLACED,
  name: 'applicant.name',
  field: { type: 'text' },
};

/**
 * The command placing one field, with whatever a case is about overridden.
 *
 * A builder rather than a constant since the payload became **plural** on
 * 2026-09-08: the five drawing tools each send one field, and what made it a
 * list is flat-field detection, where accepting twenty candidates is one
 * decision and therefore one undo. Every case below is about a single
 * placement, so the list shape belongs in one place rather than in each of them.
 *
 * @param over what this case changes about the placement
 * @param page which page, for the one case that names a page it does not have
 */
function creating(
  over: Partial<CommandOfKind<'createFormField'>['fields'][number]> = {},
  page = 0,
): CommandOfKind<'createFormField'> {
  return { kind: 'createFormField', page, fields: [{ ...TEXT_FIELD, ...over }] };
}

/**
 * A page of a named shape, with an existing field when one is wanted.
 *
 * The rotation and the crop are the two shapes that separate a writer working in
 * user space from one working in the page's displayed space. An upright page
 * whose boxes start at the origin agrees with every candidate answer, so a
 * fixture set of only that shape asks nothing.
 */
async function pageOf(options: {
  readonly rotate?: number;
  readonly crop?: readonly [number, number, number, number];
  readonly existing?: string;
}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  page.setRotation(degrees(options.rotate ?? 0));
  if (options.crop !== undefined) {
    const [x0, y0, x1, y1] = options.crop;
    page.setCropBox(x0, y0, x1 - x0, y1 - y0);
  }
  if (options.existing !== undefined) {
    const font = await document.embedFont(StandardFonts.Helvetica);
    const field = document.getForm().createTextField(options.existing);
    field.setText('before');
    field.addToPage(page, { x: 40, y: 40, width: 120, height: 20, font });
  }
  // PINNED to a date no run can produce, so the /ModDate case below reads a
  // value rather than comparing two things this test wrote seconds apart.
  document.setModificationDate(new Date(Date.UTC(2001, 0, 2, 3, 4, 5)));
  return document.save();
}

/** What MuPDF's widget walk says about page 0. */
async function widgets(
  bytes: Uint8Array,
): Promise<{ type: string; name: string; options: string[] }[]> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) =>
      document
        .loadPage(0)
        .getWidgets()
        .map((widget) => ({
          type: widget.getFieldType(),
          name: widget.getName(),
          options: widget.getOptions(),
        })),
    );
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * The `/Rect` and `/MK /R` of the LAST widget, off the dictionary.
 *
 * Deliberately not `PDFAnnotation.getRect`, which answers in the space its own
 * setter takes: an API that round-trips its own convention agrees with itself
 * whichever space you believed you were in, which is the exact reading
 * `pageAnnotations.ts` records as unable to catch a frame error. Four numbers
 * off the object cannot do that.
 */
async function placement(bytes: Uint8Array): Promise<{ rect: number[]; turn: number | null }> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const annots = document.findPage(0).get('Annots');
      if (annots.isNull() || annots.length === 0) return { rect: [], turn: null };
      const widget = annots.get(annots.length - 1);
      const array = widget.get('Rect');
      const rect: number[] = [];
      for (let corner = 0; corner < array.length; corner += 1) {
        rect.push(array.get(corner).asNumber());
      }
      const mark = widget.get('MK');
      const turn = mark.isNull() ? null : mark.get('R');
      return { rect, turn: turn === null || turn.isNull() ? null : turn.asNumber() };
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** What a named field holds, read with pdf-lib, which is the library that can. */
async function textOf(bytes: Uint8Array, name: string): Promise<string> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return document.getForm().getTextField(name).getText() ?? '';
}

describe('createFormField — the five kinds pdf-lib has a factory for', () => {
  it('creates a text field MuPDF reads back by name and kind', async () => {
    const made = await applyCreateFormField(await pageOf({}), creating());

    expect(await widgets(made)).toStrictEqual([
      { type: 'text', name: 'applicant.name', options: [] },
    ]);
  });

  it('creates a checkbox, a dropdown and a listbox, each with what its kind needs', async () => {
    const blank = await pageOf({});

    expect(
      await widgets(
        await applyCreateFormField(blank, creating({ field: { type: 'checkbox' } })),
      ),
    ).toStrictEqual([{ type: 'checkbox', name: 'applicant.name', options: [] }]);

    expect(
      await widgets(
        await applyCreateFormField(
          blank,
          creating({ field: { type: 'dropdown', options: ['Dr', 'Mr', 'Ms'] } }),
        ),
      ),
    ).toStrictEqual([{ type: 'combobox', name: 'applicant.name', options: ['Dr', 'Mr', 'Ms'] }]);

    expect(
      await widgets(
        await applyCreateFormField(
          blank,
          creating({ field: { type: 'listbox', options: ['English', 'Dutch'] } }),
        ),
      ),
    ).toStrictEqual([{ type: 'listbox', name: 'applicant.name', options: ['English', 'Dutch'] }]);
  });

  it('a radio group is ONE field, and a second option joins it rather than colliding', async () => {
    const first = await applyCreateFormField(
      await pageOf({}),
      creating({ name: 'applicant.post', field: { type: 'radio', option: 'first' } }),
    );
    const both = await applyCreateFormField(
      first,
      creating({
        rect: { x0: 240, y0: 100, x1: 260, y1: 120 },
        name: 'applicant.post',
        field: { type: 'radio', option: 'second' },
      }),
    );

    // TWO WIDGETS, ONE NAME, and both carry both options — which is what makes
    // this a group rather than two fields that happen to be near each other.
    expect(await widgets(both)).toStrictEqual([
      { type: 'radiobutton', name: 'applicant.post', options: ['first', 'second'] },
      { type: 'radiobutton', name: 'applicant.post', options: ['first', 'second'] },
    ]);
  });

  it('creates no VALUE, because filling is MuPDF’s row', async () => {
    const made = await applyCreateFormField(await pageOf({}), creating());

    // The one assertion that separates *created empty* from *created with
    // something*: a created field a person has not filled must read as empty,
    // and `fillFormField` is what puts a value in it.
    expect(await textOf(made, 'applicant.name')).toBe('');
  });
});

describe('createFormField — where the rectangle lands', () => {
  it('writes the command’s rectangle into /Rect verbatim on an upright page', async () => {
    const made = await applyCreateFormField(await pageOf({}), creating());

    expect((await placement(made)).rect).toStrictEqual([...PLACED_RECT]);
  });

  it('writes the same rectangle on a page whose CropBox corner is not the origin', async () => {
    // THE SHAPE THAT SEPARATES a rectangle measured from the visible box from
    // one measured from user space. An upright page starting at (0, 0) cannot:
    // both answers agree on it.
    const made = await applyCreateFormField(
      await pageOf({ crop: [30, 70, 380, 560] }),
      creating(),
    );

    expect((await placement(made)).rect).toStrictEqual([...PLACED_RECT]);
  });

  it('writes the same rectangle on a /Rotate 90 page, and turns the CONTENT to match', async () => {
    const made = await applyCreateFormField(await pageOf({ rotate: 90 }), creating());
    const landed = await placement(made);

    // BOTH HALVES, and neither alone is the property. The rectangle says where
    // the field is; `/MK /R` says which way up its content is drawn, and a field
    // created without it renders 3 pixels of sideways ink where 111 belong
    // (measured 2026-09-08). A case asserting only the rectangle passes with the
    // rotation deleted, which is the mutation this pair exists to fail.
    expect(landed.rect).toStrictEqual([...PLACED_RECT]);
    expect(landed.turn).toBe(90);
  });

  it('turns the content by 180 and 270 too, and still lands on the rectangle', async () => {
    // THE OTHER TWO TURNS, because the pre-image was written from the 90-degree
    // reading and a formula extrapolated from one turn is three assumptions.
    for (const rotate of [180, 270]) {
      const made = await applyCreateFormField(await pageOf({ rotate }), creating());
      const landed = await placement(made);
      expect(landed.rect).toStrictEqual([...PLACED_RECT]);
      expect(landed.turn).toBe(rotate);
    }
  });

  it('an upright page’s content is NOT turned', async () => {
    // The control for the three above: without it, a writer that turned
    // everything by 90 would satisfy every rotated case and this file would say
    // the turn tracks the page.
    expect((await placement(await applyCreateFormField(await pageOf({}), creating()))).turn).toBe(
      0,
    );
  });

  it('a rectangle drawn right-to-left lands the same way up', async () => {
    // The schema deliberately does not normalise — a drag runs in whichever
    // direction the pointer went — so the kernel does, and this is the case
    // that says so rather than a comment.
    const made = await applyCreateFormField(
      await pageOf({}),
      creating({ rect: { x0: PLACED.x1, y0: PLACED.y1, x1: PLACED.x0, y1: PLACED.y0 } }),
    );

    expect((await placement(made)).rect).toStrictEqual([...PLACED_RECT]);
  });
});

describe('createFormField — what it refuses', () => {
  /**
   * What only THIS command's refusal says.
   *
   * The first spelling of the two cases below asserted `/already exists/`, and
   * both survived deleting the guard entirely — because pdf-lib's own message is
   * *"A field already exists with the specified name"*. The value fell through
   * to a different refusal whose message says the same words, which is the trap
   * `CLAUDE.md` records three instances of: assert the decision, not the tidy
   * state both arrive at.
   *
   * This clause is in this build's message and in nothing pdf-lib throws, so a
   * case matching it fails the moment the guard stops being the thing that
   * refuses. Verified by that mutation: with the guard removed, both cases go
   * red instead of green.
   */
  // AT MODULE SCOPE since 2026-09-08, because the plural payload gave it a
  // second caller in another `describe` — and two spellings of the clause that
  // separates this build's refusal from pdf-lib's would be exactly the thing
  // the mutation caught, one file along.

  it('refuses a name the document already carries, and says so in its OWN words', async () => {
    const taken = await pageOf({ existing: 'applicant.name' });

    await expect(applyCreateFormField(taken, creating())).rejects.toThrow(OURS);
  });

  it('refuses a name that is a PREFIX of an existing one, because a dot makes a parent', async () => {
    const taken = await pageOf({ existing: 'applicant.name' });

    await expect(applyCreateFormField(taken, creating({ name: 'applicant' }))).rejects.toThrow(
      OURS,
    );
  });

  it('refuses a name UNDER an existing one, which is the same collision the other way', async () => {
    // The guard tests both directions and one case covers one of them. Without
    // this, a guard that only looked for existing names starting with the
    // wanted one would pass every case above.
    const taken = await pageOf({ existing: 'applicant' });

    await expect(
      applyCreateFormField(taken, creating({ name: 'applicant.name' })),
    ).rejects.toThrow(OURS);
  });

  it('accepts a SIBLING under the same parent, so the rule is not a ban on shared prefixes', async () => {
    // The control the three refusals need. `applicant.name` and `applicant.age`
    // share a parent and do not collide — measured 2026-09-08 — so a guard that
    // refused any name sharing a leading segment would satisfy every case above
    // and break every real form.
    const taken = await pageOf({ existing: 'applicant.name' });

    expect(
      (await widgets(await applyCreateFormField(taken, creating({ name: 'applicant.age' }))))
        .map((widget) => widget.name),
    ).toStrictEqual(['applicant.name', 'applicant.age']);
  });

  it('refuses a radio option whose name belongs to a field that is not a group', async () => {
    const taken = await pageOf({ existing: 'applicant.name' });

    await expect(
      applyCreateFormField(taken, creating({ field: { type: 'radio', option: 'first' } })),
    ).rejects.toThrow(/not a radio group/u);
  });

  it('refuses a page index outside the document', async () => {
    await expect(applyCreateFormField(await pageOf({}), creating({}, 4))).rejects.toThrow(
      /outside this document/u,
    );
  });

  it('CONTROL: the same command succeeds on a document that does not carry the name', async () => {
    // Without this every refusal above could be a command that refuses
    // everything, which is the same observation as a command that refuses the
    // right thing.
    await expect(applyCreateFormField(await pageOf({}), creating())).resolves.toBeInstanceOf(
      Uint8Array,
    );
  });
});

describe('createFormField — what it leaves alone', () => {
  it('preserves a field that was already there, and its value', async () => {
    const carrying = await pageOf({ existing: 'existing.text' });
    const made = await applyCreateFormField(carrying, creating());

    expect((await widgets(made)).map((widget) => widget.name)).toStrictEqual([
      'existing.text',
      'applicant.name',
    ]);
    expect(await textOf(made, 'existing.text')).toBe('before');
  });

  it('is reproducible, and preserves the document’s own /ModDate', async () => {
    const original = await pageOf({});
    const once = await applyCreateFormField(original, creating());
    const twice = await applyCreateFormField(original, creating());

    expect(Buffer.from(twice)).toStrictEqual(Buffer.from(once));

    // THE CASE THAT HOLDS THE PROPERTY, and the byte comparison above does not.
    // Two applies normally land inside one clock tick, so byte equality is what
    // an UNPINNED load produces as well — the defect surfaces only as a flake.
    // The fixture's date is pinned to 2001 and no stamp can produce it.
    const session = await mupdfWriter.open(once);
    try {
      const date = await withDocument(session, (document) =>
        document.getTrailer().get('Info').get('ModDate').asString(),
      );
      expect(date).toBe('D:20010102030405Z');
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('createFormField — undo, and the schema’s own bounds', () => {
  it('captures nothing, and says why in terms of the /AcroForm rather than the page', async () => {
    const refused = await captureCreateFormField(await pageOf({}), creating());

    expect(refused.captured).toBe(false);
    // The REASON, not just the refusal: this command's is measured and differs
    // from every other byte-image row's, so a case asserting only `false` would
    // pass if it were replaced with the watermark's.
    // NARROWED BY THE DISCRIMINANT rather than compared to `false`: the union's
    // `reason` exists only on the refusing member, so `!refused.captured` is
    // what makes it readable at all.
    expect(refused.captured ? '' : refused.reason).toMatch(/AcroForm/u);
  });

  it('invert throws, and nothing can call it', () => {
    expect(() => invertCreateFormField(new Uint8Array(), undefined as never)).toThrow(
      /no inverse/u,
    );
  });

  it('the schema refuses a name with an empty segment', () => {
    // A dot makes a parent, so `a..b` asks for a node whose name is nothing.
    expect(createFormFieldSchema.safeParse(creating({ name: 'a..b' })).success).toBe(false);
    expect(createFormFieldSchema.safeParse(creating({ name: '.leading' })).success).toBe(false);
    expect(createFormFieldSchema.safeParse(creating({ name: 'trailing.' })).success).toBe(false);
  });

  it('the schema accepts an ordinary dotted name, so the refusal is not a ban on dots', () => {
    // The control the three refusals above need: a rule that rejected every
    // dotted name would satisfy all of them.
    expect(createFormFieldSchema.safeParse(creating()).success).toBe(true);
  });

  it('the schema refuses a choice field with no options', () => {
    expect(
      createFormFieldSchema.safeParse(creating({ field: { type: 'dropdown', options: [] } }))
        .success,
    ).toBe(false);
  });

  it('the schema refuses a create with NO fields, which would be a command that does nothing', () => {
    // The payload became a list on 2026-09-08, and an empty one is the state
    // the list made expressible: a version bump, a log entry and an undo step
    // for a document nothing happened to. `.min(1)` makes it unrepresentable
    // rather than a no-op the bus quietly records.
    expect(createFormFieldSchema.safeParse({ kind: 'createFormField', page: 0, fields: [] }).success).toBe(
      false,
    );
  });

  it('MINTS SEVERAL FIELDS IN ONE COMMAND, which is what accepting a page of candidates is', async () => {
    // ONE decision, one log entry, one undo. A loop in the surface would be
    // three version bumps of which two are stale — `removeAnnotation`'s
    // argument for a plural payload, on the other walk.
    const made = await applyCreateFormField(await pageOf({}), {
      kind: 'createFormField',
      page: 0,
      fields: [
        { rect: PLACED, name: 'first', field: { type: 'text' } },
        { rect: { x0: 100, y0: 140, x1: 220, y1: 164 }, name: 'second', field: { type: 'text' } },
        { rect: { x0: 100, y0: 180, x1: 116, y1: 196 }, name: 'third', field: { type: 'checkbox' } },
      ],
    });

    expect(await widgets(made)).toStrictEqual([
      { type: 'text', name: 'first', options: [] },
      { type: 'text', name: 'second', options: [] },
      { type: 'checkbox', name: 'third', options: [] },
    ]);
  });

  it('CONTROL: a batch naming one field twice is refused, and by THIS build’s rule', async () => {
    // The name guard runs against the form as it stands, so the second
    // placement meets the first. Matched on the clause only this build's
    // message carries, for the reason the mutation on 2026-09-08 established:
    // pdf-lib's own refusal says "already exists" too.
    await expect(
      applyCreateFormField(await pageOf({}), {
        kind: 'createFormField',
        page: 0,
        fields: [
          { rect: PLACED, name: 'twice', field: { type: 'text' } },
          { rect: { x0: 100, y0: 140, x1: 220, y1: 164 }, name: 'twice', field: { type: 'text' } },
        ],
      }),
    ).rejects.toThrow(OURS);
  });
});
