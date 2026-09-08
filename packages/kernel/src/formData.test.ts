import { PDFArray, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';

import type { MupdfSession } from './engineSeam.js';
import {
  applyImportFormData,
  type ExportedField,
  NoMatchingFieldsError,
  UnreadableFormDataError,
  UnrepresentableFormDataError,
  readFormData,
  serialiseFormData,
} from './formData.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * Writing a document's form data out.
 *
 * ## THE FIXTURE'S VALUES CLOSE EACH FORMAT'S CONSTRUCTS, deliberately
 *
 * A fixture of ordinary words round-trips through a broken encoder too, and
 * separates nothing. `)` and `\` end a PDF literal string early; `<` and `&`
 * open markup in XFDF; `"` closes an XML attribute. Every one of them is in a
 * value or a name here, so an encoder that forgot any of them fails a case
 * rather than merely being risky.
 *
 * ## The round trip is read back with the ENGINE, not with this module
 *
 * An encoder compared against its own expectation is the encoder agreeing with
 * itself. The FDF cases parse the bytes with MuPDF and compare the values it
 * answers, which is the same reader an import will use — and the measurement's
 * finding is that a naive file **opens**, repaired, silently missing fields, so
 * "it parsed" is asserted per value rather than per file.
 */

/** Values chosen so a naive encoder is wrong rather than merely risky. */
const HOSTILE = {
  'hostile.fdf': 'paren ) backslash \\ open ( end',
  'hostile.xml': 'less < amp & greater > close </field>',
  'hostile.quote': 'quote " inside',
  // NOT ASCII, which is a different encoder branch: a PDF literal string is
  // read as PDFDocEncoding and cannot spell this, so it must become a hex
  // string of UTF-16BE — and a build that emitted a literal would produce a
  // file that parses and holds the wrong characters.
  'hostile.wide': 'ひらがな — em dash',
};

/**
 * A form carrying one text field per hostile value, plus a tick box and a list.
 *
 * `filled: false` leaves every value empty, which is the fixture an IMPORT case
 * needs: importing into the filled document would leave every value already
 * correct, so an apply that wrote nothing would pass.
 */
async function form({ ticked = true, filled = true, multi = true } = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 700]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fields = document.getForm();

  let y = 640;
  for (const [name, value] of Object.entries(HOSTILE)) {
    const text = fields.createTextField(name);
    if (filled) text.setText(value);
    text.addToPage(page, { x: 20, y, width: 200, height: 18, font, borderWidth: 0 });
    y -= 30;
  }

  const tick = fields.createCheckBox('applicant.agrees');
  if (ticked) tick.check();
  tick.addToPage(page, { x: 20, y, width: 16, height: 16, borderWidth: 0 });
  y -= 30;

  // TWO WIDGETS, ONE FIELD — the fold this module has to perform. An export
  // that wrote the widget walk would carry this name twice.
  const radio = fields.createRadioGroup('applicant.post');
  radio.addOptionToPage('first', page, { x: 20, y, width: 16, height: 16, borderWidth: 0 });
  radio.addOptionToPage('second', page, { x: 60, y, width: 16, height: 16, borderWidth: 0 });
  if (filled) radio.select('second');
  y -= 30;

  // A PUSH BUTTON, which carries no data and must not appear in the file.
  const push = fields.createButton('applicant.send');
  push.addToPage('Send', page, { x: 20, y, width: 60, height: 18, font, borderWidth: 0 });
  y -= 30;

  const list = fields.createOptionList('applicant.languages');
  list.addOptions(['English', 'Dutch', 'Welsh']);
  list.addToPage(page, { x: 20, y: y - 40, width: 100, height: 60, font, borderWidth: 0 });
  if (filled && multi) {
    const chosen = PDFArray.withContext(document.context);
    chosen.push(PDFString.of('English'));
    chosen.push(PDFString.of('Welsh'));
    list.acroField.dict.set(PDFName.of('V'), chosen);
  } else if (filled) {
    list.select('Welsh');
  }

  return document.save();
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

function exported(bytes: Uint8Array): Promise<readonly ExportedField[]> {
  return onSession(bytes, (session) => readFormData(session));
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * `/Root /FDF /Fields`, read with MuPDF — the reader an import will use.
 *
 * A name is answered with its slash so a case can tell `/Yes` from `(Yes)`,
 * which is the whole of the type question and which a plain string would hide.
 */
function readFdf(bytes: Uint8Array): { name: string; value: string }[] {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/vnd.fdf');
  // THE NARROWING IS THE ASSERTION THAT IT PARSED AT ALL. `openDocument`
  // answers a `Document`, and an FDF that is not PDF syntax would arrive here
  // as something with no trailer rather than as a throw.
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF-syntax file');
  try {
    const list = document.getTrailer().get('Root').get('FDF').get('Fields');
    const found: { name: string; value: string }[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const entry = list.get(index);
      const value = entry.get('V');
      found.push({
        name: entry.get('T').asString(),
        value: value.isName()
          ? `/${value.asName()}`
          : value.isArray()
            ? Array.from({ length: value.length }, (_unused, at) => value.get(at).asString()).join(
                '|',
              )
            : value.asString(),
      });
    }
    return found;
  } finally {
    document.destroy();
  }
}

describe('readFormData', () => {
  it('FOLDS THE WIDGET WALK BY FIELD, and drops what carries no data', async () => {
    // A radio group is two widgets of one field, so an export written off the
    // walk repeats the name — and a reader taking the last entry gets whichever
    // widget came last. The push button is absent because its value is
    // meaningless by construction, and it is asserted absent rather than
    // assumed: `isPushButton()` covers a kind `isButton()` also covers, and the
    // ORDER of those predicates is the only thing separating them.
    expect(await exported(await form())).toStrictEqual([
      { name: 'hostile.fdf', values: [HOSTILE['hostile.fdf']], asName: false },
      { name: 'hostile.xml', values: [HOSTILE['hostile.xml']], asName: false },
      { name: 'hostile.quote', values: [HOSTILE['hostile.quote']], asName: false },
      { name: 'hostile.wide', values: [HOSTILE['hostile.wide']], asName: false },
      { name: 'applicant.agrees', values: ['Yes'], asName: true },
      // ONE ENTRY FOR TWO WIDGETS, holding the group's selection rather than
      // this widget's own key — and the selection is `"1"` where the option was
      // labelled `"second"`. That is the two-vocabularies hazard `formFields.ts`
      // records, arriving in the export: a radio's EXPORT value is what `/V`
      // holds and what a form's recipient reads, and a file carrying the label
      // instead would tick nothing when imported back.
      { name: 'applicant.post', values: ['1'], asName: true },
      { name: 'applicant.languages', values: ['English', 'Welsh'], asName: false },
    ]);
  });

  it('WRITES /Off FOR A STATEFUL FIELD NOBODY SET, which the document does not say', async () => {
    // Measured 2026-09-08: an unset tick box answers no value at all, not
    // `Off`. So the off state is this build's to supply, and an encoder that
    // passed the empty string through would emit `/V /` — an empty name, which
    // is a syntax error rather than an off state.
    const fields = await exported(await form({ ticked: false }));
    expect(fields.find((field) => field.name === 'applicant.agrees')).toStrictEqual({
      name: 'applicant.agrees',
      values: ['Off'],
      asName: true,
    });
  });
});

describe('serialiseFormData, FDF', () => {
  it('ROUND-TRIPS EVERY HOSTILE VALUE through the engine, byte for byte', async () => {
    const fields = await exported(await form());
    const read = readFdf(serialiseFormData(fields, 'fdf'));

    // THE FIXTURE IS CHECKED FIRST. If the values had lost their brackets on
    // the way in, every assertion below would pass against a file that never
    // contained the construct — the case surviving the exact defect it exists
    // for, which is what a fixture the bug also handles correctly looks like.
    expect(fields[0]?.values[0]).toContain(')');
    expect(fields[0]?.values[0]).toContain('\\');

    expect(read).toStrictEqual([
      { name: 'hostile.fdf', value: HOSTILE['hostile.fdf'] },
      { name: 'hostile.xml', value: HOSTILE['hostile.xml'] },
      { name: 'hostile.quote', value: HOSTILE['hostile.quote'] },
      { name: 'hostile.wide', value: HOSTILE['hostile.wide'] },
      // A NAME AND NOT A STRING. `(Yes)` produces a file every reader parses
      // and no reader ticks the box with.
      { name: 'applicant.agrees', value: '/Yes' },
      { name: 'applicant.post', value: '/1' },
      { name: 'applicant.languages', value: 'English|Welsh' },
    ]);
  });

  it('CONTROL: an unescaped encoder loses fields on the SAME values', async () => {
    // The measurement's finding, pinned as a case: without this, the round trip
    // above is satisfied by a fixture that never needed escaping, and the whole
    // file would pass against an encoder that escapes nothing. The naive
    // encoder is built here from the same fields — and the reading it produces
    // is compared for INEQUALITY, because *the values match* is also what
    // comparing a value with itself produces.
    const fields = await exported(await form());
    const naive = readFdf(new TextEncoder().encode(naiveFdf(fields)));
    expect(naive).not.toStrictEqual(readFdf(serialiseFormData(fields, 'fdf')));
    // AND THE FILE OPENED, which is the shape of the failure rather than a
    // detail: it is not a refusal a caller can catch, it is a file that parses
    // and is missing exactly the fields whose values held a bracket.
    expect(naive.some((entry) => entry.name === '' && entry.value === '')).toBe(true);
  });
});

/** The encoder under control: FDF with nothing escaped. */
function naiveFdf(fields: readonly ExportedField[]): string {
  const objects = [
    '1 0 obj\n<< /FDF << /Fields 2 0 R >> >>\nendobj\n',
    `2 0 obj\n[ ${fields.map((_field, index) => `${String(index + 3)} 0 R`).join(' ')} ]\nendobj\n`,
    ...fields.map(
      (field, index) =>
        `${String(index + 3)} 0 obj\n<< /T (${field.name}) /V ${
          field.asName ? `/${field.values[0] ?? 'Off'}` : `(${field.values[0] ?? ''})`
        } >>\nendobj\n`,
    ),
  ];
  let body = '%FDF-1.2\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const startxref = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(startxref)}\n%%EOF\n`;
  return body;
}

describe('serialiseFormData, XFDF', () => {
  it('ESCAPES MARKUP IN BOTH POSITIONS — element text and the name attribute', async () => {
    const written = text(serialiseFormData(await exported(await form()), 'xfdf'));

    // THE VALUE, whose `</field>` would close the element early and produce a
    // document that parses into something else entirely.
    expect(written).toContain(
      '<value>less &lt; amp &amp; greater &gt; close &lt;/field&gt;</value>',
    );
    // AND THE ATTRIBUTE, which the research instrument's own encoder did not
    // handle because it only ever put values in element content. A quote is
    // harmless in text and closes the attribute here.
    expect(text(serialiseFormData([quoted()], 'xfdf'))).toContain(
      '<field name="a &quot; name">',
    );
    // NOTHING UNESCAPED SURVIVES. Per-string assertions pass while a fifth
    // field leaks; this asks the whole document.
    expect(written.split('<fields>')[1]).not.toMatch(/<(?!\/?(?:fields|field|value|xfdf)\b)/u);
  });

  it('WRITES ONE <value> PER VALUE, which is how the format says several', async () => {
    const written = text(serialiseFormData(await exported(await form()), 'xfdf'));
    expect(written).toContain(
      '<field name="applicant.languages"><value>English</value><value>Welsh</value></field>',
    );
  });

  it('REFUSES A VALUE XML CANNOT CARRY, rather than dropping the character', () => {
    // XML 1.0 admits tab, newline and carriage return out of the C0 range and
    // nothing else — not even as a numeric reference, so there is no escape to
    // reach for. The three options are a file no parser accepts, a file
    // silently missing a character, and a refusal; the first two are the
    // failure this module exists to prevent.
    const control: ExportedField = {
      name: 'odd',
      values: [`bell${String.fromCharCode(7)}here`],
      asName: false,
    };
    expect(() => serialiseFormData([control], 'xfdf')).toThrow(UnrepresentableFormDataError);
    // AND THE OTHER TWO FORMATS CARRY IT, which is what makes the refusal a
    // choice of format rather than a loss.
    expect(text(serialiseFormData([control], 'json'))).toContain('\\u0007');
    expect(readFdf(serialiseFormData([control], 'fdf'))[0]?.value).toBe(control.values[0]);
  });

  it('CONTROL: a tab is carried rather than refused, so the rule is not "any low byte"', () => {
    // The three characters XML does admit. Without this the refusal above is
    // satisfied by a scan that rejects everything below a space, which would
    // refuse a multi-line address.
    const tabbed: ExportedField = { name: 'odd', values: ['a\tb\nc'], asName: false };
    expect(text(serialiseFormData([tabbed], 'xfdf'))).toContain('<value>a\tb\nc</value>');
  });
});

/** A field whose NAME closes an XML attribute. */
function quoted(): ExportedField {
  return { name: 'a " name', values: ['plain'], asName: false };
}

describe('applyImportFormData', () => {
  /** The document after an import of `bytes` in `format`, as the reader lists it. */
  async function afterImport(
    document: Uint8Array,
    bytes: Uint8Array,
    format: 'json' | 'xfdf' | 'fdf',
  ): Promise<readonly ExportedField[]> {
    return await onSession(document, async (session) => {
      await applyImportFormData(session, { kind: 'importFormData', format, bytes });
      return await readFormData(session);
    });
  }

  it('ROUND-TRIPS A WHOLE FORM through FDF, values and states alike', async () => {
    // THE WHOLE PAIR IN ONE CASE, which is what makes it a round trip rather
    // than two half-proofs: the export is read out of one document and imported
    // into a SECOND, emptied one, and what is compared is the two readings.
    // Exporting and importing the same document would pass for a pair that both
    // did nothing.
    //
    // `multi: false`, because the round trip is not lossless over a field
    // holding two values and the case below says so out loud. Using the
    // multi-valued fixture here would fold that limit into a round-trip failure
    // and read as the import being broken.
    const filled = await form({ multi: false });
    const written = serialiseFormData(await exported(filled), 'fdf');

    // THE EMPTY DOCUMENT IS THE FIXTURE THE BUG CANNOT HANDLE. Importing into
    // the filled one would leave every value already correct, so an apply that
    // wrote nothing would pass.
    const blank = await form({ ticked: false, filled: false });
    expect(await exported(blank)).not.toStrictEqual(await exported(filled));

    expect(await afterImport(blank, written, 'fdf')).toStrictEqual(await exported(filled));
  });

  it('ROUND-TRIPS THROUGH JSON TOO, which is the format with an authority', async () => {
    const filled = await form({ multi: false });
    const written = serialiseFormData(await exported(filled), 'json');
    expect(await afterImport(await form({ ticked: false, filled: false }), written, 'json')).toStrictEqual(
      await exported(filled),
    );
  });

  it('REFUSES A FIELD THE FILE GIVES TWO VALUES FOR, which this build cannot write', async () => {
    // THE ASYMMETRY, STATED RATHER THAN DISCOVERED: the export writes both
    // values of a multi-select faithfully and the import cannot put them back,
    // because a fill carries one option. Importing the first and dropping the
    // second would be a loss with no report — into a document the person then
    // saves — so it refuses, which is the same sentence the panel and the
    // capture say about the same shape.
    const both = serialiseFormData(await exported(await form()), 'json');
    await expect(
      afterImport(await form({ ticked: false, filled: false }), both, 'json'),
    ).rejects.toThrow(/writes one per field/u);
  });

  it('ROUND-TRIPS THROUGH XFDF, which is the format with a reader of ours', async () => {
    // THE THIRD FORMAT, and the one whose reader this build wrote (ADR-0046).
    // The round trip is what says the writer and the reader agree — two halves
    // written a day apart, both by us, which is exactly the pair that can drift
    // and still look correct from either side.
    const filled = await form({ multi: false });
    const written = serialiseFormData(await exported(filled), 'xfdf');
    expect(
      await afterImport(await form({ ticked: false, filled: false }), written, 'xfdf'),
    ).toStrictEqual(await exported(filled));
  });

  it('CARRIES THE HOSTILE VALUES THROUGH XFDF, escaped out and unescaped back', async () => {
    // The values that close the format's constructs, through both halves. A
    // fixture of ordinary words round-trips through an encoder that escapes
    // nothing AND a reader that unescapes nothing — the two defects cancel, and
    // only a value carrying `<` and `&` separates them.
    const filled = await form({ multi: false });
    const written = serialiseFormData(await exported(filled), 'xfdf');
    const back = await afterImport(await form({ ticked: false, filled: false }), written, 'xfdf');
    expect(back.find((field) => field.name === 'hostile.xml')?.values).toStrictEqual([
      HOSTILE['hostile.xml'],
    ]);
  });

  it('REFUSES AN XFDF CARRYING A DOCTYPE, which is where three attacks live', async () => {
    // The reader's rule, asserted from the import's side so the wiring is
    // covered too: a reader that refuses and an import that never calls it look
    // identical from `readXfdf`'s own test file.
    const hostile = new TextEncoder().encode(
      '<?xml version="1.0"?><!DOCTYPE xfdf [<!ENTITY x SYSTEM "file:///c:/windows/win.ini">]>' +
        '<xfdf><fields><field name="hostile.fdf"><value>&x;</value></field></fields></xfdf>',
    );
    await expect(afterImport(await form(), hostile, 'xfdf')).rejects.toThrow(
      /document type declaration/u,
    );
  });

  it('REFUSES JSON THAT IS NOT THIS BUILD’S, rather than importing nothing and succeeding', async () => {
    // The marker's whole reason. Without it this file matches no field, fills
    // nothing, and reports success — which is the reassuring answer, and is
    // indistinguishable from importing the right file into the wrong document.
    const foreign = new TextEncoder().encode(
      JSON.stringify({ fields: [{ name: 'hostile.fdf', values: ['x'] }] }),
    );
    await expect(afterImport(await form(), foreign, 'json')).rejects.toBeInstanceOf(
      UnreadableFormDataError,
    );
  });

  it('REFUSES A FILE THAT NAMES NOTHING THIS DOCUMENT HAS', async () => {
    // The likeliest mistake a person makes here is picking the wrong file, and
    // a zero-field import that succeeds looks exactly like one that worked.
    const elsewhere = serialiseFormData(
      [{ name: 'nothing.here', values: ['x'], asName: false }],
      'json',
    );
    await expect(afterImport(await form(), elsewhere, 'json')).rejects.toBeInstanceOf(
      NoMatchingFieldsError,
    );
  });

  it('CHANGES NOTHING when one value is refused — the whole import or none of it', async () => {
    // A partial fill with no report is this row's own subject. The listbox
    // offers `English, Dutch, Welsh`, so `Klingon` is a value the fill row
    // refuses — and the entry BEFORE it in the file is one that would have
    // applied, which is what makes this a case about atomicity rather than
    // about the refusal. The order matters: an import that wrote as it went
    // would have landed the first before meeting the second.
    const document = await form({ ticked: false, filled: false });
    const before = await exported(document);
    const mixed = serialiseFormData(
      [
        { name: 'hostile.fdf', values: ['would have applied'], asName: false },
        { name: 'applicant.languages', values: ['Klingon'], asName: false },
      ],
      'json',
    );

    // ONE SESSION FOR THE APPLY AND THE READ, and that is the whole case. The
    // first spelling re-opened the fixture BYTES afterwards — which no apply
    // can change, since a session holds the parsed document — so it compared
    // the original with itself and passed for an import that wrote as it went.
    // The mutation that writes inside the planning loop is what found it.
    const { refused, after } = await onSession(document, async (session) => {
      let thrown: unknown;
      try {
        await applyImportFormData(session, {
          kind: 'importFormData',
          format: 'json',
          bytes: mixed,
        });
      } catch (error) {
        thrown = error;
      }
      return { refused: thrown, after: await readFormData(session) };
    });

    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).message).toMatch(/does not offer the option/u);
    // AND THE FIRST ENTRY DID NOT LAND. Without this the case passes for an
    // import that applied everything up to the failure — which is the state the
    // two passes exist to prevent, and the one a throw alone says nothing about.
    expect(after).toStrictEqual(before);
  });

  it('IGNORES an entry naming a field this document does not have', async () => {
    // A form exported from another revision carries them, so this must not be a
    // refusal — and the field that DOES match is asserted to have changed, so
    // the case cannot pass for an import that ignored everything.
    const document = await form({ ticked: false, filled: false });
    const partly = serialiseFormData(
      [
        { name: 'gone.in.this.revision', values: ['x'], asName: false },
        { name: 'hostile.fdf', values: ['landed'], asName: false },
      ],
      'json',
    );
    const after = await afterImport(document, partly, 'json');
    expect(after.find((field) => field.name === 'hostile.fdf')?.values).toStrictEqual(['landed']);
  });

  it('PUTS A RADIO GROUP ON THE RIGHT WIDGET, which no widget can decide alone', async () => {
    // The one place a field's value means different things to different
    // widgets: the file names the chosen option's EXPORT value, and each widget
    // is on exactly when its own on-state key equals it. A build that asked
    // each widget *are you on* would answer from the document it is changing.
    const document = await form({ ticked: false, filled: false });
    const chooseSecond = serialiseFormData(
      [{ name: 'applicant.post', values: ['1'], asName: true }],
      'json',
    );
    const after = await afterImport(document, chooseSecond, 'json');
    expect(after.find((field) => field.name === 'applicant.post')?.values).toStrictEqual(['1']);
  });
});

describe('serialiseFormData, JSON', () => {
  it('CARRIES A MARKER, so an import can refuse a file that is not one of these', async () => {
    const written = JSON.parse(text(serialiseFormData(await exported(await form()), 'json'))) as {
      format: string;
      version: number;
      fields: { name: string; values: string[] }[];
    };
    expect({ format: written.format, version: written.version }).toStrictEqual({
      format: 'monstera-form-data',
      version: 1,
    });
    // WITHOUT THE MARKER, importing an arbitrary JSON file matches no field and
    // reports having imported a form — the reassuring answer.
    expect(written.fields).toContainEqual({
      name: 'applicant.languages',
      values: ['English', 'Welsh'],
    });
    expect(written.fields).toContainEqual({
      name: 'hostile.fdf',
      values: [HOSTILE['hostile.fdf']],
    });
  });
});
