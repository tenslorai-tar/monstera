import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { type CommandOfKind, createClient, type Incident, wrapHandlers } from '@monstera/contract';

import { localMupdfExecution } from '../commandSpecs.js';
import type { ByteImage, MupdfSession } from '../engineSeam.js';
import { accessFor, mupdfWriter, withDocument } from '../mupdfWriter.js';
import { readSignatures } from '../signatureRead.js';
import { extractPages } from '../pageExtract.js';
import { rasterisePageImage } from '../pageImages.js';
import { snapshotRegion } from '../pageSnapshot.js';
import { readPageGeometry } from '../pageGeometry.js';
import { readDestinations } from '../destinations.js';
import { readLayers } from '../layers.js';
import { checkAccessibility } from '../accessibilityCheck.js';
import {
  copyAnnotationData,
  readInterchangeAnnotations,
  serialiseAnnotationData,
} from '../annotationInterchange.js';
import { readPageBarcodes } from '../barcodeReader.js';
import { detectFlatFields } from '../flatFields.js';
import { readFormData, serialiseFormData } from '../formData.js';
import { readFormFields } from '../formFields.js';
import { readAnnotations } from '../pageAnnotations.js';
import { findDuplicatePages } from '../pageDuplicates.js';
import { readPageFills } from '../pageFills.js';
import { readPageLinks } from '../pageLinks.js';
import { readPageTextJson } from '../pageText.js';
import { withCellFills } from '../cellFills.js';
import { linesOf, parsePageStructure, parsePageTables, parsePageText } from '../textStructure.js';
import { engineChannels } from './engineChannels.js';
import { type HostSession, createEngineHandlers } from './engineHandlers.js';
import {
  createRemoteSessions,
  EngineSessionGone,
  remoteMupdfExecution,
  remoteMupdfGeometry,
  remoteMupdfPageText,
  remoteMupdfPageFills,
  remoteMupdfAccessibility,
  type SessionAssets,
  UnknownRemoteSession,
} from './remoteEngine.js';

/**
 * The two halves of ADR-0023 Decision 10, joined (Decision 11's channels).
 *
 * **These cases drive BOTH halves against ONE document**, which is the only way
 * the decision's central claim is testable: the host performs the same
 * `declaredSpecs` lookup main would have performed, so a command that crosses
 * has the same effect as one that did not. Anything less — a stubbed host, an
 * asserted round trip — proves the wire and not the claim.
 *
 * The transport here is a function call rather than a pipe. That is deliberate
 * and is stated so it is not read as more than it is: framing, the reader thread
 * and the client's correlation are proven in their own files, and joining them
 * here would test four things at once and locate a failure in none of them.
 * What this file proves is that the two EXECUTION halves agree.
 */

let flat: ByteImage;
let tagged: ByteImage;
let ruled: ByteImage;
let shaded: ByteImage;

beforeAll(async () => {
  const document = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) document.addPage([612, 792]);
  flat = await document.save();
  tagged = taggedPdf();

  // ONE RULED 3x2 GRID, each cell its own stroked rectangle.
  const grid = await PDFDocument.create();
  const font = await grid.embedFont(StandardFonts.Helvetica);
  const page = grid.addPage([612, 792]);
  [
    ['Item', 'Qty', 'Price'],
    ['Bolt', '12', '0.45'],
  ].forEach((row, r) => {
    row.forEach((text, c) => {
      const x = 72 + c * 120;
      const y = 700 - r * 24;
      page.drawRectangle({ x, y: y - 6, width: 120, height: 24, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      page.drawText(text, { x: x + 6, y, size: 11, font });
    });
  });
  ruled = await grid.save();

  // THE SAME GRID WITH ITS HEADER ROW SHADED, filled and stroked as a table's shading is drawn.
  const shadedGrid = await PDFDocument.create();
  const shadedFont = await shadedGrid.embedFont(StandardFonts.Helvetica);
  const shadedPage = shadedGrid.addPage([612, 792]);
  [
    ['Item', 'Qty', 'Price'],
    ['Bolt', '12', '0.45'],
  ].forEach((row, r) => {
    row.forEach((text, c) => {
      const x = 72 + c * 120;
      const y = 700 - r * 24;
      shadedPage.drawRectangle({
        x,
        y: y - 6,
        width: 120,
        height: 24,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
        ...(r === 0 ? { color: rgb(0.85, 0.85, 0.85) } : {}),
      });
      shadedPage.drawText(text, { x: x + 6, y, size: 11, font: shadedFont });
    });
  });
  shaded = await shadedGrid.save();
});

/**
 * One tagged page whose structure tree lists its second-drawn paragraph FIRST.
 *
 * Assembled by hand because pdf-lib writes no marked content. These are the
 * objects the 2026-09-14 probe read MuPDF 1.28.0's tree order from: the stream
 * draws *drawn first* then *drawn second*, and the tree says the reverse — so the
 * two reads of this page disagree about order, which is what lets a case tell
 * which one crossed.
 */
function taggedPdf(): ByteImage {
  const content =
    '/P <</MCID 0>> BDC BT /F1 14 Tf 72 200 Td (drawn first) Tj ET EMC\n' +
    '/P <</MCID 1>> BDC BT /F1 14 Tf 72 600 Td (drawn second) Tj ET EMC\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> /StructTreeRoot 5 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R /StructParents 0 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /StructTreeRoot /K 6 0 R /ParentTree << /Nums [0 [9 0 R 8 0 R]] >> >>',
    '<< /Type /StructElem /S /Document /P 5 0 R /K [8 0 R 9 0 R] >>',
    `<< /Length ${String(content.length)} >>\nstream\n${content}endstream`,
    '<< /Type /StructElem /S /P /P 6 0 R /Pg 3 0 R /K 1 >>',
    '<< /Type /StructElem /S /P /P 6 0 R /Pg 3 0 R /K 0 >>',
  ];
  let body = '%PDF-1.7\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/**
 * A token stands for a handle AND an area since ADR-0030 Decision 2.
 *
 * This file's subject is running a command against a session, which touches
 * neither directory — so one shared value is honest here, and a case that
 * needed two would be a case about the lifecycle in the wrong file.
 */
const AREA = { snapshotDirectory: 'in', outputDirectory: 'out' };

/**
 * An asset surface that refuses to be used.
 *
 * Every command in this file declares `asset: 'none'`, so a stub that THROWS is
 * the assertion: an execution that reached for the filesystem on a command
 * carrying no bytes would fail here rather than pass quietly with a file
 * nobody asked for. A stub answering politely would separate nothing.
 */
const NO_ASSETS: SessionAssets = {
  write: () => {
    throw new Error('no command in this file carries an asset');
  },
  remove: () => {
    throw new Error('no command in this file carries an asset');
  },
  name: () => {
    throw new Error('no command in this file carries an asset');
  },
};

/** Every page of the three-page fixture, in order. */
const ALL_PAGES = [0, 1, 2];

const rotateFirst: CommandOfKind<'rotatePages'> = {
  kind: 'rotatePages',
  pages: [0],
  quarterTurns: 1,
};

/** The page's `/Rotate`, or `null` where the key is absent. */
const rotationOf = (session: MupdfSession): Promise<number | null> =>
  withDocument(session, (document) => {
    const rotate = document.loadPage(0).getObject().get('Rotate');
    return rotate.isNull() ? null : rotate.asNumber();
  });

/** A document whose pages are these widths, each 792 tall — `pageMerge.test.ts`' fixture shape. */
async function pagesOfWidths(widths: readonly number[]): Promise<ByteImage> {
  const document = await PDFDocument.create();
  for (const width of widths) document.addPage([width, 792]);
  return await document.save();
}

/** Every page's width, read from the session itself rather than from a serialised copy. */
const widthsOf = (session: MupdfSession): Promise<number[]> =>
  withDocument(session, (document) =>
    Array.from({ length: document.countPages() }, (_, index) => {
      const [x0, , x1] = document.loadPage(index).getBounds();
      return Math.round(x1 - x0);
    }),
  );

/**
 * One host and one main, wired to each other.
 *
 * `requests` counts what reached the wire, which is what separates *refused on
 * this side* from *refused by the host* — two outcomes that produce the same
 * rejection otherwise.
 */
async function joined(bytes: ByteImage = flat, sourceBytes?: ByteImage): Promise<{
  readonly session: MupdfSession;
  readonly token: MupdfSession;
  /** A second document on the host, for a command that names a source; absent without `sourceBytes`. */
  readonly sourceSession: MupdfSession | undefined;
  readonly sourceToken: MupdfSession | undefined;
  readonly remote: ReturnType<typeof remoteMupdfExecution>;
  readonly geometry: ReturnType<typeof remoteMupdfGeometry>;
  readonly pageText: ReturnType<typeof remoteMupdfPageText>;
  readonly pageFills: ReturnType<typeof remoteMupdfPageFills>;
  readonly accessibility: ReturnType<typeof remoteMupdfAccessibility>;
  readonly sessions: ReturnType<typeof createRemoteSessions>;
  readonly requests: () => number;
  readonly incidents: readonly Incident[];
}> {
  const session = await mupdfWriter.open(bytes);
  const sourceSession = sourceBytes === undefined ? undefined : await mupdfWriter.open(sourceBytes);
  const held = new Map<string, HostSession>([
    [
      'h1',
      {
        session,
        outputDirectory: 'no directory: the execution half writes no bytes',
        snapshotDirectory: 'no directory: no command here carries an asset',
      },
    ],
  ]);
  if (sourceSession !== undefined) {
    held.set('h2', {
      session: sourceSession,
      outputDirectory: 'no directory: the execution half writes no bytes',
      snapshotDirectory: 'no directory: no command here carries an asset',
    });
  }

  const incidents: Incident[] = [];
  const wrapped = wrapHandlers(
    engineChannels,
    createEngineHandlers({
      sessions: {
        lookup: (id) => held.get(id),
        issue: () => {
          throw new Error('this file drives the EXECUTION half; nothing here opens a session');
        },
        forget: () => {
          throw new Error('this file drives the EXECUTION half; nothing here closes a session');
        },
      },
      execution: localMupdfExecution,
      // THROWING STUBS RATHER THAN WORKING ONES. Every case below is about
      // apply, capture and invert, none of which may touch a document image or
      // a directory — so a handler that reached for either fails loudly here
      // instead of passing against a surface that happened to work.
      writer: {
        open: () => {
          throw new Error('the execution half must not open');
        },
        serialise: () => {
          throw new Error('the execution half must not serialise');
        },
        close: () => {
          throw new Error('the execution half must not close');
        },
      },
      access: () => {
        throw new Error('the execution half opens nothing, so nothing has an access');
      },
      signatures: () => {
        throw new Error('the execution half reads no signatures');
      },
      files: {
        readSnapshot: () => {
          throw new Error('the execution half must not read the snapshot directory');
        },
        writeOutput: () => {
          throw new Error('the execution half must not write the output directory');
        },
      },
      probe: () => {
        throw new Error('the execution half must not probe containment');
      },
      // THE REAL READER, unlike the four stubs above, because the geometry
      // cases below are about what the HOST's page tree says after a command
      // crossed — which a stub cannot answer without becoming the thing under
      // test.
      geometry: readPageGeometry,
      // THE REAL READER for the same reason, so the text case below is about
      // what the HOST's document says rather than what a stub was told to say.
      pageText: readPageTextJson,
      pageLinks: readPageLinks,
      pageFills: readPageFills,
      // NOT THE REAL READER, where its neighbours above are. `recognisePage`
      // instantiates 2.8 MB of Tesseract WASM and takes about four seconds per
      // page, and no case in this file drives the channel — so the production
      // reader here would be a cost every case in the file pays to prove
      // nothing. `ocrRecognise.proof.mjs` is where the real engine runs.
      ocr: () => {
        throw new Error('no case in this file recognises anything');
      },
      destinations: readDestinations,
      layers: readLayers,
      // THE REAL READERS, so the parts assembled here are the production ones —
      // and NO CASE IN THIS FILE DRIVES EITHER. The comment here used to say
      // *the annotation cases below*, which named cases that have never
      // existed: the annotation walk is `pageAnnotations.test.ts`' subject and
      // its channel's crossing is `formFieldsChannel.test.ts`' sibling
      // question, left unwritten. Corrected 2026-09-07 rather than left to read
      // as coverage.
      annotations: readAnnotations,
      formFields: readFormFields,
      duplicates: findDuplicatePages,
      extract: extractPages,
      snapshot: snapshotRegion,
      exportFormData: async (session, format) =>
        serialiseFormData(await readFormData(session), format),
      pageImage: rasterisePageImage,
      flatFields: detectFlatFields,
      barcodes: readPageBarcodes,
      exportAnnotationData: async (session, format) =>
        serialiseAnnotationData(await readInterchangeAnnotations(session), format),
      accessibility: checkAccessibility,
      // THE REAL READER, as its neighbours here are: this file drives the remote half against a
      // host that reads, so the clipboard's copy is exercised over the pipe below.
      annotationRecords: copyAnnotationData,
    }),
    (incident) => incidents.push(incident),
  );

  let requests = 0;
  const client = createClient(engineChannels, async (id, params) => {
    requests += 1;
    return wrapped[id](params);
  });

  const sessions = createRemoteSessions();
  return {
    session,
    token: sessions.adopt('h1', AREA),
    sourceSession,
    sourceToken: sourceSession === undefined ? undefined : sessions.adopt('h2', AREA),
    remote: remoteMupdfExecution(client, sessions, NO_ASSETS),
    geometry: remoteMupdfGeometry(client, sessions),
    pageText: remoteMupdfPageText(client, sessions),
    pageFills: remoteMupdfPageFills(client, sessions),
    accessibility: remoteMupdfAccessibility(client, sessions),
    sessions,
    requests: () => requests,
    incidents,
  };
}

describe('the remote engine execution half (ADR-0023 Decisions 10 and 11)', () => {
  it('a command that names a SOURCE crosses with both sessions, and the host grafts the source (replacePage)', async () => {
    // THE HOST PATH FOR `sources: 'one'`, which no case drove before 2026-09-15. The live external-edit run failed
    // inside `engine/apply` with "This MuPDF session was not produced by this adapter, or it has already been closed"
    // at documentFor(source). `pageMerge.test.ts` proves the replace in-process; this proves it after crossing, so a
    // failure here is the host path and a pass sends the search to which session main sent.
    const { session, token, sourceSession, sourceToken, remote } = await joined(
      await pagesOfWidths([100, 110, 120]),
      await pagesOfWidths([200, 210]),
    );
    if (sourceSession === undefined || sourceToken === undefined) throw new Error('joined was given a source');
    try {
      await remote.apply({
        session: token,
        command: { kind: 'replacePage', source: asDocId('s'), version: asDocVersion(1), at: 1 },
        source: sourceToken,
        reads: undefined,
      });
      expect(await widthsOf(session)).toStrictEqual([100, 200, 210, 120]);
    } finally {
      await mupdfWriter.close(session);
      await mupdfWriter.close(sourceSession);
    }
  });

  it('THE ROUND TRIP: an applied command changes the document the HOST holds', async () => {
    const { session, token, remote } = await joined();
    try {
      expect(await rotationOf(session)).toBeNull();

      await remote.apply({ session: token, command: rotateFirst, source: undefined, reads: undefined });

      // The claim, and it is about the host's copy of `declaredSpecs` rather
      // than about the wire: nothing main-side touched this document.
      expect(await rotationOf(session)).toBe(90);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('the GEOMETRY read crosses and reports the page tree the host holds', async () => {
    const { session, token, geometry } = await joined();
    try {
      const read = await geometry(token, ALL_PAGES);
      expect(read.pageCount).toBe(3);
      expect(read.rotations).toStrictEqual([0, 0, 0]);
      // The sizes cross the boundary with the rotations, one per page asked for.
      expect(read.sizes).toHaveLength(ALL_PAGES.length);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('the ACCESSIBILITY check crosses whole: every rule, and every human check beside them (ADR-0078)', async () => {
    const { session, token, accessibility } = await joined(tagged);
    try {
      const report = await accessibility(token);
      // THE HOST'S OWN ANSWER, not a fixture: the same report the check gives in this process.
      expect(report).toStrictEqual(await checkAccessibility(session));
      expect(report.rules.length).toBeGreaterThan(10);
      expect(report.humanChecks).toContain('reading-order');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('the TEXT read crosses under the NAME asked for, and the host composes the options', async () => {
    const { session, token, pageText } = await joined(tagged);
    try {
      const structure = await pageText(token, 0, 'structure');
      const substrate = await pageText(token, 0, 'substrate');

      // THE STRUCTURE READ carries the document's tags, in the tree's order.
      expect(parsePageStructure(structure).nodes.map((node) => node.role)).toStrictEqual([
        'Document',
        'P',
        'P',
      ]);
      expect(linesOf(parsePageText(structure)).map((line) => line.text)).toStrictEqual([
        'drawn second',
        'drawn first',
      ]);

      // AND THE SUBSTRATE READ of the same page carries none of them and follows
      // the stream. Without this half, a host that ignored the name and always
      // asked for `structured` would pass the half above.
      expect(parsePageStructure(substrate).nodes).toStrictEqual([]);
      expect(linesOf(parsePageText(substrate)).map((line) => line.text)).toStrictEqual([
        'drawn first',
        'drawn second',
      ]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('the TABLE read crosses under its name and finds the ruled grid whole (ADR-0073)', async () => {
    const { session, token, pageText } = await joined(ruled);
    try {
      const tables = parsePageTables(await pageText(token, 0, 'table'));
      const substrate = parsePageTables(await pageText(token, 0, 'substrate'));

      // THREE COLUMNS is the separating assertion: the table-hunt flag without
      // `vectors` finds this grid two columns wide (measured 2026-09-17), so a host
      // that composed the flag alone is red here rather than merely different.
      expect(
        tables.tables.map((table) => table.rows.map((row) => row.map((cell) => cell.lines.map((l) => l.text).join(' ')))),
      ).toStrictEqual([
        [
          ['Item', 'Qty', 'Price'],
          ['Bolt', '12', '0.45'],
        ],
      ]);
      // AND THE SUBSTRATE READ of the same page finds none, so the name decided it.
      expect(substrate.tables).toStrictEqual([]);
      expect(substrate.lines).toBe(tables.lines);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('the FILL read crosses, and joined to the table read it shades the header row and nothing else', async () => {
    const { session, token, pageText, pageFills } = await joined(shaded);
    try {
      // THE COMPOSITION ROOT'S JOIN, over the real host handlers and readers: two reads of one
      // page, joined in main. A fill read that crossed nothing would leave every cell plain.
      const tables = withCellFills(parsePageTables(await pageText(token, 0, 'table')).tables, await pageFills(token, 0));
      const grey = [0.85, 0.85, 0.85];
      expect(
        tables.map((table) => table.rows.map((row) => row.map((cell) => cell.fill?.map((v) => Math.round(v * 100) / 100) ?? null))),
      ).toStrictEqual([
        [
          [grey, grey, grey],
          [null, null, null],
        ],
      ]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: the unshaded grid crosses no fill at all', async () => {
    const { session, token, pageFills } = await joined(ruled);
    try {
      expect(await pageFills(token, 0)).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a read that is not one of the named two is refused, not handed to the engine', async () => {
    const { session, token, pageText } = await joined(tagged);
    try {
      // AN OPTION STRING, which is exactly what the closed set exists to keep off
      // the wire — and one MuPDF would accept, so a refusal here is the schema's
      // and not the engine's.
      await expect(pageText(token, 0, 'segment,structured' as never)).rejects.toThrow();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('THE CLAIM: a command that crossed moves the geometry the next read reports', async () => {
    const { session, token, remote, geometry } = await joined();
    try {
      // The before reading is what makes the after one mean something: without
      // it, `[90, 0, 0]` is satisfied by a fixture that already carried a
      // rotation, and this file's document is built by `pdf-lib` with no
      // `/Rotate` at all — which is exactly the shape that would make it so.
      expect((await geometry(token, ALL_PAGES)).rotations).toStrictEqual([0, 0, 0]);

      await remote.apply({ session: token, command: rotateFirst, source: undefined, reads: undefined });

      // FINDING OOOOO-1 ANSWERED. Main's canonical image is unchanged by that
      // apply — a `DocumentRecord`'s bytes are `readonly` — so this is the only
      // route by which the rotation can reach anything main hands the renderer.
      // A view model that read main's bytes would report `[0, 0, 0]` here and be
      // wrong in the one direction nothing else observes.
      expect((await geometry(token, ALL_PAGES)).rotations).toStrictEqual([90, 0, 0]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('the PAGE LIST crosses, so the answer describes the pages this side asked about', async () => {
    const { session, token, remote, geometry } = await joined();
    try {
      await remote.apply({ session: token, command: rotateFirst, source: undefined, reads: undefined });

      // EVERY OTHER GEOMETRY CASE HERE NAMES ALL THREE PAGES IN ORDER, which is
      // the one request an adapter that ignored the list would also produce. So
      // this one asks out of order and short: `[2, 0]` separates a list that
      // crossed from a list that was rebuilt on the far side, and the rotate
      // above is what makes the two entries differ — against a flat document
      // both answers are `[0, 0]`.
      const named = await geometry(token, [2, 0]);
      expect({ pageCount: named.pageCount, rotations: named.rotations }).toStrictEqual({ pageCount: 3, rotations: [0, 90] });
      expect(named.sizes).toHaveLength(2);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a session the host has forgotten is a declared miss, not an empty geometry', async () => {
    const { session, sessions, geometry } = await joined();
    try {
      // A zero-page answer and a missing session are the same news to anything
      // that only checks `rotations.length`, and the reassuring one is the empty
      // reading — a document with no pages needs no rotations. The declared code
      // is what separates them, and it is the one the supervisor rebuilds for.
      await expect(geometry(sessions.adopt('gone', AREA), ALL_PAGES)).rejects.toBeInstanceOf(
        EngineSessionGone,
      );
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('and CAPTURE returns exactly what the local half returns for the same document', async () => {
    const { session, token, remote } = await joined();
    try {
      const overWire = await remote.capture(token, rotateFirst);
      const inProcess = await localMupdfExecution.capture(session, rotateFirst);

      // B3a's claim made checkable: one implementation, two routes to it. A
      // second remote `capture` — the candidate Decision 10 rejected — would
      // agree here most of the time, which is precisely why the assertion is
      // equality against the local half rather than against a literal.
      expect(overWire).toStrictEqual(inProcess);
      expect(overWire).toStrictEqual({
        captured: true,
        prior: [{ page: 0, prior: { present: false } }],
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('and INVERT restores prior state through the same route', async () => {
    const { session, token, remote } = await joined();
    try {
      const captured = await remote.capture(token, rotateFirst);
      if (!captured.captured) throw new Error('the fixture must capture');
      await remote.apply({ session: token, command: rotateFirst, source: undefined, reads: undefined });
      expect(await rotationOf(session)).toBe(90);

      await remote.invert(token, 'rotatePages', captured.prior);

      // §3: prior state restored VERBATIM, including absence. The page
      // inherited, so the inverse DELETES the key — a reversing rotation would
      // leave a `0` here and render identically, which is the whole reason §3
      // is written the way it is.
      expect(await rotationOf(session)).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a session the host does not hold is a DECLARED failure, and nothing is applied', async () => {
    const { session, remote, sessions } = await joined();
    try {
      const stranger = sessions.adopt('h-does-not-exist', AREA);

      await expect(
        remote.apply({ session: stranger, command: rotateFirst, source: undefined, reads: undefined }),
      ).rejects.toThrow(EngineSessionGone);

      // Declared, not `internal`: the supervisor rebuilds on this and cannot
      // decide that from an opaque code. Asserting the CLASS is what separates
      // the two, since both arrive as a rejection.
      expect(await rotationOf(session)).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a token this registry never adopted is refused BEFORE the wire', async () => {
    const { session, remote, requests } = await joined();
    try {
      const forged = { engine: 'mupdf' } as MupdfSession;
      const before = requests();

      await expect(
        remote.apply({ session: forged, command: rotateFirst, source: undefined, reads: undefined }),
      ).rejects.toThrow(UnknownRemoteSession);

      // The count is the whole assertion. A forged token refused by the HOST
      // and one refused HERE both reject, and only the request count tells them
      // apart — which is the property 10b is about: main holds a token whose
      // meaning is membership of this map, not a string it can invent.
      expect(requests()).toBe(before);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a released token stops working, though it is still a valid token', async () => {
    const { session, token, remote, sessions } = await joined();
    try {
      sessions.release(token);

      // What a brand cannot express: this object was minted by the registry and
      // is still structurally a `MupdfSession`. Only map membership separates a
      // live token from a spent one.
      await expect(
        remote.apply({ session: token, command: rotateFirst, source: undefined, reads: undefined }),
      ).rejects.toThrow(UnknownRemoteSession);
      expect(await rotationOf(session)).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a handler that throws is reported as an incident, never as a declared code', async () => {
    const session = await mupdfWriter.open(flat);
    const incidents: Incident[] = [];
    const wrapped = wrapHandlers(
      engineChannels,
      createEngineHandlers({
        sessions: {
          lookup: () => ({ session, outputDirectory: 'unused', snapshotDirectory: 'unused' }),
          issue: () => {
            throw new Error('unused');
          },
          forget: () => {
            throw new Error('unused');
          },
        },
        execution: {
          ...localMupdfExecution,
          apply: () => Promise.reject(new Error('the engine faulted')),
        },
        writer: {
          open: () => {
            throw new Error('unused');
          },
          serialise: () => {
            throw new Error('unused');
          },
          close: () => {
            throw new Error('unused');
          },
        },
        access: () => {
          throw new Error('unused');
        },
        signatures: () => {
          throw new Error('unused');
        },
        files: {
          readSnapshot: () => {
            throw new Error('unused');
          },
          writeOutput: () => {
            throw new Error('unused');
          },
        },
        probe: () => {
          throw new Error('unused');
        },
        geometry: () => {
          throw new Error('unused');
        },
        pageText: () => {
          throw new Error('unused');
        },
        pageLinks: () => {
          throw new Error('unused');
        },
        pageFills: () => {
          throw new Error('unused');
        },
        ocr: () => {
          throw new Error('unused');
        },
        destinations: () => {
          throw new Error('unused');
        },
        layers: () => {
          throw new Error('unused');
        },
        annotations: () => {
          throw new Error('unused');
        },
        formFields: () => {
          throw new Error('unused');
        },
        duplicates: () => {
          throw new Error('unused');
        },
        extract: () => {
          throw new Error('unused');
        },
        snapshot: () => {
          throw new Error('unused');
        },
        exportFormData: () => {
          throw new Error('unused');
        },
        pageImage: () => {
          throw new Error('unused');
        },
        flatFields: () => {
          throw new Error('unused');
        },
        barcodes: () => {
          throw new Error('unused');
        },
        exportAnnotationData: () => {
          throw new Error('unused');
        },
        accessibility: () => {
          throw new Error('unused');
        },
        annotationRecords: () => {
          throw new Error('unused');
        },
      }),
      (incident) => incidents.push(incident),
    );
    const sessions = createRemoteSessions();
    const client = createClient(engineChannels, async (id, params) => wrapped[id](params));
    const remote = remoteMupdfExecution(client, sessions, NO_ASSETS);

    try {
      await expect(
        remote.apply({
          session: sessions.adopt('h1', AREA),
          command: rotateFirst,
          source: undefined,
          reads: undefined,
        }),
      ).rejects.toThrow(
        /engine\/apply/u,
      );

      // The diagnostic stays this side of the boundary and the renderer-facing
      // code is `internal` — so a fault cannot be mistaken for `no-such-session`
      // and answered with a rebuild that would fault again.
      expect(incidents).toHaveLength(1);
      expect(JSON.stringify(incidents[0]?.diagnostic)).toMatch(/the engine faulted/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a rotation that is NOT a quarter turn is refused at the boundary, not drawn', async () => {
    // The schema's `refine` is what says a host that stopped snapping cannot
    // reach a viewport, and nothing exercised it: every geometry answer in this
    // file comes from `readPageGeometry`, which snaps. A guard whose only input
    // is a correct one is a guard nobody has seen work.
    //
    // 45 rather than a wild number, because 45 is what documents in the wild
    // actually carry (ADR-0009 §3) and it is the value MuPDF renders as 90 —
    // so it is the one a caller would draw half a quarter turn wrong.
    const session = await mupdfWriter.open(flat);
    const incidents: Incident[] = [];
    const wrapped = wrapHandlers(
      engineChannels,
      createEngineHandlers({
        sessions: {
          lookup: () => ({ session, outputDirectory: 'unused', snapshotDirectory: 'unused' }),
          issue: () => {
            throw new Error('unused');
          },
          forget: () => {
            throw new Error('unused');
          },
        },
        execution: localMupdfExecution,
        writer: mupdfWriter,
        access: accessFor,
        signatures: readSignatures,
        files: {
          readSnapshot: () => {
            throw new Error('unused');
          },
          writeOutput: () => {
            throw new Error('unused');
          },
        },
        probe: () => {
          throw new Error('unused');
        },
        // The page decides, so one harness carries the case and its control:
        // page 0 answers a raw 45 and page 1 a legal quarter turn.
        geometry: (_held, pages) =>
          Promise.resolve({
            pageCount: 3,
            rotations: pages.map((page) => (page === 0 ? 45 : 90)),
            sizes: pages.map(() => ({ width: 612, height: 792 })),
          }),
        pageText: () => {
          throw new Error('the rotation-refusal case must not read page text');
        },
        pageLinks: () => {
          throw new Error('the rotation-refusal case must not read page links');
        },
        pageFills: () => {
          throw new Error('the rotation-refusal case must not read page fills');
        },
        ocr: () => {
          throw new Error('the rotation-refusal case must not recognise anything');
        },
        destinations: () => {
          throw new Error('the rotation-refusal case must not read the outline');
        },
        layers: () => {
          throw new Error('the rotation-refusal case must not read the layers');
        },
        annotations: () => {
          throw new Error('the rotation-refusal case must not list annotations');
        },
        formFields: () => {
          throw new Error('the rotation-refusal case must not list form fields');
        },
        duplicates: () => {
          throw new Error('the rotation-refusal case must not look for duplicates');
        },
        extract: () => {
          throw new Error('the rotation-refusal case must not build a document');
        },
        snapshot: () => {
          throw new Error('the rotation-refusal case must not rasterise a page');
        },
        exportFormData: () => {
          throw new Error('the rotation-refusal case must not export form data');
        },
        pageImage: () => {
          throw new Error('the rotation-refusal case must not export a page image');
        },
        flatFields: () => {
          throw new Error('the rotation-refusal case must not propose fields');
        },
        barcodes: () => {
          throw new Error('the rotation-refusal case must not read barcodes');
        },
        exportAnnotationData: () => {
          throw new Error('the rotation-refusal case must not export annotations');
        },
        accessibility: () => {
          throw new Error('the rotation-refusal case must not check accessibility');
        },
        annotationRecords: () => {
          throw new Error('the rotation-refusal case must not read annotation records');
        },
      }),
      (incident) => incidents.push(incident),
    );
    const sessions = createRemoteSessions();
    const client = createClient(engineChannels, async (id, params) => wrapped[id](params));
    const geometry = remoteMupdfGeometry(client, sessions);

    try {
      const token = sessions.adopt('h1', AREA);
      await expect(geometry(token, [0])).rejects.toThrow(/engine\/page-geometry/u);
      expect(incidents).toHaveLength(1);

      // CONTROL: the same harness, the same channel, a legal value. Without it
      // this case is satisfied by a boundary that refuses every geometry answer
      // — which would be invisible here and would blank the renderer in the
      // product.
      expect(await geometry(token, [1])).toStrictEqual({
        pageCount: 3,
        rotations: [90],
        sizes: [{ width: 612, height: 792 }],
      });
      expect(incidents).toHaveLength(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
