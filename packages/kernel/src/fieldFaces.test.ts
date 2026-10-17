import { PDFDocument as LibDocument } from '@cantoo/pdf-lib';
import type { CommandOfKind, FormFieldHandle, FormFieldProperties } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bundledFontsFolder } from './bundledFontsForTests.js';

import { bindEditFaces, bindEditFolders, loadEditFaces } from './editFaces.js';
import { readCatalogue } from './fontCatalogue.js';
import { FieldEditRefusedError } from './fieldEditRefusal.js';
import { readFieldProperties } from './formFieldRead.js';
import { applyFillFormField } from './formFields.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyPdfLibWithFaces } from './pdfLibFieldFaces.js';

/**
 * A form field in a real family ([ADR-0229](../../../docs/DECISIONS/0229-a-form-field-in-a-real-font-has-an-appearance-monstera-draws.md)),
 * against the real engine and the bundled fonts: the family is written by pdf-lib's edit, the value is drawn in it by
 * Monstera's appearance after that edit and after MuPDF's fill, and a reader reads the words back.
 *
 * ## The controls
 *
 * The same field edited with no family is drawn in Helvetica alone, and MuPDF's own fill of a marked field, without the
 * finishing step, is measured in the ADR to draw Helvetica too: so an appearance naming the embedded face is this
 * writer's and nobody else's.
 */

const VERSION = asDocVersion(1);
const HANDLE = (name: string, index: number): FormFieldHandle => ({ page: 0, index, name });

/** One page with a text field holding words, a dropdown with a choice made, and a tick box. */
async function form(): Promise<Uint8Array> {
  const document = await LibDocument.create();
  const page = document.addPage([400, 300]);
  const formOf = document.getForm();
  const name = formOf.createTextField('name');
  name.setText('Hello there');
  name.addToPage(page, { x: 50, y: 220, width: 250, height: 30 });
  const pick = formOf.createDropdown('pick');
  pick.addOptions(['One', 'Two']);
  pick.select('Two');
  pick.addToPage(page, { x: 50, y: 150, width: 250, height: 30 });
  const tick = formOf.createCheckBox('tick');
  tick.addToPage(page, { x: 50, y: 80, width: 20, height: 20 });
  return document.save();
}

function editing(handle: FormFieldHandle, set: FormFieldProperties): CommandOfKind<'editFormFields'> {
  return { kind: 'editFormFields', edits: [{ field: handle, set }], version: VERSION };
}

/** The fonts the widget's appearance names, by `/BaseFont`, and its content stream. */
async function appearanceOf(bytes: Uint8Array, index: number): Promise<{ fonts: string[]; content: string }> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const widget = document.loadPage(0).getWidgets()[index];
      if (widget === undefined) throw new Error(`no widget ${String(index)}`);
      const stream = widget.getObject().get('AP', 'N');
      const fonts: string[] = [];
      stream.get('Resources').get('Font').forEach((font) => {
        fonts.push(font.resolve().get('BaseFont').asName());
      });
      return { fonts, content: stream.readStream().asString() };
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** What MuPDF reads off the page, the widgets' appearances included. */
async function readText(bytes: Uint8Array): Promise<string> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => document.loadPage(0).toDisplayList(true).toStructuredText('preserve-whitespace').asText());
  } finally {
    await mupdfWriter.close(session);
  }
}

const isCarlito = (font: string): boolean => /^([A-Z]{6}\+)?Carlito/u.test(font);

describe('a form field in a real family (A8.4), with the bundled fonts bound', () => {
  beforeAll(async () => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogue);
    await loadEditFaces();
  });
  afterAll(() => {
    bindEditFaces(null);
  });

  it('an edit to Carlito draws the value in an embedded Carlito, keeps /DA standard, and reads back as Carlito', async () => {
    const bytes = await applyPdfLibWithFaces(await form(), editing(HANDLE('name', 0), { family: 'Carlito' }), undefined);
    const { fonts, content } = await appearanceOf(bytes, 0);
    expect(fonts.some(isCarlito)).toBe(true);
    expect(fonts).not.toContain('Helvetica');
    // THE BASE IS MUPDF'S, and the words are inside its variable-text section.
    expect(content.indexOf('/Tx BMC')).toBeLessThan(content.indexOf('Tf'));
    expect(content.trimEnd().endsWith('EMC')).toBe(true);
    expect(await readText(bytes)).toContain('Hello there');
    const session = await mupdfWriter.open(bytes);
    try {
      const [read] = await readFieldProperties(session, [HANDLE('name', 0)]);
      expect(read?.family).toBe('Carlito');
      // A READER THAT DRAWS THE FIELD ITSELF falls back to the standard face nearest Carlito's class.
      expect(read?.font).toBe('helvetica');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: the same edit with no family leaves the value in Helvetica, embedding nothing', async () => {
    const bytes = await applyPdfLibWithFaces(await form(), editing(HANDLE('name', 0), { fontSize: 14 }), undefined);
    const { fonts } = await appearanceOf(bytes, 0);
    expect(fonts.some(isCarlito)).toBe(false);
  });

  it('a fill of a marked field through MuPDF is drawn in the family again, with the new words', async () => {
    const marked = await applyPdfLibWithFaces(await form(), editing(HANDLE('name', 0), { family: 'Carlito' }), undefined);
    const session = await mupdfWriter.open(marked);
    let bytes: Uint8Array;
    try {
      await applyFillFormField(session, { kind: 'fillFormField', page: 0, index: 0, version: VERSION, value: { set: 'text', text: 'Filled later' } });
      bytes = await mupdfWriter.serialise(session);
    } finally {
      await mupdfWriter.close(session);
    }
    const { fonts } = await appearanceOf(bytes, 0);
    expect(fonts.some(isCarlito)).toBe(true);
    expect(fonts).not.toContain('Helvetica');
    expect(await readText(bytes)).toContain('Filled later');
  });

  it('a dropdown is drawn in the family, showing its chosen option', async () => {
    const bytes = await applyPdfLibWithFaces(await form(), editing(HANDLE('pick', 1), { family: 'Carlito' }), undefined);
    expect((await appearanceOf(bytes, 1)).fonts.some(isCarlito)).toBe(true);
    expect(await readText(bytes)).toContain('Two');
  });

  it('a family on a kind this appearance does not draw is refused, and a standard family is not', async () => {
    await expect(applyPdfLibWithFaces(await form(), editing(HANDLE('tick', 2), { family: 'Carlito' }), undefined)).rejects.toSatisfy(
      (error) => error instanceof FieldEditRefusedError && error.reason === 'family-kind',
    );
    await expect(applyPdfLibWithFaces(await form(), editing(HANDLE('tick', 2), { family: 'Times' }), undefined)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('taking the family away draws the field in its standard face again', async () => {
    const marked = await applyPdfLibWithFaces(await form(), editing(HANDLE('name', 0), { family: 'Carlito' }), undefined);
    const plain = await applyPdfLibWithFaces(marked, editing(HANDLE('name', 0), { family: null }), undefined);
    expect((await appearanceOf(plain, 0)).fonts.some(isCarlito)).toBe(false);
    const session = await mupdfWriter.open(plain);
    try {
      expect((await readFieldProperties(session, [HANDLE('name', 0)]))[0]?.family).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
