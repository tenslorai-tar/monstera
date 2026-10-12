import { PDFDocument as LibDocument } from '@cantoo/pdf-lib';
import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { applyFillFormField, applyFlattenFormFields } from './formFields.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';

/**
 * A list box's options and chosen rows, drawn by Monstera after every fill
 * ([ADR-0231](../../../docs/DECISIONS/0231-a-list-boxs-options-are-drawn-by-monstera.md)).
 *
 * ## The control
 *
 * MuPDF's own redraw of a list box, with nothing of Monstera's after it, is drawn first in the same file and shows no
 * option: so an option in the appearance after a fill is this build's drawing, and the case fails the day the step is
 * taken away (the defect found on the owner's form, where a filled list box went blank and stayed blank once flattened).
 */

const VERSION = asDocVersion(1);
const OPTIONS = ['Reading', 'Sport', 'Music'] as const;
/** pdf-lib's highlight, as the step writes it. */
const CHOSEN = '0.6 0.757 0.855 rg';

async function form(multiSelect: boolean): Promise<Uint8Array> {
  const document = await LibDocument.create();
  const page = document.addPage([300, 300]);
  const list = document.getForm().createOptionList('interests');
  list.addOptions([...OPTIONS]);
  if (multiSelect) list.enableMultiselect();
  list.addToPage(page, { x: 20, y: 150, width: 150, height: 60 });
  return document.save();
}

/** The list box's normal appearance after `change` runs on the session and the session is saved and opened again. */
async function appearanceAfter(bytes: Uint8Array, change: (session: Awaited<ReturnType<typeof mupdfWriter.open>>) => Promise<unknown>): Promise<string> {
  const session = await mupdfWriter.open(bytes);
  let saved: Uint8Array;
  try {
    await change(session);
    saved = await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
  const again = await mupdfWriter.open(saved);
  try {
    return await withDocument(again, (document) => document.loadPage(0).getWidgets()[0]?.getObject().get('AP', 'N').readStream().asString() ?? '');
  } finally {
    await mupdfWriter.close(again);
  }
}

describe('a list box is drawn with its options and its chosen rows (A6.1, ADR-0231)', () => {
  it('CONTROL: MuPDF’s own redraw of a list box draws no option', async () => {
    const content = await appearanceAfter(await form(false), (session) =>
      withDocument(session, (document) => {
        const widget = document.loadPage(0).getWidgets()[0];
        widget?.setChoiceValue('Sport');
        widget?.update();
      }),
    );
    for (const option of OPTIONS) expect(content).not.toContain(`(${option}) Tj`);
  });

  it('a single choice filled keeps every option and highlights the chosen row', async () => {
    const content = await appearanceAfter(await form(false), (session) =>
      applyFillFormField(session, { kind: 'fillFormField', page: 0, index: 0, version: VERSION, value: { set: 'choice', option: 'Sport' } }),
    );
    for (const option of OPTIONS) expect(content).toContain(`(${option}) Tj`);
    expect(content.split(CHOSEN).length - 1).toBe(1);
    // THE CHOSEN ROW IS THE SECOND: its fill sits between the first and second baselines' rows, below the first option's.
    const fill = /0\.6 0\.757 0\.855 rg\n[\d.]+ ([\d.]+) /u.exec(content);
    const second = /([\d.]+) Td\n\(Sport\) Tj/u.exec(content);
    expect(fill?.[1]).toBeDefined();
    expect(second?.[1]).toBeDefined();
    expect(Number(fill?.[1])).toBeLessThan(Number(second?.[1]));
  });

  it('several choices filled highlight each of them, and none chosen highlights none', async () => {
    const two = await appearanceAfter(await form(true), (session) =>
      applyFillFormField(session, { kind: 'fillFormField', page: 0, index: 0, version: VERSION, value: { set: 'choices', options: ['Reading', 'Music'] } }),
    );
    expect(two.split(CHOSEN).length - 1).toBe(2);
    const none = await appearanceAfter(await form(true), (session) =>
      applyFillFormField(session, { kind: 'fillFormField', page: 0, index: 0, version: VERSION, value: { set: 'choices', options: [] } }),
    );
    expect(none).not.toContain(CHOSEN);
    for (const option of OPTIONS) expect(none).toContain(`(${option}) Tj`);
  });

  it('a filled list box flattened keeps its options as the page’s own text', async () => {
    const session = await mupdfWriter.open(await form(false));
    let flat: Uint8Array;
    try {
      await applyFillFormField(session, { kind: 'fillFormField', page: 0, index: 0, version: VERSION, value: { set: 'choice', option: 'Music' } });
      await applyFlattenFormFields(session, { kind: 'flattenFormFields', fields: 'all', version: VERSION });
      flat = await mupdfWriter.serialise(session);
    } finally {
      await mupdfWriter.close(session);
    }
    const again = await mupdfWriter.open(flat);
    let text: string;
    try {
      text = await withDocument(again, (document) => {
        const page = document.loadPage(0);
        expect(page.getWidgets()).toHaveLength(0);
        return page.toStructuredText('preserve-whitespace').asText();
      });
    } finally {
      await mupdfWriter.close(again);
    }
    for (const option of OPTIONS) expect(text).toContain(option);
  });
});
