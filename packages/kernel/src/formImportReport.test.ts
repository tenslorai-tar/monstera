import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { MupdfSession } from './engineSeam.js';
import { MAX_REPORTED_SKIPS, readFormData, readFormImportPlan, serialiseFormData } from './formData.js';
import { buildFormTestPdf } from './formTestForm.js';
import { engineChannels } from './host/engineChannels.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * What an import tells a person it did: the fields it fills and the fields it leaves, each with its reason.
 *
 * The report is the plan the fill follows (`planFormImport`), so it cannot say something the fill does not do. The
 * application's OWN export reports nothing left out: that is the owner's complaint turned into a number. Each case that
 * expects a skip is paired with the clean one, so a report that listed everything, or nothing, fails one of them.
 */
async function onSession<T>(bytes: Uint8Array, work: (session: MupdfSession) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A file in the application's own format, naming these fields. */
const fileOf = (fields: readonly { readonly name: string; readonly values: readonly string[] }[]): Uint8Array =>
  serialiseFormData(
    fields.map((field) => ({ ...field, asName: false })),
    'json',
  );

/** The form with a value in a few fields, exported as the application writes it. */
async function ownExport(): Promise<{ readonly form: Uint8Array; readonly json: Uint8Array }> {
  const document = await PDFDocument.load(await buildFormTestPdf());
  document.getForm().getTextField('full_name').setText('Grace Hopper');
  document.getForm().getTextField('email').setText('grace@example.org');
  document.getForm().getRadioGroup('plan').select('plus');
  const filled = await document.save();
  const json = await onSession(filled, async (session) => serialiseFormData(await readFormData(session), 'json'));
  return { form: await buildFormTestPdf(), json };
}

describe('the import report', () => {
  it('the application’s own export fills what it names and leaves NOTHING out', async () => {
    const { form, json } = await ownExport();
    const report = await onSession(form, (session) => readFormImportPlan(session, json, 'json'));
    expect(report.skipped).toStrictEqual([]);
    expect(report.more).toBe(0);
    // THE FIELDS THE FORM WAS GIVEN, and the fields nothing was written for are already as the file says.
    expect(report.filled).toBeGreaterThanOrEqual(3);
    expect(report.named).toBeGreaterThan(report.filled - 1);
  });

  it('names a field the file has and the form lacks, and one the form locks, each with its reason (control)', async () => {
    const { form } = await ownExport();
    const file = fileOf([
      { name: 'full_name', values: ['Ada'] },
      { name: 'no_such_field', values: ['x'] },
      { name: 'order_ref', values: ['CHANGED-1'] },
    ]);
    const report = await onSession(form, (session) => readFormImportPlan(session, file, 'json'));
    expect(report.skipped).toStrictEqual(
      expect.arrayContaining([
        { name: 'no_such_field', reason: 'not-in-document' },
        { name: 'order_ref', reason: 'read-only' },
      ]),
    );
    expect(report.skipped.length).toBe(2);
    expect(report.filled, 'the field it can fill is still filled').toBe(1);
    expect(report.named).toBe(3);
  });

  it('a file that names nothing the form has reports every name and fills none', async () => {
    const { form } = await ownExport();
    const file = fileOf([
      { name: 'zzz_1', values: ['a'] },
      { name: 'zzz_2', values: ['b'] },
    ]);
    const report = await onSession(form, (session) => readFormImportPlan(session, file, 'json'));
    expect(report.filled).toBe(0);
    expect(report.named).toBe(2);
    expect(report.matched, 'none of the names is the form’s, which is the wrong file').toBe(0);
    expect(report.skipped.map((skip) => skip.reason)).toStrictEqual(['not-in-document', 'not-in-document']);
  });

  it('lists at most the bound and counts the rest, each name cut for the wire', async () => {
    const { form } = await ownExport();
    const many = Array.from({ length: MAX_REPORTED_SKIPS + 25 }, (_unused, at) => ({
      name: `missing_${String(at)}_${'x'.repeat(300)}`,
      values: ['a'],
    }));
    const report = await onSession(form, (session) => readFormImportPlan(session, fileOf(many), 'json'));
    expect(report.skipped.length).toBe(MAX_REPORTED_SKIPS);
    expect(report.more).toBe(25);
    // COUNTED BEFORE THE CUT: a list this long of fields the form lacks is still the wrong file.
    expect(report.matched).toBe(0);
    // AND THE WIRE ADMITS IT after a JSON round trip, the answer's own schema being the judge.
    expect(
      engineChannels['engine/form-import-plan'].result.safeParse(JSON.parse(JSON.stringify(report)) as unknown).success,
    ).toBe(true);
    expect(Math.max(...report.skipped.map((skip) => skip.name.length))).toBeLessThanOrEqual(128);
  });

  it('CONTROL: a file that is not form data is a refusal, never an empty report', async () => {
    const { form } = await ownExport();
    await expect(onSession(form, (session) => readFormImportPlan(session, bytesOf('this is not json'), 'json'))).rejects.toBeInstanceOf(Error);
  });
});
