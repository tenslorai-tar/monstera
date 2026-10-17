import { PDFDocument as LibDocument } from '@cantoo/pdf-lib';
import type { CommandOfKind, FormFieldHandle, FormFieldProperties } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bundledFontsFolder } from './bundledFontsForTests.js';

import { bindEditFaces, bindEditFolders, loadEditFaces } from './editFaces.js';
import { readCatalogue } from './fontCatalogue.js';
import { FieldEditRefusedError } from './fieldEditRefusal.js';
import { borderOps, checkOps, opsText } from './fieldMarks.js';
import { readFieldProperties } from './formFieldRead.js';
import { applyFillFormField, readFormFields } from './formFields.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyPdfLibWithFaces } from './pdfLibFieldFaces.js';

/**
 * A field's border style, check style and number range
 * ([ADR-0230](../../../docs/DECISIONS/0230-a-fields-border-style-and-check-style-are-drawn-by-monstera.md)), against the real
 * engine: written as the format defines them, drawn by Monstera, kept by MuPDF's own redraw at a fill, and read back.
 *
 * ## The controls
 *
 * Neither engine draws a style (measured in the ADR): MuPDF ignores `/BS /S`, and pdf-lib draws one solid border and one
 * check. So a dash operator or a mark's own shape in an appearance is this writer's and nobody else's, and each case
 * asserts the same field with no style drawn WITHOUT it first, so a reader that found the shape everywhere fails there.
 */

const VERSION = asDocVersion(1);
const HANDLE = (name: string, index: number): FormFieldHandle => ({ page: 0, index, name });
const DASH = '[3] 0 d';
const BLACK = [0, 0, 0];
/** The boxes as pdf-lib saves them, one point wider and taller than asked (read off the saved `/Rect`, 2026-10-12). */
const TEXT_BOX = [251, 31] as const;
const BUTTON = 21;

/** A text field, a tick box, a radio group of two and a list box, each with pdf-lib's black border. */
async function form(): Promise<Uint8Array> {
  const document = await LibDocument.create();
  const page = document.addPage([400, 400]);
  const formOf = document.getForm();
  const name = formOf.createTextField('name');
  name.setText('Hello there');
  name.addToPage(page, { x: 50, y: 320, width: 250, height: 30 });
  const tick = formOf.createCheckBox('tick');
  tick.addToPage(page, { x: 50, y: 260, width: 20, height: 20 });
  tick.check();
  const plan = formOf.createRadioGroup('plan');
  plan.addOptionToPage('a', page, { x: 50, y: 200, width: 20, height: 20 });
  plan.addOptionToPage('b', page, { x: 100, y: 200, width: 20, height: 20 });
  plan.select('a');
  const list = formOf.createOptionList('list');
  list.addOptions(['One', 'Two']);
  list.addToPage(page, { x: 50, y: 80, width: 150, height: 60 });
  return document.save();
}

function editing(handle: FormFieldHandle, set: FormFieldProperties): CommandOfKind<'editFormFields'> {
  return { kind: 'editFormFields', edits: [{ field: handle, set }], version: VERSION };
}

/** Each appearance state of widget `index`, by state name; a text field's one stream is under `N`. */
async function appearances(bytes: Uint8Array, index: number): Promise<Record<string, string>> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const widget = document.loadPage(0).getWidgets()[index];
      if (widget === undefined) throw new Error(`no widget ${String(index)}`);
      const normal = widget.getObject().get('AP', 'N');
      if (normal.isStream()) return { N: normal.readStream().asString() };
      const states: Record<string, string> = {};
      normal.forEach((stream, key) => {
        states[String(key)] = stream.readStream().asString();
      });
      return states;
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

async function readOne(bytes: Uint8Array, handle: FormFieldHandle): Promise<NonNullable<Awaited<ReturnType<typeof readFieldProperties>>[number]>> {
  const session = await mupdfWriter.open(bytes);
  try {
    const [one] = await readFieldProperties(session, [handle]);
    if (one === null || one === undefined) throw new Error(`${handle.name} did not read`);
    return one;
  } finally {
    await mupdfWriter.close(session);
  }
}

/** `content` with each number to three places, as `opsText` writes it: pdf-lib writes a computed point in full. */
const rounded = (content: string): string => content.replace(/-?\d+\.\d+/gu, (number) => opsText([{ op: '', args: [Number(number)] }]).trim());

const isRefused = (reason: string) => (error: unknown) => error instanceof FieldEditRefusedError && error.reason === reason;

describe('a field’s border style, check style and number range (A3.1)', () => {
  beforeAll(async () => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogue);
    await loadEditFaces();
  });
  afterAll(() => {
    bindEditFaces(null);
  });

  it('a dashed text field is drawn dashed around its words, and reads back dashed', async () => {
    const plain = await appearances(await form(), 0);
    // CONTROL: the untouched field carries no dash, so the dash below is the style's.
    expect(plain['N']).not.toContain(DASH);
    const bytes = await applyPdfLibWithFaces(await form(), editing(HANDLE('name', 0), { borderStyle: 'dashed' }), undefined);
    const { N: content = '' } = await appearances(bytes, 0);
    expect(content).toContain(DASH);
    expect(content).toContain('(Hello) Tj');
    expect((await readOne(bytes, HANDLE('name', 0))).borderStyle).toBe('dashed');
  });

  it('a fill through MuPDF, which ignores the style, draws the border dashed again with the new words', async () => {
    const dashed = await applyPdfLibWithFaces(await form(), editing(HANDLE('name', 0), { borderStyle: 'dashed' }), undefined);
    const session = await mupdfWriter.open(dashed);
    let bytes: Uint8Array;
    try {
      await applyFillFormField(session, { kind: 'fillFormField', page: 0, index: 0, version: VERSION, value: { set: 'text', text: 'Filled later' } });
      bytes = await mupdfWriter.serialise(session);
    } finally {
      await mupdfWriter.close(session);
    }
    const { N: content = '' } = await appearances(bytes, 0);
    expect(content).toContain(DASH);
    expect(content).toContain('(Filled) Tj');
  });

  it('an underline is a line along the foot and no frame, and solid again draws the frame with no dash', async () => {
    const underlined = await applyPdfLibWithFaces(await form(), editing(HANDLE('name', 0), { borderStyle: 'underline' }), undefined);
    const { N: under = '' } = await appearances(underlined, 0);
    expect(under).toContain(opsText(borderOps('underline', ...TEXT_BOX, 1, BLACK)));
    expect(under).not.toContain(opsText(borderOps('solid', ...TEXT_BOX, 1, BLACK)));
    const solid = await applyPdfLibWithFaces(underlined, editing(HANDLE('name', 0), { borderStyle: 'solid' }), undefined);
    expect((await appearances(solid, 0))['N']).not.toContain(DASH);
    expect((await readOne(solid, HANDLE('name', 0))).borderStyle).toBe('solid');
  });

  it('a tick box’s cross is drawn in its on state alone, and reads back as a cross', async () => {
    const cross = opsText(checkOps('cross', BUTTON, BUTTON, BLACK));
    // CONTROL: pdf-lib's own tick box draws no cross.
    expect(Object.values(await appearances(await form(), 1)).some((each) => each.includes(cross))).toBe(false);
    const bytes = await applyPdfLibWithFaces(await form(), editing(HANDLE('tick', 1), { checkStyle: 'cross' }), undefined);
    const states = await appearances(bytes, 1);
    expect(states['Off']).toBeDefined();
    expect(states['Off']).not.toContain(cross);
    expect(Object.entries(states).some(([state, content]) => state !== 'Off' && content.includes(cross))).toBe(true);
    expect((await readOne(bytes, HANDLE('tick', 1))).checkStyle).toBe('cross');
  });

  it('a radio group’s star is written on every option, and an untouched radio reads as a circle', async () => {
    const star = opsText(checkOps('star', BUTTON, BUTTON, BLACK));
    expect((await readOne(await form(), HANDLE('plan', 2))).checkStyle).toBe('circle');
    // CONTROL: pdf-lib's own radio draws no star.
    expect(Object.values(await appearances(await form(), 2)).some((each) => rounded(each).includes(star))).toBe(false);
    const bytes = await applyPdfLibWithFaces(await form(), editing(HANDLE('plan', 2), { checkStyle: 'star' }), undefined);
    for (const index of [2, 3]) {
      expect(Object.values(await appearances(bytes, index)).some((each) => rounded(each).includes(star))).toBe(true);
      expect((await readOne(bytes, HANDLE('plan', index))).checkStyle).toBe('star');
    }
  });

  it('a range is written as the script Acrobat runs, listed for the fill check, and taken away with null', async () => {
    const bytes = await applyPdfLibWithFaces(await form(), editing(HANDLE('name', 0), { validation: { min: 1, max: null } }), undefined);
    const read = await readOne(bytes, HANDLE('name', 0));
    expect(read.validation).toStrictEqual({ min: 1, max: null });
    expect(read.customValidation).toBe(false);
    const session = await mupdfWriter.open(bytes);
    try {
      const { fields } = await readFormFields(session);
      expect(fields.find((field) => field.name === 'name')?.range).toStrictEqual({ min: 1, max: null });
    } finally {
      await mupdfWriter.close(session);
    }
    const cleared = await applyPdfLibWithFaces(bytes, editing(HANDLE('name', 0), { validation: null }), undefined);
    expect((await readOne(cleared, HANDLE('name', 0))).validation).toBeNull();
  });

  it('CONTROL: each is refused on a kind that does not take it, and nothing is written', async () => {
    await expect(applyPdfLibWithFaces(await form(), editing(HANDLE('list', 4), { borderStyle: 'dashed' }), undefined)).rejects.toSatisfy(isRefused('style-kind'));
    await expect(applyPdfLibWithFaces(await form(), editing(HANDLE('name', 0), { checkStyle: 'star' }), undefined)).rejects.toSatisfy(isRefused('style-kind'));
    await expect(applyPdfLibWithFaces(await form(), editing(HANDLE('tick', 1), { validation: { min: 0, max: 1 } }), undefined)).rejects.toSatisfy(isRefused('style-kind'));
    // A SOLID border is what every kind already draws, so it is taken anywhere.
    await expect(applyPdfLibWithFaces(await form(), editing(HANDLE('list', 4), { borderStyle: 'solid' }), undefined)).resolves.toBeInstanceOf(Uint8Array);
  });
});
