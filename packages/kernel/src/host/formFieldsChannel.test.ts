import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { createClient, formFieldKindSchema, type Incident, wrapHandlers } from '@monstera/contract';

import { localMupdfExecution } from '../commandSpecs.js';
import type { ByteImage, MupdfSession } from '../engineSeam.js';
import type { ListedField } from '../formFields.js';
import { readFormFields } from '../formFields.js';
import { mupdfWriter } from '../mupdfWriter.js';
import { engineChannels } from './engineChannels.js';
import { type HostFormFieldsReader, type HostSession, createEngineHandlers } from './engineHandlers.js';
import { createRemoteSessions, remoteMupdfFormFields } from './remoteEngine.js';

/**
 * The form field list crossing the engine host's wire.
 *
 * ## WHAT THIS FILE IS ABOUT, and what it deliberately is not
 *
 * `formFields.test.ts` owns the reading — six types, the stale `/AS`, the radio
 * group's two widgets — against a document. This file owns the **wire**: does
 * the declared result admit every shape that reader can answer, after a real
 * `JSON.stringify`/`parse`? Asserting the six types again here would be that
 * file's coverage restated in numbers read from whichever run produced them
 * first, and the two copies would drift in the quiet direction.
 *
 * So the transport is the real one, for `engineAsset.test.ts`' reason:
 * `host/client.ts` frames `JSON.stringify({ id, channel, params })` and
 * `host/runtime.ts` parses the other end, so `structuredClone` here would
 * preserve shapes the shipped pipe cannot carry.
 *
 * ## The kind list is DERIVED, and that direction is the argument
 *
 * The failure this file fears makes the set of kinds **bigger** — a member
 * added to `formFieldKindSchema` with no case naming it — so the enumeration
 * below reads the schema rather than restating it (checklist 4c). A member
 * added on the day a reader can answer it arrives here with a case already
 * pointing at it.
 *
 * **The opposite danger is held by the COMPILER, and this sentence used to
 * claim otherwise.** It said a member leaving is caught by `kindOf`'s cases
 * naming their kinds as literals — which was true of six of the eight and not
 * of `other`, named by no case anywhere. Found by auditing 2026-09-07. What
 * actually holds it is `kindOf`'s return type and `FormsPanel`'s
 * `Record<FormFieldKind, MessageKey>`, both of which stop compiling when a
 * member goes; the cases are corroboration rather than the mechanism. Corrected
 * rather than left, because a comment naming a control that does not exist is
 * the defect this range already found once in `remoteEngine.test.ts`.
 */

let form: ByteImage;

beforeAll(async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const fields = document.getForm();

  // TWO FIELDS AND NOT SIX. The anchor case needs a document the real reader
  // answers something non-empty for; which types it carries is the other
  // file's question.
  const text = fields.createTextField('applicant.name');
  text.setText('Ada');
  text.addToPage(page, { x: 20, y: 540, width: 200, height: 20, font });

  const checkbox = fields.createCheckBox('applicant.agrees');
  checkbox.check();
  checkbox.addToPage(page, { x: 20, y: 500, width: 16, height: 16 });

  form = await document.save();
});

const AREA = {
  snapshotDirectory: 'no directory: a field read carries no asset',
  outputDirectory: 'no directory: a field read writes nothing',
};

/**
 * The two halves joined over a JSON round trip, with the field reader injected.
 *
 * `formFields` is a parameter so a case can drive the boundary with a list the
 * real reader cannot produce today — which is the only way to ask whether the
 * declared result admits a kind no fixture here carries.
 */
async function joined(formFields: HostFormFieldsReader): Promise<{
  readonly session: MupdfSession;
  readonly read: ReturnType<typeof remoteMupdfFormFields>;
  readonly token: MupdfSession;
  readonly stranger: MupdfSession;
  readonly incidents: readonly Incident[];
}> {
  const session = await mupdfWriter.open(form);
  const held = new Map<string, HostSession>([
    [
      'h1',
      {
        session,
        outputDirectory: AREA.outputDirectory,
        snapshotDirectory: AREA.snapshotDirectory,
      },
    ],
  ]);

  const incidents: Incident[] = [];
  const wrapped = wrapHandlers(
    engineChannels,
    createEngineHandlers({
      sessions: {
        lookup: (id) => held.get(id),
        issue: () => {
          throw new Error('this file drives a READ; nothing here opens a session');
        },
        forget: () => {
          throw new Error('this file drives a READ; nothing here closes a session');
        },
      },
      execution: localMupdfExecution,
      // THROWING STUBS, so a handler that reached for a document image or a
      // granted directory fails loudly rather than passing against a surface
      // that happened to work. A field read touches neither.
      writer: {
        open: () => {
          throw new Error('a field read must not open');
        },
        serialise: () => {
          throw new Error('a field read must not serialise');
        },
        close: () => {
          throw new Error('a field read must not close');
        },
      },
      access: () => {
        throw new Error('a field read must not ask what a password bought');
      },
      files: {
        readSnapshot: () => {
          throw new Error('a field read must not read the snapshot directory');
        },
        writeOutput: () => {
          throw new Error('a field read must not write the output directory');
        },
      },
      probe: () => {
        throw new Error('a field read must not probe containment');
      },
      geometry: () => {
        throw new Error('a field read must not read the page tree');
      },
      pageText: () => {
        throw new Error('a field read must not read the page text');
      },
      pageLinks: () => {
        throw new Error('a field read must not read the page links');
      },
      ocr: () => {
        throw new Error('a field read must not recognise anything');
      },
      handwriting: () => {
        throw new Error('a field read must not recognise anything');
      },
      destinations: () => {
        throw new Error('a field read must not read the outline');
      },
      layers: () => {
        throw new Error('a field read must not read the layers');
      },
      annotations: () => {
        throw new Error('a field read must not list annotations');
      },
      formFields,
      duplicates: () => {
        throw new Error('a field read must not look for duplicates');
      },
      extract: () => {
        throw new Error('a field read must not build a document');
      },
      snapshot: () => {
        throw new Error('a field read must not rasterise');
      },
      exportFormData: () => {
        throw new Error('a field read must not encode an export');
      },
      flatFields: () => {
        throw new Error('a field read must not propose candidates');
      },
    }),
    (incident) => incidents.push(incident),
  );

  // THE JSON ROUND TRIP, which is this file's subject. `structuredClone` would
  // preserve shapes the shipped pipe cannot carry, and every case would pass
  // against a transport that cannot deliver them.
  const client = createClient(engineChannels, async (id, params) =>
    wrapped[id](JSON.parse(JSON.stringify(params)) as never),
  );

  const sessions = createRemoteSessions();
  return {
    session,
    read: remoteMupdfFormFields(client, sessions),
    token: sessions.adopt('h1', AREA),
    stranger: sessions.adopt('h2', AREA),
    incidents,
  };
}

/** One field of the named kind, with every other value left plain. */
function field(kind: ListedField['kind'], index: number): ListedField {
  return {
    page: 0,
    index,
    kind,
    name: `field.${kind}`,
    values: [],
    on: null,
    options: [],
    readOnly: false,
    rect: { x0: 1, y0: 2, x1: 3, y1: 4 },
  };
}

describe('engine/form-fields', () => {
  it('ANSWERS WHAT THE READER ANSWERS, over a real JSON round trip', async () => {
    // THE ANCHOR. Both sides come from the same reader on the same document, so
    // what this separates is the wire: a schema that dropped a property, or a
    // transport that could not carry one, differs from the local answer here.
    const direct = await mupdfWriter.open(form);
    let expected;
    try {
      expected = await readFormFields(direct);
    } finally {
      await mupdfWriter.close(direct);
    }

    const { session, read, token, incidents } = await joined(readFormFields);
    try {
      const crossed = await read(token);
      expect(crossed.fields).toStrictEqual(expected.fields);
      // AND IT FOUND SOMETHING (checklist 4b): every broken walk and every
      // boundary that dropped the array print the same clean nothing, so the
      // comparison above is satisfied by two empty lists.
      expect(crossed.fields.map((one) => one.name)).toStrictEqual([
        'applicant.name',
        'applicant.agrees',
      ]);
      expect(incidents).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CARRIES EVERY DECLARED KIND, read from the schema rather than listed here', async () => {
    const kinds = formFieldKindSchema.options;
    const { session, read, token, incidents } = await joined(() =>
      Promise.resolve({
        fields: kinds.map((kind, index) => field(kind, index)),
        truncated: false,
      }),
    );
    try {
      expect((await read(token)).fields.map((one) => one.kind)).toStrictEqual([...kinds]);
      expect(incidents).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CARRIES THE VALUES A DEFAULT WOULD FLATTEN — a null rect, a false on, an option list', async () => {
    // Each of these is a state whose WRONG answer is the one a boundary
    // produces by accident: `null` for a rectangle a page cannot place,
    // `false` for a widget that is off rather than absent, and an option list
    // that is the document's rather than empty. A schema refining any of them
    // away, or a transport dropping one, is invisible in the anchor above,
    // because that document happens to carry none of them.
    const { session, read, token, incidents } = await joined(() =>
      Promise.resolve({
        fields: [
          { ...field('radio', 0), on: false, options: ['first', 'second'], rect: null },
          { ...field('checkbox', 1), on: true, readOnly: true },
          // TWO VALUES, which is the state the wire carried as none until
          // 2026-09-08: a schema whose `values` was a string would refine the
          // array away, and a transport that took the first would answer one.
          { ...field('listbox', 2), values: ['English', 'Dutch'], options: ['English', 'Dutch'] },
        ],
        truncated: false,
      }),
    );
    try {
      expect((await read(token)).fields).toStrictEqual([
        {
          page: 0,
          index: 0,
          kind: 'radio',
          name: 'field.radio',
          values: [],
          on: false,
          options: ['first', 'second'],
          readOnly: false,
          rect: null,
        },
        {
          page: 0,
          index: 1,
          kind: 'checkbox',
          name: 'field.checkbox',
          values: [],
          on: true,
          options: [],
          readOnly: true,
          rect: { x0: 1, y0: 2, x1: 3, y1: 4 },
        },
        {
          page: 0,
          index: 2,
          kind: 'listbox',
          name: 'field.listbox',
          values: ['English', 'Dutch'],
          on: null,
          options: ['English', 'Dutch'],
          readOnly: false,
          rect: { x0: 1, y0: 2, x1: 3, y1: 4 },
        },
      ]);
      expect(incidents).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CARRIES truncated: true, which is the value a defaulting boundary cannot produce', async () => {
    // `false` is what a boundary that dropped the flag answers, so a case
    // asserting `false` separates nothing. This one asks for the other value.
    const { session, read, token } = await joined(() =>
      Promise.resolve({ fields: [field('text', 0)], truncated: true }),
    );
    try {
      expect((await read(token)).truncated).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a list the declared result refuses is an incident, not data', async () => {
    // Without this, every case above passes against a boundary that validates
    // nothing — an inert shim answers correctly for correct input, which is
    // this file's reassuring answer. The kind here is one a hostile document's
    // `/FT` could spell and the reader never answers, which is exactly the
    // string the closed union exists to stop.
    const { session, read, token, incidents } = await joined(() =>
      Promise.resolve({
        fields: [{ ...field('text', 0), kind: 'toggle' as ListedField['kind'] }],
        truncated: false,
      }),
    );
    try {
      await expect(read(token)).rejects.toThrow(/engine\/form-fields/u);
      expect(incidents).toHaveLength(1);
      expect(incidents[0]?.channel).toBe('engine/form-fields');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a session this host does not hold is a DECLARED miss', async () => {
    const { session, read, stranger, incidents } = await joined(() => {
      throw new Error('the miss is decided before the reader is reached');
    });
    try {
      // THE READER'S OWN SENTENCE, which `answered` raises for the declared
      // code — the channel is named in it, so this cannot pass on a different
      // channel's miss.
      await expect(read(stranger)).rejects.toThrow(
        /does not hold this session \(engine\/form-fields\)/u,
      );
      // A DECLARED CODE, not an incident: the supervisor acts on this one, and
      // it can only act on a code it is allowed to read.
      expect(incidents).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
