import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import { type AnnotationDraft, channels, listedAnnotationSchema } from '@monstera/contract';

import { mupdfWriter } from '../mupdfWriter.js';
import { type ListedAnnotation, applyAddAnnotation, readAnnotations } from '../pageAnnotations.js';
import { engineChannels } from './engineChannels.js';

/**
 * The annotation list crossing BOTH of its boundaries: the engine host's answer to `main` and `main`'s part to the
 * renderer.
 *
 * Every other test of the reader runs it in the test's own process, so none crosses the host's declared result, and
 * that is how the host came to refuse its own answer for every document with marks (KKKKKKKK-1): the walk listed
 * `object` and `measured`, the renderer's row admitted them, and the host's strict copy of that row did not. The
 * channels now take one row, `listedAnnotationSchema`; this file holds the reader to it, after a real JSON round trip,
 * on a page carrying every optional key the reader writes for the marks this build draws.
 *
 * CONTROL: an entry with one key the row does not declare is refused at the host's crossing, so the anchor below is a
 * strict schema admitting the reader rather than a schema that admits anything.
 */

const STAMP = { author: 'Priya Raman', created: '2026-09-24T09:38:00.000Z' } as const;

const DRAFTS: readonly AnnotationDraft[] = [
  {
    type: 'measure-distance',
    points: [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
    ],
    scale: { perPoint: 0.5, unit: 'mm' },
    colour: [0.1, 0.45, 0.9],
    opacity: 1,
    borderWidth: 2,
  },
  {
    type: 'text-box',
    rect: { x0: 10, y0: 120, x1: 300, y1: 200 },
    // LONGER THAN A LISTING CARRIES, so the entry is a slice and says `cut`.
    text: 'a long comment '.repeat(60),
    colour: [0.1, 0.1, 0.1],
    opacity: 1,
    fontSize: 12,
    font: 'sans',
    direction: 'left-to-right',
  },
  { type: 'square', rect: { x0: 10, y0: 220, x1: 110, y1: 270 }, colour: [1, 0, 0], opacity: 1, borderWidth: 2 },
];

async function listed(): Promise<readonly ListedAnnotation[]> {
  const document = await PDFDocument.create();
  document.addPage([400, 600]);
  const session = await mupdfWriter.open(await document.save());
  try {
    for (const annotation of DRAFTS) await applyAddAnnotation(session, { kind: 'addAnnotation', page: 0, annotation, stamp: STAMP });
    return (await readAnnotations(session)).annotations;
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('the annotation list crosses both of its boundaries', () => {
  it('the host’s answer and the renderer’s part admit what the reader lists, every optional key included', async () => {
    const annotations = await listed();
    // AND IT LISTED WHAT THE PAGE CARRIES (checklist 4b): an empty walk admits under any schema.
    expect(annotations.map((one) => one.kind)).toStrictEqual(['measure-distance', 'text-box', 'square']);
    // THE KEYS THE DEFECT WAS ABOUT, and the other optional ones, are present, so the crossing below is asked about them.
    const keys = new Set(annotations.flatMap((one) => Object.keys(one)));
    for (const key of ['object', 'measured', 'points', 'typed', 'cut']) expect(keys.has(key), key).toBe(true);

    const wire = JSON.parse(JSON.stringify({ annotations, truncated: false })) as unknown;
    const host = engineChannels['engine/annotations'].result.safeParse(wire);
    expect(host.success, JSON.stringify(host.error?.issues)).toBe(true);
    const part = JSON.parse(JSON.stringify({ version: 1, annotations, next: null, truncated: false })) as unknown;
    const renderer = channels['document.annotations'].result.safeParse(part);
    expect(renderer.success, JSON.stringify(renderer.error?.issues)).toBe(true);
  });

  it('CONTROL: a key the row does not declare is refused at the host’s crossing', async () => {
    const [first] = await listed();
    const wire = JSON.parse(JSON.stringify({ annotations: [{ ...first, undeclared: 1 }], truncated: false })) as unknown;
    const host = engineChannels['engine/annotations'].result.safeParse(wire);
    expect(host.success).toBe(false);
    expect(JSON.stringify(host.error?.issues)).toContain('undeclared');
  });

  it('the reader’s row and the wire’s row name the same keys, so a key added to one alone does not compile', () => {
    expectTypeOf<keyof ListedAnnotation>().toEqualTypeOf<keyof z.output<typeof listedAnnotationSchema>>();
  });
});
