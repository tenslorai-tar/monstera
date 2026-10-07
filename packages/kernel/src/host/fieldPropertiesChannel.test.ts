import { describe, expect, it } from 'vitest';

import { MAX_READ_FIELDS, formFieldReadSchema } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';

import { applyEditFormFields } from '../formFieldEdit.js';
import { readFieldProperties } from '../formFieldRead.js';
import { readFormFields } from '../formFields.js';
import { buildFormTestPdf } from '../formTestForm.js';
import { mupdfWriter } from '../mupdfWriter.js';
import { engineChannels } from './engineChannels.js';

/**
 * The properties read crossing the engine host's wire.
 *
 * Every field of a form that carries a lot (a comb box, a rotated field, a radio group, a read-only reference, a
 * dropdown) is read through MuPDF, sent through a real JSON round trip and parsed against the channel's declared result,
 * so a shape the reader can answer and the schema refuses is a red case here and not a refusal in a person's document.
 *
 * CONTROL: the same read of a field that has been given a format, a calculation, a tooltip and colours must also pass, so
 * a schema that only admitted the plain defaults would fail it.
 */
describe('engine/field-properties carries what the reader answers', () => {
  it('admits every field of the generated form, after a JSON round trip', async () => {
    const bytes = await buildFormTestPdf();
    const session = await mupdfWriter.open(bytes);
    try {
      const listed = (await readFormFields(session)).fields;
      const handles = listed.map((field) => ({ page: field.page, index: field.index, name: field.name }));
      // THE READ TAKES AT MOST MAX_READ_FIELDS, so the whole form is read in runs of that many.
      for (let at = 0; at < handles.length; at += MAX_READ_FIELDS) {
        const run = handles.slice(at, at + MAX_READ_FIELDS);
        const read = await readFieldProperties(session, run);
        expect(read.length).toBe(run.length);
        expect(read.every((one) => one !== null), 'every handle of the list names its field').toBe(true);
        const wire = JSON.parse(JSON.stringify({ fields: read })) as unknown;
        expect(engineChannels['engine/field-properties'].result.safeParse(wire).success).toBe(true);
      }
      expect(handles.length, 'control: the form has more than one run').toBeGreaterThan(MAX_READ_FIELDS);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('admits a field with a format, a calculation, a tooltip and colours', async () => {
    const original = await buildFormTestPdf();
    const listing = await mupdfWriter.open(original);
    const handle = await (async () => {
      try {
        const found = (await readFormFields(listing)).fields.find((field) => field.name === 'grand_total');
        if (found === undefined) throw new Error('The fixture has no grand_total.');
        return { page: found.page, index: found.index, name: found.name };
      } finally {
        await mupdfWriter.close(listing);
      }
    })();
    const edited = await applyEditFormFields(original, {
      kind: 'editFormFields',
      edits: [
        {
          field: handle,
          set: {
            tooltip: 'Total',
            borderColour: [1, 0, 0],
            fillColour: [0.9, 0.9, 0.2],
            format: { kind: 'number', decimals: 2, separators: 'comma-dot', negative: 'parens', currency: '£', currencyBefore: true },
            calculation: { operation: 'sum', fields: ['phone', 'customer'] },
          },
        },
      ],
      version: asDocVersion(1),
    });
    const session = await mupdfWriter.open(edited);
    try {
      const [one] = await readFieldProperties(session, [handle]);
      expect(one?.tooltip).toBe('Total');
      const wire = JSON.parse(JSON.stringify({ fields: [one] })) as unknown;
      expect(engineChannels['engine/field-properties'].result.safeParse(wire).success).toBe(true);
      expect(formFieldReadSchema.safeParse(one).success).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a handle whose name is not the field there reads as null, which the schema admits', async () => {
    const session = await mupdfWriter.open(await buildFormTestPdf());
    try {
      const read = await readFieldProperties(session, [{ page: 0, index: 0, name: 'not_this_one' }]);
      expect(read).toStrictEqual([null]);
      expect(
        engineChannels['engine/field-properties'].result.safeParse(JSON.parse(JSON.stringify({ fields: read })) as unknown).success,
      ).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
