import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { applyCreateFormField } from './formFieldCreate.js';
import { asDocVersion } from '@monstera/shared';

import { applyFillFormField, applyFlattenFormFields, fillWidget } from './formFields.js';
import { buildFormTestPdf } from './formTestForm.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';

/**
 * A flatten keeps what the page shows: every border, empty box and circle, drawn as it looked.
 *
 * ## What is measured, and why the instrument is not the obvious one
 *
 * With `showExtras` on, MuPDF draws widgets as widgets, so a baked and an unbaked document render alike and a flatten
 * that erased everything would pass. Each field's ink is therefore read BEFORE with widgets drawn, and AFTER with them
 * off: after a flatten the only way a box is on the page is that the bake put it in the page's own content.
 * {@link inkOf}'s control reads an UNFLATTENED document with widgets off and must see none, so the measurement is shown
 * able to tell a baked box from a missing one.
 *
 * ## Four shapes, because a form arrives in more than one
 *
 * Untouched; with every field touched and every tick box and radio switched on and off again (the empty ones the person
 * reported are exactly the ones a fill regenerates); with no appearance for the Off state or for the comb field, as many
 * real forms are; and after a field was created beside them (a create rewrites the document through the other writer).
 */

interface Placed {
  readonly name: string;
  readonly kind: string;
  readonly page: number;
  readonly bounds: readonly number[];
}

function inkOf(bytes: Uint8Array, placed: readonly Placed[], extras: boolean): ReadonlyMap<string, number> {
  const opened = mupdf.Document.openDocument(bytes, 'application/pdf');
  const out = new Map<string, number>();
  const pages = new Set(placed.map((entry) => entry.page));
  for (const page of pages) {
    const loaded = opened.loadPage(page);
    const origin = loaded.getBounds();
    const pixmap = loaded.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, extras);
    const width = pixmap.getWidth();
    const height = pixmap.getHeight();
    const pixels = pixmap.getPixels();
    for (const entry of placed.filter((candidate) => candidate.page === page)) {
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = entry.bounds;
      let ink = 0;
      for (let y = Math.max(0, Math.floor(y0 - origin[1])); y < Math.min(height, Math.ceil(y1 - origin[1])); y += 1) {
        for (let x = Math.max(0, Math.floor(x0 - origin[0])); x < Math.min(width, Math.ceil(x1 - origin[0])); x += 1) {
          const at = (y * width + x) * 3;
          if ((pixels[at] ?? 255) + (pixels[at + 1] ?? 255) + (pixels[at + 2] ?? 255) < 700) ink += 1;
        }
      }
      out.set(`${String(entry.page)}:${entry.name}:${entry.bounds.map(Math.round).join(',')}`, ink);
    }
    pixmap.destroy();
  }
  return out;
}

async function placedOf(bytes: Uint8Array, touch: boolean): Promise<{ readonly placed: Placed[]; readonly session: Awaited<ReturnType<typeof mupdfWriter.open>> }> {
  const session = await mupdfWriter.open(bytes);
  const placed: Placed[] = [];
  await withDocument(session, (document) => {
    for (let page = 0; page < document.countPages(); page += 1) {
      for (const widget of document.loadPage(page).getWidgets()) {
        placed.push({ name: widget.getName(), kind: widget.getFieldType(), page, bounds: widget.getBounds() });
        if (!touch || widget.isReadOnly()) continue;
        if (widget.isCheckbox() || widget.isRadioButton()) {
          fillWidget(widget, { set: 'button', on: true });
          fillWidget(widget, { set: 'button', on: false });
        } else if (widget.isText()) fillWidget(widget, { set: 'text', text: 'AB12 3CD' });
        else if (widget.isChoice()) fillWidget(widget, { set: 'choice', option: widget.getOptions()[0] ?? '' });
      }
    }
  });
  return { placed, session };
}

async function flattenedKeeps(bytes: Uint8Array, touch: boolean): Promise<{ readonly lost: string[]; readonly fields: number; readonly ink: number }> {
  const { placed, session } = await placedOf(bytes, touch);
  try {
    const before = inkOf(await mupdfWriter.serialise(session), placed, true);
    await applyFlattenFormFields(session, { kind: 'flattenFormFields' });
    const after = inkOf(await mupdfWriter.serialise(session), placed, false);
    const lost = [...before].filter(([key, ink]) => (after.get(key) ?? 0) < ink * 0.8).map(([key, ink]) => `${key}: ${String(ink)} -> ${String(after.get(key))}`);
    return { lost, fields: before.size, ink: [...before.values()].reduce((sum, ink) => sum + ink, 0) };
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('flatten keeps what the page shows', () => {
  it('CONTROL: an unflattened form read with widgets off shows no field, so the after-reading can see a missing box', async () => {
    const bytes = await buildFormTestPdf();
    const { placed, session } = await placedOf(bytes, false);
    try {
      const drawn = inkOf(await mupdfWriter.serialise(session), placed, true);
      const hidden = inkOf(await mupdfWriter.serialise(session), placed, false);
      const boxes = placed.filter((entry) => entry.kind === 'checkbox' || entry.kind === 'radiobutton');
      expect(boxes.length).toBeGreaterThan(10);
      for (const box of boxes) {
        const key = `${String(box.page)}:${box.name}:${box.bounds.map(Math.round).join(',')}`;
        expect(drawn.get(key), `${box.name} drawn as a widget`).toBeGreaterThan(20);
        expect(hidden.get(key), `${box.name} with widgets off`).toBeLessThan(5);
      }
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('an untouched form keeps every border, every empty tick box and every radio circle', async () => {
    const kept = await flattenedKeeps(await buildFormTestPdf(), false);
    expect(kept.fields).toBeGreaterThan(60);
    expect(kept.ink).toBeGreaterThan(30000);
    expect(kept.lost).toStrictEqual([]);
  });

  it('a form every field of which was touched, tick boxes and radios switched on and off again, keeps them all', async () => {
    const kept = await flattenedKeeps(await buildFormTestPdf(), true);
    expect(kept.lost).toStrictEqual([]);
  });

  it('the person\'s steps: a few fields filled through the fill command, then Flatten, keeps every empty box and circle', async () => {
    const bytes = await buildFormTestPdf();
    const { placed, session } = await placedOf(bytes, false);
    try {
      const fill = (name: string, value: Parameters<typeof applyFillFormField>[1]['value']): Promise<void> => {
        const at = placed.findIndex((entry) => entry.name === name);
        const found = placed[at];
        if (found === undefined) throw new Error(`the fixture has no ${name}`);
        const sameNameBefore = placed.slice(0, at).filter((entry) => entry.page === found.page).length;
        return applyFillFormField(session, { kind: 'fillFormField', page: found.page, index: sameNameBefore, value, version: asDocVersion(1) });
      };
      await fill('email', { set: 'text', text: 'someone@example.org' });
      await fill('date_of_birth', { set: 'text', text: '01/02/1990' });
      await fill('events', { set: 'button', on: true });
      const before = inkOf(await mupdfWriter.serialise(session), placed, true);
      await applyFlattenFormFields(session, { kind: 'flattenFormFields' });
      const after = inkOf(await mupdfWriter.serialise(session), placed, false);
      const lost = [...before].filter(([key, ink]) => (after.get(key) ?? 0) < ink * 0.8).map(([key]) => key);
      expect(before.size, 'control: the reading covers every field of the form').toBeGreaterThan(60);
      expect(lost).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a form with no appearance for the Off state and none for the comb field keeps what the page showed', async () => {
    const document = await PDFDocument.load(await buildFormTestPdf());
    for (const field of document.getForm().getFields()) {
      for (const widget of field.acroField.getWidgets()) {
        const appearance = widget.dict.lookup(PDFName.of('AP'));
        if (!(appearance instanceof PDFDict)) continue;
        const normal = appearance.lookup(PDFName.of('N'));
        if (normal instanceof PDFDict && normal.has(PDFName.of('Off'))) normal.delete(PDFName.of('Off'));
        if (field.getName() === 'postcode') widget.dict.delete(PDFName.of('AP'));
      }
    }
    const kept = await flattenedKeeps(await document.save({ updateFieldAppearances: false }), false);
    expect(kept.lost).toStrictEqual([]);
  });

  it('a form a field was created in, which the other writer rewrote, keeps what the page showed', async () => {
    const created = await applyCreateFormField(await buildFormTestPdf(), {
      kind: 'createFormField',
      page: 0,
      fields: [{ rect: { x0: 400, y0: 600, x1: 500, y1: 620 }, name: 'Name', field: { type: 'text' } }],
    });
    const kept = await flattenedKeeps(created, true);
    expect(kept.lost).toStrictEqual([]);
  });
});
