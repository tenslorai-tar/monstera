import { describe, expect, it } from 'vitest';

import { wrapHandlers } from '@monstera/contract';

import { localMupdfExecution } from '../commandSpecs.js';
import type { ProtectedWriting } from '../documentProtection.js';
import type { ByteImage, MupdfSession } from '../engineSeam.js';
import { engineChannels } from './engineChannels.js';
import { type HostSession, createEngineHandlers } from './engineHandlers.js';

/**
 * `engine/applyPdfLib` on a session whose bytes are protected, at the handler (ADR-0220).
 *
 * What the handler owns here is the ORDER: which bytes pdf-lib is handed, which bytes are written, and that a document
 * whose protection cannot be written again is refused before any work. That the protection is the document's own, and that
 * the result opens only with its password, is `scripts/proofs/pdfLibProtected.proof.mjs`'s, against the real engine.
 */

const AREA = { snapshotDirectory: 'snapshots', outputDirectory: 'output' };
const PROTECTED = new Uint8Array([1, 1, 1]);
const READABLE = new Uint8Array([2, 2, 2]);
const RESULT = new Uint8Array([3, 3, 3]);
const SEALED = new Uint8Array([4, 4, 4]);

const COMMAND = { kind: 'watermarkPages', pages: 'all', text: 'DRAFT', opacity: 0.3, rotationDegrees: 45, fontSize: 36 } as const;

function refuse(what: string): () => never {
  return () => {
    throw new Error(`this case must not ${what}`);
  };
}

interface Trace {
  readonly serialised: number;
  readonly appliedTo: ByteImage[];
  readonly written: ByteImage[];
}

async function apply(protectedWriting: ((session: MupdfSession) => Promise<ProtectedWriting | undefined>) | undefined) {
  const trace: { serialised: number; appliedTo: ByteImage[]; written: ByteImage[] } = { serialised: 0, appliedTo: [], written: [] };
  const session = { engine: 'mupdf' } as MupdfSession;
  const held = new Map<string, HostSession>([['h1', { session, ...AREA }]]);
  const wrapped = wrapHandlers(
    engineChannels,
    createEngineHandlers({
      sessions: { lookup: (id) => held.get(id), issue: refuse('open a session'), forget: refuse('close a session') },
      execution: localMupdfExecution,
      writer: {
        open: refuse('open'),
        serialise: () => {
          trace.serialised += 1;
          return Promise.resolve(PROTECTED);
        },
        close: refuse('close'),
      },
      access: refuse('ask what a password bought'),
      signatures: refuse('read signatures'),
      files: {
        readSnapshot: refuse('read the snapshot directory'),
        writeOutput: (_directory, _name, bytes) => {
          trace.written.push(bytes);
          return Promise.resolve(bytes.length);
        },
        writeOutputStream: refuse('stream output'),
      },
      probe: refuse('probe containment'),
      geometry: refuse('read the page tree'),
      pageText: refuse('read the page text'),
      pageLinks: refuse('read the page links'),
      linkAddress: refuse('read a link address'),
      pageFills: refuse('read the page fills'),
      wordBoxes: refuse('read the word boxes'),
      ocr: refuse('recognise a page'),
      destinations: refuse('read the outline'),
      layers: refuse('read the layers'),
      annotations: refuse('list annotations'),
      formFields: refuse('read the fields'),
      duplicates: refuse('look for duplicates'),
      extract: refuse('build a document'),
      applyPdfLib: (image) => {
        trace.appliedTo.push(image);
        return Promise.resolve(RESULT);
      },
      ...(protectedWriting === undefined ? {} : { protectedWriting }),
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
  const answer = await wrapped['engine/applyPdfLib']({ session: 'h1', command: COMMAND, into: 'ab12' });
  return { answer, trace: trace satisfies Trace };
}

describe('engine/applyPdfLib on a protected session', () => {
  it('hands pdf-lib the readable bytes and writes only what protecting its result made', async () => {
    const { answer, trace } = await apply(() =>
      Promise.resolve({ plain: () => Promise.resolve(READABLE), protect: () => Promise.resolve(SEALED) }),
    );
    expect(answer.ok).toBe(true);
    expect(trace.appliedTo).toStrictEqual([READABLE]);
    // ONLY THE PROTECTED BYTES REACH THE OUTPUT DIRECTORY: the readable bytes and pdf-lib's own result are never written.
    expect(trace.written).toStrictEqual([SEALED]);
    // THE SESSION'S OWN SERIALISE IS NOT TAKEN: the readable copy is made from the protected one by the seam.
    expect(trace.serialised).toBe(0);
  });

  it('CONTROL: a session whose bytes carry no protection is serialised, run on and written as it always was', async () => {
    for (const none of [undefined, () => Promise.resolve(undefined)]) {
      const { answer, trace } = await apply(none);
      expect(answer.ok).toBe(true);
      expect(trace.serialised).toBe(1);
      expect(trace.appliedTo).toStrictEqual([PROTECTED]);
      expect(trace.written).toStrictEqual([RESULT]);
    }
  });

  it('refuses before any work where the protection cannot be written again, and writes nothing', async () => {
    const { answer, trace } = await apply(() => Promise.reject(new Error('the user password is not known')));
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error.code).toBe('apply-failed');
    expect(trace.appliedTo).toStrictEqual([]);
    expect(trace.written).toStrictEqual([]);
    expect(trace.serialised).toBe(0);
  });
});
