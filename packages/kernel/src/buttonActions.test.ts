import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { type ButtonAction, type CommandOfKind, type FieldActionTrigger, type FormFieldHandle, fieldActionSchema } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { chosenFormData, readFormData, serialiseFormData } from './formData.js';
import { applyEditFormFields } from './formFieldEdit.js';
import { readButtonActions } from './formFieldRead.js';
import { applyResetForm, applyShowHideFields, readFormFields } from './formFields.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter } from './mupdfWriter.js';
import type { MupdfSession } from './engineSeam.js';

/**
 * A push button's actions (ADR-0259), written by the editor and read back by a SECOND READER.
 *
 * pdf-lib writes them; PDF.js, which shares no code with either engine, reads what it reads of a widget's `/A` (its
 * `parseDestDictionary`: `GoTo`, `URI`, `GoToR`, `Named`, `ResetForm`); MuPDF's raw object model reads what PDF.js does
 * not — every `/Next` and every `/AA` trigger — straight from the dictionaries, never through this build's own reader.
 */

const VERSION = asDocVersion(1);

/** A form with two text fields, an empty push button `go`, and a push button `scripted` holding a script; three pages. */
async function buttonForm(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  document.addPage([400, 600]);
  document.addPage([400, 600]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const form = document.getForm();
  const name = form.createTextField('applicant.name');
  name.setText('Ada');
  name.addToPage(page, { x: 20, y: 540, width: 160, height: 20, font });
  name.acroField.dict.set(PDFName.of('DV'), PDFString.of('Your name'));
  const city = form.createTextField('applicant.city');
  city.setText('Paris');
  city.addToPage(page, { x: 20, y: 500, width: 160, height: 20, font });
  form.createButton('go').addToPage('Go', page, { x: 20, y: 400, width: 80, height: 20, font });
  const scripted = form.createButton('scripted');
  scripted.addToPage('Script', page, { x: 120, y: 400, width: 80, height: 20, font });
  const widget = scripted.acroField.getWidgets()[0]?.dict;
  widget?.set(PDFName.of('A'), document.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }));
  return document.save();
}

async function onSession<T>(bytes: Uint8Array, work: (session: MupdfSession) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

async function handleOf(bytes: Uint8Array, name: string): Promise<FormFieldHandle> {
  const { fields } = await onSession(bytes, (session) => readFormFields(session));
  const found = fields.find((field) => field.name === name);
  if (found === undefined) throw new Error(`the form has no field ${name}`);
  return { page: found.page, index: found.index, name };
}

async function written(bytes: Uint8Array, name: string, actions: readonly ButtonAction[]): Promise<Uint8Array> {
  const field = await handleOf(bytes, name);
  return applyEditFormFields(bytes, { kind: 'editFormFields', edits: [{ field, set: { buttonActions: actions } }], version: VERSION });
}

/**
 * What PDF.js makes of the named widget: its own annotation data, read from saved bytes, with `destinationPage` the
 * index PDF.js itself resolves an explicit destination's page reference to.
 */
async function pdfjsWidget(bytes: Uint8Array, name: string): Promise<Record<string, unknown>> {
  const entry = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = (await import(/* @vite-ignore */ pathToFileURL(entry).href)) as typeof import('pdfjs-dist');
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  try {
    const document = await task.promise;
    const annotations = (await (await document.getPage(1)).getAnnotations()) as Record<string, unknown>[];
    const found = annotations.find((each) => each['fieldName'] === name);
    if (found === undefined) throw new Error(`PDF.js reads no widget named ${name}`);
    const dest = found['dest'];
    const target: unknown = Array.isArray(dest) ? dest[0] : undefined;
    const isRef = typeof target === 'object' && target !== null && 'num' in target && 'gen' in target;
    return isRef ? { ...found, destinationPage: await document.getPageIndex(target as { num: number; gen: number }) } : found;
  } finally {
    await task.destroy();
  }
}

/** The `/S` of each action along one trigger's chain, read from MuPDF's raw objects: `/A` for up, `/AA /D` and so on. */
function chainRead(bytes: Uint8Array, name: string, trigger: FieldActionTrigger): { subtype: string; fields: string[] | null }[] {
  const pdf = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
  if (pdf === null) throw new Error('not a PDF');
  const page = pdf.loadPage(0);
  if (!(page instanceof mupdf.PDFPage)) throw new Error('not a PDF page');
  const widget = page.getWidgets().find((each) => each.getName() === name);
  if (widget === undefined) throw new Error(`MuPDF reads no widget named ${name}`);
  const key = { up: undefined, down: 'D', enter: 'E', exit: 'X' }[trigger];
  let at = key === undefined ? widget.getObject().get('A') : widget.getObject().get('AA', key);
  const chain: { subtype: string; fields: string[] | null }[] = [];
  while (at.isDictionary() && chain.length < 16) {
    const fields = at.get('Fields');
    chain.push({
      subtype: at.get('S').asName(),
      fields: fields.isArray() ? Array.from({ length: fields.length }, (_, index) => fields.get(index).asString()) : null,
    });
    at = at.get('Next');
  }
  return chain;
}

async function values(bytes: Uint8Array): Promise<Record<string, readonly string[]>> {
  const { fields } = await onSession(bytes, (session) => readFormFields(session));
  return Object.fromEntries(fields.filter((field) => field.kind === 'text').map((field) => [field.name, field.values]));
}

function resetStep(handle: FormFieldHandle, trigger: FieldActionTrigger, step: number): CommandOfKind<'resetForm'> {
  return { kind: 'resetForm', page: handle.page, index: handle.index, trigger, step, version: VERSION };
}

describe('Reset the form, as a push button action (ADR-0259)', () => {
  const NAME_ONLY: ButtonAction = { trigger: 'up', action: { kind: 'reset', fields: ['applicant.name'] } };
  const EVERY: ButtonAction = { trigger: 'up', action: { kind: 'reset', fields: null } };

  it('is written as /ResetForm, chained by /Next, and PDF.js reads the first as a reset of the field named', async () => {
    const bytes = await written(await buttonForm(), 'go', [NAME_ONLY, EVERY, { trigger: 'down', action: { kind: 'reset', fields: null } }]);
    const read = await pdfjsWidget(bytes, 'go');
    expect(read['resetForm']).toStrictEqual({ fields: ['applicant.name'], refs: [], include: true });
    expect(chainRead(bytes, 'go', 'up')).toStrictEqual([
      { subtype: 'ResetForm', fields: ['applicant.name'] },
      { subtype: 'ResetForm', fields: null },
    ]);
    expect(chainRead(bytes, 'go', 'down')).toStrictEqual([{ subtype: 'ResetForm', fields: null }]);
    // CONTROL: the button with nothing written reads as nothing to both readers.
    expect((await pdfjsWidget(await buttonForm(), 'go'))['resetForm']).toBeUndefined();
    expect(chainRead(await buttonForm(), 'go', 'up')).toStrictEqual([]);
  });

  it('reads back as written, and the listing names the triggers that run', async () => {
    const actions = [NAME_ONLY, EVERY, { trigger: 'exit', action: { kind: 'reset', fields: null } }] as const;
    const bytes = await written(await buttonForm(), 'go', actions);
    const handle = await handleOf(bytes, 'go');
    const steps = await onSession(bytes, (session) => readButtonActions(session, handle));
    expect(steps).toStrictEqual([
      { trigger: 'up', step: 0, action: NAME_ONLY.action },
      { trigger: 'up', step: 1, action: EVERY.action },
      { trigger: 'exit', step: 0, action: { kind: 'reset', fields: null } },
    ]);
    const { fields } = await onSession(bytes, (session) => readFormFields(session));
    expect(fields.find((field) => field.name === 'go')?.actions).toStrictEqual({ runs: ['up', 'exit'], kept: [] });
  });

  it('runs each step on its own: step 0 resets the field it names, step 1 every field', async () => {
    const bytes = await written(await buttonForm(), 'go', [NAME_ONLY, EVERY]);
    const handle = await handleOf(bytes, 'go');
    expect(await values(bytes)).toStrictEqual({ 'applicant.name': ['Ada'], 'applicant.city': ['Paris'] });
    const first = await onSession(bytes, async (session) => {
      await applyResetForm(session, resetStep(handle, 'up', 0));
      return mupdfWriter.serialise(session);
    });
    expect(await values(first)).toStrictEqual({ 'applicant.name': ['Your name'], 'applicant.city': ['Paris'] });
    const second = await onSession(bytes, async (session) => {
      await applyResetForm(session, resetStep(handle, 'up', 1));
      return mupdfWriter.serialise(session);
    });
    expect(await values(second)).toStrictEqual({ 'applicant.name': ['Your name'], 'applicant.city': [] });
  });

  it('CONTROL: a step that is not there, or a script, is refused and nothing moves', async () => {
    const bytes = await written(await buttonForm(), 'go', [NAME_ONLY]);
    const go = await handleOf(bytes, 'go');
    const scripted = await handleOf(bytes, 'scripted');
    const after = await onSession(bytes, async (session) => {
      await expect(applyResetForm(session, resetStep(go, 'up', 1))).rejects.toThrow('is not a Reset form action');
      await expect(applyResetForm(session, resetStep(scripted, 'up', 0))).rejects.toThrow('is not a Reset form action');
      return mupdfWriter.serialise(session);
    });
    expect(await values(after)).toStrictEqual({ 'applicant.name': ['Ada'], 'applicant.city': ['Paris'] });
  });

  it('a button holding a script is listed kept, never run, and an edit over it is refused with the script left in place', async () => {
    const bytes = await buttonForm();
    const handle = await handleOf(bytes, 'scripted');
    expect(await onSession(bytes, (session) => readButtonActions(session, handle))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'kept', subtype: 'JavaScript', runsAs: null } },
    ]);
    const { fields } = await onSession(bytes, (session) => readFormFields(session));
    expect(fields.find((field) => field.name === 'scripted')?.actions).toStrictEqual({ runs: [], kept: ['up'] });
    await expect(written(bytes, 'scripted', [EVERY])).rejects.toThrow('kept as it is');
    expect(chainRead(bytes, 'scripted', 'up')).toStrictEqual([{ subtype: 'JavaScript', fields: null }]);
  });

  it('an empty list takes every trigger away and leaves the rest of /AA as it was', async () => {
    const source = await PDFDocument.load(await written(await buttonForm(), 'go', [EVERY, { trigger: 'enter', action: { kind: 'reset', fields: null } }]));
    const aa = source.getForm().getButton('go').acroField.getWidgets()[0]?.dict.lookup(PDFName.of('AA'));
    if (!(aa instanceof PDFDict)) throw new Error('the written button has no /AA');
    expect(aa.has(PDFName.of('E'))).toBe(true);
    // A FOCUS ACTION another tool wrote, which no trigger here names.
    aa.set(PDFName.of('Fo'), source.context.obj({ S: 'ResetForm' }));
    const cleared = await written(await source.save(), 'go', []);
    expect(chainRead(cleared, 'go', 'up')).toStrictEqual([]);
    expect(chainRead(cleared, 'go', 'enter')).toStrictEqual([]);
    const left = (await PDFDocument.load(cleared)).getForm().getButton('go').acroField.getWidgets()[0]?.dict.lookup(PDFName.of('AA'));
    expect(left instanceof PDFDict ? left.keys().map((key) => key.decodeText()) : []).toStrictEqual(['Fo']);
  });
});

/** A button's `/A` set by hand, as another tool wrote it: what this build must read, and keep. */
async function withAction(bytes: Uint8Array, name: string, action: (document: PDFDocument) => PDFDict): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes);
  document.getForm().getButton(name).acroField.getWidgets()[0]?.dict.set(PDFName.of('A'), action(document));
  return document.save();
}

describe('Go to a page, as a push button action (ADR-0259)', () => {
  it('is written as /GoTo to the page by its reference, and PDF.js resolves it to that page and that fit', async () => {
    const bytes = await written(await buttonForm(), 'go', [{ trigger: 'up', action: { kind: 'goTo', page: 2, view: 'fit', at: null } }]);
    const read = await pdfjsWidget(bytes, 'go');
    expect(read['destinationPage']).toBe(2);
    expect((read['dest'] as unknown[])[1]).toStrictEqual({ name: 'Fit' });
    // CONTROL: the same button written to page 1 resolves to page 1, so the page is read, not assumed.
    const other = await written(await buttonForm(), 'go', [{ trigger: 'up', action: { kind: 'goTo', page: 1, view: 'fit-width', at: null } }]);
    expect((await pdfjsWidget(other, 'go'))['destinationPage']).toBe(1);
    expect(((await pdfjsWidget(other, 'go'))['dest'] as unknown[])[1]).toStrictEqual({ name: 'FitH' });
  });

  it('reads back each view as written, on every trigger', async () => {
    const actions: ButtonAction[] = [
      { trigger: 'up', action: { kind: 'goTo', page: 2, view: 'fit', at: null } },
      { trigger: 'down', action: { kind: 'goTo', page: 1, view: 'keep', at: null } },
      { trigger: 'enter', action: { kind: 'goTo', page: 0, view: 'fit-width', at: { left: null, top: 500, zoom: null } } },
    ];
    const bytes = await written(await buttonForm(), 'go', actions);
    const handle = await handleOf(bytes, 'go');
    expect(await onSession(bytes, (session) => readButtonActions(session, handle))).toStrictEqual(
      actions.map((each) => ({ trigger: each.trigger, step: 0, action: each.action })),
    );
  });

  it('keeps the place and zoom another tool wrote, through a read and an edit that changes another action', async () => {
    const otherTool = await withAction(await buttonForm(), 'go', (document) => {
      const page = document.getPages()[1];
      if (page === undefined) throw new Error('no page 2');
      return document.context.obj({ S: 'GoTo', D: [page.ref, 'XYZ', 36, 700, 1.5] });
    });
    const handle = await handleOf(otherTool, 'go');
    const [read] = (await onSession(otherTool, (session) => readButtonActions(session, handle))) ?? [];
    const goTo = { kind: 'goTo', page: 1, view: 'keep', at: { left: 36, top: 700, zoom: 1.5 } } as const;
    expect(read).toStrictEqual({ trigger: 'up', step: 0, action: goTo });
    // AN EDIT ADDING A RESET AFTER IT writes the go-to back with its numbers.
    const again = await written(otherTool, 'go', [{ trigger: 'up', action: goTo }, { trigger: 'up', action: { kind: 'reset', fields: null } }]);
    expect((await pdfjsWidget(again, 'go'))['dest']).toMatchObject([{}, { name: 'XYZ' }, 36, 700, 1.5]);
  });

  it('CONTROL: a named destination is kept and never run, and a page the document does not have is refused', async () => {
    const named = await withAction(await buttonForm(), 'go', (document) => document.context.obj({ S: 'GoTo', D: PDFString.of('chapter-2') }));
    const handle = await handleOf(named, 'go');
    expect(await onSession(named, (session) => readButtonActions(session, handle))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'kept', subtype: 'GoTo', runsAs: null } },
    ]);
    await expect(written(await buttonForm(), 'go', [{ trigger: 'up', action: { kind: 'goTo', page: 3, view: 'fit', at: null } }])).rejects.toThrow(
      'no page 4',
    );
  });
});

describe('Open a web link, as a push button action (ADR-0259)', () => {
  it('is written as /URI, and PDF.js reads the address as the widget’s url', async () => {
    const address = 'https://example.org/apply?step=2';
    const bytes = await written(await buttonForm(), 'go', [{ trigger: 'up', action: { kind: 'link', address } }]);
    expect((await pdfjsWidget(bytes, 'go'))['url']).toBe(address);
    const handle = await handleOf(bytes, 'go');
    expect(await onSession(bytes, (session) => readButtonActions(session, handle))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'link', address } },
    ]);
    // CONTROL: the empty button carries no url to PDF.js, so the address above is the one written.
    expect((await pdfjsWidget(await buttonForm(), 'go'))['url']).toBeUndefined();
  });

  it('writes an address that is not ASCII in the URL parser’s own encoding, as /URI must be', async () => {
    const bytes = await written(await buttonForm(), 'go', [{ trigger: 'up', action: { kind: 'link', address: 'https://example.org/café' } }]);
    expect((await pdfjsWidget(bytes, 'go'))['url']).toBe('https://example.org/caf%C3%A9');
  });

  it('CONTROL: a /URI whose scheme a person may not follow is kept and never run', async () => {
    const forged = await withAction(await buttonForm(), 'go', (document) =>
      document.context.obj({ S: 'URI', URI: PDFString.of('javascript:app.alert(1)') }),
    );
    const handle = await handleOf(forged, 'go');
    expect(await onSession(forged, (session) => readButtonActions(session, handle))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'kept', subtype: 'URI', runsAs: null } },
    ]);
  });
});

describe('Print the document, as a push button action (ADR-0259)', () => {
  it('is written as /Named /Print, and PDF.js reads it as the named action Print', async () => {
    const bytes = await written(await buttonForm(), 'go', [{ trigger: 'up', action: { kind: 'print' } }]);
    expect((await pdfjsWidget(bytes, 'go'))['action']).toBe('Print');
    const handle = await handleOf(bytes, 'go');
    expect(await onSession(bytes, (session) => readButtonActions(session, handle))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'print' } },
    ]);
    // CONTROL: the empty button names no action to PDF.js.
    expect((await pdfjsWidget(await buttonForm(), 'go'))['action']).toBeUndefined();
  });

  it('CONTROL: a page move by name is the reader’s own navigation, and is kept and never run', async () => {
    const next = await withAction(await buttonForm(), 'go', (document) => document.context.obj({ S: 'Named', N: 'NextPage' }));
    const handle = await handleOf(next, 'go');
    expect(await onSession(next, (session) => readButtonActions(session, handle))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'kept', subtype: 'Named', runsAs: null } },
    ]);
  });
});

describe('Show or hide fields, as a push button action (ADR-0259)', () => {
  /** `/T` and `/H` of the widget's `/A`, read from MuPDF's raw objects. */
  function hideRead(bytes: Uint8Array, name: string): { subtype: string; targets: string[]; hide: boolean } {
    const pdf = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
    if (pdf === null) throw new Error('not a PDF');
    const page = pdf.loadPage(0);
    if (!(page instanceof mupdf.PDFPage)) throw new Error('not a PDF page');
    const widget = page.getWidgets().find((each) => each.getName() === name);
    if (widget === undefined) throw new Error(`MuPDF reads no widget named ${name}`);
    const action = widget.getObject().get('A');
    const targets = action.get('T');
    return {
      subtype: action.get('S').asName(),
      targets: Array.from({ length: targets.length }, (_, at) => targets.get(at).asString()),
      hide: action.get('H').asBoolean(),
    };
  }

  /** Each text field's Hidden flag as the listing reports it. */
  async function hiddenOf(bytes: Uint8Array): Promise<Record<string, boolean>> {
    const { fields } = await onSession(bytes, (session) => readFormFields(session));
    return Object.fromEntries(fields.filter((field) => field.kind === 'text').map((field) => [field.name, field.hidden === true]));
  }

  async function pressed(bytes: Uint8Array, trigger: FieldActionTrigger, step: number): Promise<Uint8Array> {
    const handle = await handleOf(bytes, 'go');
    return onSession(bytes, async (session) => {
      await applyShowHideFields(session, { kind: 'showHideFields', page: handle.page, index: handle.index, trigger, step, version: VERSION });
      return mupdfWriter.serialise(session);
    });
  }

  it('is written as /Hide naming the fields in /T with /H, and reads back as written', async () => {
    const bytes = await written(await buttonForm(), 'go', [
      { trigger: 'up', action: { kind: 'showHide', fields: ['applicant.city'], hide: true } },
      { trigger: 'up', action: { kind: 'showHide', fields: ['applicant.name', 'applicant.city'], hide: false } },
    ]);
    expect(hideRead(bytes, 'go')).toStrictEqual({ subtype: 'Hide', targets: ['applicant.city'], hide: true });
    expect(chainRead(bytes, 'go', 'up').map((each) => each.subtype)).toStrictEqual(['Hide', 'Hide']);
    const handle = await handleOf(bytes, 'go');
    expect(await onSession(bytes, (session) => readButtonActions(session, handle))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'showHide', fields: ['applicant.city'], hide: true } },
      { trigger: 'up', step: 1, action: { kind: 'showHide', fields: ['applicant.name', 'applicant.city'], hide: false } },
    ]);
  });

  it('a press hides the field named and no other, and the next step shows it again', async () => {
    const bytes = await written(await buttonForm(), 'go', [
      { trigger: 'up', action: { kind: 'showHide', fields: ['applicant.city'], hide: true } },
      { trigger: 'up', action: { kind: 'showHide', fields: ['applicant'], hide: false } },
    ]);
    expect(await hiddenOf(bytes)).toStrictEqual({ 'applicant.name': false, 'applicant.city': false });
    const hidden = await pressed(bytes, 'up', 0);
    // CONTROL: the field not named stays shown, so the hide read its names rather than hiding every field.
    expect(await hiddenOf(hidden)).toStrictEqual({ 'applicant.name': false, 'applicant.city': true });
    // A PARENT'S NAME names its kids: `applicant` shows both again.
    expect(await hiddenOf(await pressed(hidden, 'up', 1))).toStrictEqual({ 'applicant.name': false, 'applicant.city': false });
  });

  it('CONTROL: a step that is not a show or hide is refused, and a /T naming no field is kept and never run', async () => {
    const reset = await written(await buttonForm(), 'go', [{ trigger: 'up', action: { kind: 'reset', fields: null } }]);
    await expect(pressed(reset, 'up', 0)).rejects.toThrow('is not a Show or hide action');
    const annotation = await withAction(await buttonForm(), 'go', (document) =>
      document.context.obj({ S: 'Hide', T: document.context.obj({ Type: 'Annot', Subtype: 'Square' }) }),
    );
    const handle = await handleOf(annotation, 'go');
    expect(await onSession(annotation, (session) => readButtonActions(session, handle))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'kept', subtype: 'Hide', runsAs: null } },
    ]);
    await expect(pressed(annotation, 'up', 0)).rejects.toThrow('is not a Show or hide action');
  });
});

describe('Submit the form, as a push button action (ADR-0259)', () => {
  /** The widget's `/A` as MuPDF's raw objects hold it: `/S`, the URL file specification, `/Flags` and `/Fields`. */
  function submitRead(bytes: Uint8Array, name: string): Record<string, unknown> {
    const pdf = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
    if (pdf === null) throw new Error('not a PDF');
    const page = pdf.loadPage(0);
    if (!(page instanceof mupdf.PDFPage)) throw new Error('not a PDF page');
    const widget = page.getWidgets().find((each) => each.getName() === name);
    if (widget === undefined) throw new Error(`MuPDF reads no widget named ${name}`);
    const action = widget.getObject().get('A');
    const fields = action.get('Fields');
    return {
      subtype: action.get('S').asName(),
      fs: action.get('F', 'FS').asName(),
      url: action.get('F', 'F').asString(),
      flags: action.get('Flags').asNumber(),
      fields: Array.from({ length: fields.length }, (_, at) => fields.get(at).asString()),
    };
  }

  it('is written as /SubmitForm to a URL file specification, each format by its flag, and reads back as written', async () => {
    const flags = { fdf: 0, html: 4, xfdf: 32 } as const;
    for (const format of ['fdf', 'html', 'xfdf'] as const) {
      const action = { kind: 'submit', address: 'https://forms.example/take', format, fields: ['applicant.city'] } as const;
      const bytes = await written(await buttonForm(), 'go', [{ trigger: 'up', action }]);
      expect(submitRead(bytes, 'go')).toStrictEqual({
        subtype: 'SubmitForm',
        fs: 'URL',
        url: 'https://forms.example/take',
        flags: flags[format],
        fields: ['applicant.city'],
      });
      const handle = await handleOf(bytes, 'go');
      expect(await onSession(bytes, (session) => readButtonActions(session, handle))).toStrictEqual([{ trigger: 'up', step: 0, action }]);
    }
  });

  it('the WHOLE DOCUMENT is written as bit 9 with no /Fields, and reads back as itself (ADR-0263)', async () => {
    const action = { kind: 'submit', address: 'https://forms.example/take', format: 'pdf', fields: null } as const;
    const bytes = await written(await buttonForm(), 'go', [{ trigger: 'up', action }]);
    expect(submitRead(bytes, 'go')).toStrictEqual({ subtype: 'SubmitForm', fs: 'URL', url: 'https://forms.example/take', flags: 256, fields: [] });
    const handle = await handleOf(bytes, 'go');
    expect(await onSession(bytes, (session) => readButtonActions(session, handle))).toStrictEqual([{ trigger: 'up', step: 0, action }]);

    // A DOCUMENT'S OWN bit 9 BESIDE A FIELD LIST reads as the whole document naming none: the standard ignores the list.
    const forged = await withAction(await buttonForm(), 'go', (document) =>
      document.context.obj({
        S: 'SubmitForm',
        F: document.context.obj({ FS: 'URL', F: PDFString.of('https://forms.example/take') }),
        Flags: 1 << 8,
        Fields: [PDFHexString.fromText('applicant.city')],
      }),
    );
    expect(await onSession(forged, async (session) => readButtonActions(session, await handleOf(forged, 'go')))).toStrictEqual([
      { trigger: 'up', step: 0, action },
    ]);
    // CONTROL: the contract holds a whole-document submission to no fields, so an edit cannot write a list beside it.
    expect(fieldActionSchema.safeParse({ ...action, fields: ['applicant.city'] }).success).toBe(false);
  });

  it('encodes the fields named, and only those, as HTML form data, FDF and XFDF', async () => {
    const bytes = await buttonForm();
    const [chosen, every] = await onSession(bytes, async (session) => {
      const fields = await readFormData(session);
      return [chosenFormData(fields, ['applicant.city']), chosenFormData(fields, undefined)] as const;
    });
    const text = (format: 'html' | 'fdf' | 'xfdf'): string => new TextDecoder().decode(serialiseFormData(chosen, format));
    expect(text('html')).toBe('applicant.city=Paris');
    expect(text('xfdf')).toContain('<field name="applicant.city"><value>Paris</value></field>');
    expect(text('fdf')).toContain('/T (applicant.city) /V (Paris)');
    // CONTROL: every field is sent where the action names none, so the one above is the choice and not the form.
    expect(new TextDecoder().decode(serialiseFormData(every, 'html'))).toBe('applicant.name=Ada&applicant.city=Paris');
    // A PARENT'S NAME takes its kids, by the reset's rule.
    expect(chosenFormData(every, ['applicant']).map((field) => field.name)).toStrictEqual(['applicant.name', 'applicant.city']);
  });

  it('CONTROL: a submission this build does not carry out as written is kept and never run', async () => {
    const shapes: readonly [string, number][] = [
      ['a GET', 1 << 3],
      // THE WHOLE DOCUMENT BESIDE ANOTHER FORMAT: bit 9 alone runs since ADR-0263 (the case below), so the row that
      // read `1 << 8` here asserts a shape that is still kept rather than one this build now carries out.
      ['the whole document and web form data at once', (1 << 8) | (1 << 2)],
      ['every field but those', 1],
      ['two formats at once', (1 << 2) | (1 << 5)],
    ];
    for (const [what, flags] of shapes) {
      const forged = await withAction(await buttonForm(), 'go', (document) =>
        document.context.obj({ S: 'SubmitForm', F: document.context.obj({ FS: 'URL', F: PDFString.of('https://forms.example/take') }), Flags: flags }),
      );
      const handle = await handleOf(forged, 'go');
      expect(await onSession(forged, (session) => readButtonActions(session, handle)), what).toStrictEqual([
        { trigger: 'up', step: 0, action: { kind: 'kept', subtype: 'SubmitForm', runsAs: null } },
      ]);
    }
    // And an address that is neither https: nor mailto:, beside the same shape at https: that is this build's own.
    const plain = await withAction(await buttonForm(), 'go', (document) =>
      document.context.obj({ S: 'SubmitForm', F: document.context.obj({ FS: 'URL', F: PDFString.of('http://forms.example/take') }) }),
    );
    expect(await onSession(plain, async (session) => readButtonActions(session, await handleOf(plain, 'go')))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'kept', subtype: 'SubmitForm', runsAs: null } },
    ]);
    const secure = await withAction(await buttonForm(), 'go', (document) =>
      document.context.obj({ S: 'SubmitForm', F: document.context.obj({ FS: 'URL', F: PDFString.of('https://forms.example/take') }) }),
    );
    expect(await onSession(secure, async (session) => readButtonActions(session, await handleOf(secure, 'go')))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'submit', address: 'https://forms.example/take', format: 'fdf', fields: null } },
    ]);
  });
});

describe('Open a file, as a push button action (ADR-0259)', () => {
  it('is written as /GoToR to the first page of the file, whole, in a new window, and PDF.js reads it so', async () => {
    const bytes = await written(await buttonForm(), 'go', [{ trigger: 'up', action: { kind: 'openFile', file: 'guide.pdf' } }]);
    const read = await pdfjsWidget(bytes, 'go');
    // `unsafeUrl` IS PDF.js's READING of `/F` and `/D` (its `parseDestDictionary`, case `GoToR`): the file, then the remote
    // destination as JSON. `url` is that resolved against a base, which a document read from bytes has none of.
    expect({ target: read['unsafeUrl'], newWindow: read['newWindow'] }).toStrictEqual({ target: 'guide.pdf#[0,{"name":"Fit"}]', newWindow: true });
    const handle = await handleOf(bytes, 'go');
    expect(await onSession(bytes, (session) => readButtonActions(session, handle))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'openFile', file: 'guide.pdf' } },
    ]);
  });

  it('CONTROL: another page, a path, or a file that is not a PDF is kept and never run, beside a bare PDF that is run', async () => {
    const shapes: readonly [string, (document: PDFDocument) => PDFDict][] = [
      ['another page', (document) => document.context.obj({ S: 'GoToR', F: PDFString.of('guide.pdf'), D: [2, 'Fit'] })],
      // `/` IS A FILE SPECIFICATION'S SEPARATOR (ISO 32000-1, 7.11.2): a backslash in a literal string is an escape, so a
      // document spelling one names a single file whose name lost it.
      ['a path', (document) => document.context.obj({ S: 'GoToR', F: PDFString.of('../private/guide.pdf'), D: [0, 'Fit'] })],
      ['not a PDF', (document) => document.context.obj({ S: 'GoToR', F: PDFString.of('setup.exe'), D: [0, 'Fit'] })],
    ];
    for (const [what, shape] of shapes) {
      const forged = await withAction(await buttonForm(), 'go', shape);
      expect(await onSession(forged, async (session) => readButtonActions(session, await handleOf(forged, 'go'))), what).toStrictEqual([
        { trigger: 'up', step: 0, action: { kind: 'kept', subtype: 'GoToR', runsAs: null } },
      ]);
    }
    const bare = await withAction(await buttonForm(), 'go', (document) => document.context.obj({ S: 'GoToR', F: PDFString.of('Guide.PDF') }));
    expect(await onSession(bare, async (session) => readButtonActions(session, await handleOf(bare, 'go')))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'openFile', file: 'Guide.PDF' } },
    ]);
  });
});

describe('Import form data, as a push button action (ADR-0259)', () => {
  /** `/F` of the widget's `/A`, read from MuPDF's raw objects: the file specification's `/F` and `/UF`. */
  function fileRead(bytes: Uint8Array, name: string): { subtype: string; f: string; uf: string } {
    const pdf = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
    if (pdf === null) throw new Error('not a PDF');
    const page = pdf.loadPage(0);
    if (!(page instanceof mupdf.PDFPage)) throw new Error('not a PDF page');
    const widget = page.getWidgets().find((each) => each.getName() === name);
    if (widget === undefined) throw new Error(`MuPDF reads no widget named ${name}`);
    const action = widget.getObject().get('A');
    return { subtype: action.get('S').asName(), f: action.get('F', 'F').asString(), uf: action.get('F', 'UF').asString() };
  }

  it('is written as /ImportData naming the file in /F and /UF, and reads back as written', async () => {
    const bytes = await written(await buttonForm(), 'go', [{ trigger: 'up', action: { kind: 'importData', file: 'réponses.fdf' } }]);
    expect(fileRead(bytes, 'go')).toStrictEqual({ subtype: 'ImportData', f: 'réponses.fdf', uf: 'réponses.fdf' });
    const handle = await handleOf(bytes, 'go');
    expect(await onSession(bytes, (session) => readButtonActions(session, handle))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'importData', file: 'réponses.fdf' } },
    ]);
  });

  it('CONTROL: a file named by a path is kept, and still runs as an import the person picks for', async () => {
    const elsewhere = await withAction(await buttonForm(), 'go', (document) =>
      document.context.obj({ S: 'ImportData', F: PDFString.of('C:\\Users\\someone\\answers.fdf') }),
    );
    const handle = await handleOf(elsewhere, 'go');
    expect(await onSession(elsewhere, (session) => readButtonActions(session, handle))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'kept', subtype: 'ImportData', runsAs: 'importData' } },
    ]);
    // The positive side of the same reading: a bare name is this build's own, so the kept answer above is the path's.
    const named = await withAction(await buttonForm(), 'go', (document) => document.context.obj({ S: 'ImportData', F: PDFString.of('answers.fdf') }));
    expect(await onSession(named, async (session) => readButtonActions(session, await handleOf(named, 'go')))).toStrictEqual([
      { trigger: 'up', step: 0, action: { kind: 'importData', file: 'answers.fdf' } },
    ]);
  });
});
