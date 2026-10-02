/**
 * How long importing N annotations onto one page takes, for N at three sizes — whether the import is linear, and
 * which of its steps is not.
 *
 * Run: `node scripts/research/importAnnotationsScale.mjs` after `npm run build`.
 *
 * Doubling N separates the two shapes: a linear step doubles its time, a quadratic one quadruples it. The import's
 * steps per record are measured alone on a fresh page each, through MuPDF's own calls: create, then create and update
 * (the redraw), so a step that walks every annotation already placed shows as the one that quadruples.
 */
import { PDFDocument } from '@cantoo/pdf-lib';

import {
  applyImportAnnotations,
  mupdfWriter,
  serialiseAnnotationData,
  withDocument,
} from '../../packages/kernel/dist/engine.js';
import { HOST_READS, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';

// THE KERNEL, CONTRACT AND SHARED BUILDS this measures, refused when older than their sources.
refuseStaleBuild(repoRoot(), HOST_READS, 3);
bindNativeEngine();

const blank = await PDFDocument.create();
blank.addPage([600, 800]);
const bytes = await blank.save();

/**
 * @param {string} label what is timed
 * @param {(count: number) => Promise<void>} run the work for one size
 */
async function timed(label, run) {
  for (const count of [1000, 2000, 4000]) {
    const started = performance.now();
    await run(count);
    console.log(`${label}, ${String(count)}: ${(performance.now() - started).toFixed(0)} ms`);
  }
}

await timed('the import', async (count) => {
  /** @type {import('../../packages/kernel/dist/annotationInterchange.js').InterchangeAnnotation[]} */
  const notes = Array.from({ length: count }, () => ({
    page: 0,
    subtype: /** @type {const} */ ('Square'),
    rect: /** @type {[number, number, number, number]} */ ([10, 10, 30, 30]),
  }));
  const session = await mupdfWriter.open(bytes);
  try {
    await applyImportAnnotations(session, {
      kind: 'importAnnotations',
      format: 'json',
      bytes: serialiseAnnotationData(notes, 'json'),
    });
  } finally {
    await mupdfWriter.close(session);
  }
});

await timed('create all, then update the page once', async (count) => {
  const session = await mupdfWriter.open(bytes);
  try {
    await withDocument(session, (document) => {
      const page = document.loadPage(0);
      for (let index = 0; index < count; index += 1) page.createAnnotation('Square').setRect([10, 10, 30, 30]);
      page.update();
      const drawn = page.getAnnotations().filter((annotation) => !annotation.getObject().get('AP').isNull()).length;
      if (drawn !== count) throw new Error(`the page update drew ${String(drawn)} of ${String(count)}`);
    });
  } finally {
    await mupdfWriter.close(session);
  }
});

for (const step of ['create', 'create and update']) {
  await timed(step, async (count) => {
    const session = await mupdfWriter.open(bytes);
    try {
      await withDocument(session, (document) => {
        const page = document.loadPage(0);
        for (let index = 0; index < count; index += 1) {
          const annotation = page.createAnnotation('Square');
          annotation.setRect([10, 10, 30, 30]);
          if (step === 'create and update') annotation.update();
        }
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });
}
