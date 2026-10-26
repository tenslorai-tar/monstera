import { describe, expect, it } from 'vitest';

import { type CommandOfKind, wrapHandlers } from '@monstera/contract';
import { blockEditOf } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';

import { localMupdfExecution } from '../commandSpecs.js';
import type { DrawnBoxes, MupdfSession } from '../engineSeam.js';
import { MAX_WRITER_NOTE, MAX_WRITER_NOTES, engineChannels } from './engineChannels.js';
import { type HostSession, createEngineHandlers } from './engineHandlers.js';

/**
 * WHAT THE OPERATOR WRITER'S CHECKS NOTE CROSSES THE MuPDF HOST'S PIPE (ADR-0270): the stage audit's AUD-2 found the
 * PDFium host's answer carried a note in a case and the MuPDF host's — the one whose writer makes them — in none, so a
 * handler that answered `noted: []` would have left every case green while the shell's defect log heard nothing.
 */
function refuse(what: string): () => never {
  return () => {
    throw new Error(`this case must not ${what}`);
  };
}

const COMMAND = {
  kind: 'editTextOperators',
  page: 0,
  ...blockEditOf([{ lines: [[0]], soft: [false], text: 'words' }]),
  fit: 'reflow',
  version: asDocVersion(1),
} as const satisfies CommandOfKind<'editTextOperators'>;

/** The MuPDF host's handlers over one held session whose writer answers `drawn`. */
function hostAnswering(drawn: DrawnBoxes) {
  const session = { engine: 'mupdf' } as MupdfSession;
  const held = new Map<string, HostSession>([['h1', { session, snapshotDirectory: 'snapshots', outputDirectory: 'output' }]]);
  return wrapHandlers(
    engineChannels,
    createEngineHandlers({
      sessions: { lookup: (id) => held.get(id), issue: refuse('open a session'), forget: refuse('close a session') },
      // THE WRITER'S ANSWER, as the operator writer gives it; the rest of the execution is the real one.
      execution: { ...localMupdfExecution, apply: () => Promise.resolve(drawn) },
      writer: { open: refuse('open'), serialise: refuse('serialise'), close: refuse('close') },
      access: refuse('ask what a password bought'),
      signatures: refuse('read signatures'),
      files: { readSnapshot: refuse('read the snapshot directory'), writeOutput: refuse('write output'), writeOutputStream: refuse('stream output') },
      probe: refuse('probe containment'),
      geometry: refuse('read the page tree'),
      pageText: refuse('read the page text'),
      pageLinks: refuse('read the page links'),
      linkAddress: refuse('read a link address'),
      pageFills: refuse('read the page fills'),
      scanTables: refuse('read scanned tables'),
      pageAdjustment: refuse('read a page adjustment'),
      wordBoxes: refuse('read the word boxes'),
      ocr: refuse('recognise a page'),
      destinations: refuse('read the outline'),
      layers: refuse('read the layers'),
      fonts: refuse('read the fonts'),
      pageMarks: refuse('read the stamps'),
      annotations: refuse('list annotations'),
      formFields: refuse('read the fields'),
      fieldProperties: refuse('read a field’s properties'),
      buttonActions: refuse('read a button’s actions'),
      formImportPlan: refuse('plan a form import'),
      annotationImportPlan: refuse('plan a comment import'),
      pageRewrite: refuse('rewrite a page'),
      textFaces: refuse('read the fonts’ faces'),
      blockFaces: refuse('read a block’s faces'),
      duplicates: refuse('look for duplicates'),
      extract: refuse('build a document'),
      formPages: refuse('read a page’s forms'),
      applyPdfLib: refuse('run pdf-lib'),
      prepareSignature: refuse('prepare a signature'),
      snapshot: refuse('write a PNG out'),
      exportFormData: refuse('encode an export'),
      pageImage: refuse('export a page image'),
      word: refuse('export a Word file'),
      flatFields: refuse('propose fields'),
      barcodes: refuse('read barcodes'),
      exportAnnotationData: refuse('export annotations'),
      accessibility: refuse('check accessibility'),
      annotationRecords: refuse('read annotation records'),
      annotationWords: refuse('read annotation words'),
      signaturesKept: refuse('ask whether a save keeps signatures'),
    }),
    () => undefined,
  );
}

describe('engine/apply-file answers what the writer noted (ADR-0270, the stage audit AUD-2)', () => {
  it('carries the first notes whole and each held to its bound; CONTROL a write that noted nothing answers none', async () => {
    const notes = Array.from({ length: MAX_WRITER_NOTES + 1 }, (_, at) => (at === 0 ? 'x'.repeat(MAX_WRITER_NOTE + 50) : `page 0: note ${String(at)}`));
    const answer = await hostAnswering({ boxed: [], more: 0, noted: notes })['engine/apply-file']({
      session: 'h1',
      command: COMMAND,
      sources: [],
      reads: { textObjects: [0], runs: [{ index: 0, members: [0], text: 'w', left: 0, right: 1, bottom: 0, top: 1 }] },
    });
    if (!answer.ok) throw new Error(JSON.stringify(answer));
    expect(answer.value.noted).toHaveLength(MAX_WRITER_NOTES);
    expect(answer.value.noted[0]).toHaveLength(MAX_WRITER_NOTE);
    expect(answer.value.noted.at(-1)).toBe(`page 0: note ${String(MAX_WRITER_NOTES - 1)}`);

    const quiet = await hostAnswering({ boxed: [], more: 0, noted: [] })['engine/apply-file']({
      session: 'h1',
      command: COMMAND,
      sources: [],
      reads: { textObjects: [0], runs: [{ index: 0, members: [0], text: 'w', left: 0, right: 1, bottom: 0, top: 1 }] },
    });
    expect(quiet.ok && quiet.value.noted).toStrictEqual([]);
  });
});
