import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from './accessibilityCheck.js';
import { type AccessibilityVerdict, HUMAN_CHECKS } from './accessibilityRules.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * The PDF/UA-1 object rules against documents built with pdf-lib, a writer that is not the one
 * reading them. Each fixture is made to separate one set of rules: a bare document fails the
 * document rules and passes nothing by accident; a prepared one passes them; a broken structure
 * fails the structure rules only; a widget and a structured annotation reach the two branches the
 * object model cannot decide.
 */

const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<pdfuaid:part>1</pdfuaid:part>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Quarterly report</rdf:li></rdf:Alt></dc:title>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;

/** The fixtures, by name, as bytes — exported so a comparison against veraPDF reads the same files. */
export async function accessibilityFixtures(): Promise<Record<'bare' | 'prepared' | 'brokenStructure' | 'undecidable', Uint8Array>> {
  // BARE: text in an unembedded standard font, a square with no Contents, a link with no Contents.
  const bare = await PDFDocument.create();
  const barePage = bare.addPage([400, 400]);
  barePage.drawText('Hello', { x: 50, y: 300, size: 18, font: await bare.embedFont(StandardFonts.Helvetica) });
  const square = bare.context.register(bare.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 60, 60] }));
  const link = bare.context.register(
    bare.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [100, 10, 160, 30], Border: [0, 0, 0] }),
  );
  barePage.node.set(PDFName.of('Annots'), bare.context.obj([square, link]));

  // PREPARED: every document rule met, a mapped custom type, a figure with Alt, annotations described.
  const prepared = await PDFDocument.create();
  const preparedPage = prepared.addPage([400, 400]);
  const { context } = prepared;
  const pageRef = prepared.getPage(0).ref;
  const describedSquare = context.register(
    context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 60, 60], Contents: PDFString.of('A box') }),
  );
  const describedLink = context.register(
    context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [100, 10, 160, 30], Border: [0, 0, 0], Contents: PDFString.of('Home') }),
  );
  preparedPage.node.set(PDFName.of('Annots'), context.obj([describedSquare, describedLink]));
  preparedPage.node.set(PDFName.of('Tabs'), PDFName.of('S'));
  const figure = context.register(context.obj({ Type: 'StructElem', S: 'Figure', Alt: PDFHexString.fromText('A chart'), Pg: pageRef }));
  const custom = context.register(context.obj({ Type: 'StructElem', S: 'Custom', Pg: pageRef }));
  const documentElement = context.register(context.obj({ Type: 'StructElem', S: 'Document', K: [figure, custom] }));
  const treeRoot = context.register(context.obj({ Type: 'StructTreeRoot', K: documentElement, RoleMap: { Custom: 'P' } }));
  const metadata = context.register(
    context.stream(XMP, { Type: 'Metadata', Subtype: 'XML' }),
  );
  prepared.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));
  prepared.catalog.set(PDFName.of('StructTreeRoot'), treeRoot);
  prepared.catalog.set(PDFName.of('Metadata'), metadata);
  prepared.catalog.set(PDFName.of('ViewerPreferences'), context.obj({ DisplayDocTitle: true }));
  prepared.catalog.set(PDFName.of('Lang'), PDFString.of('en'));

  // BROKEN STRUCTURE: a figure with no Alt, and a type nothing maps.
  const broken = await PDFDocument.create();
  broken.addPage([400, 400]);
  const brokenPage = broken.getPage(0).ref;
  const bareFigure = broken.context.register(broken.context.obj({ Type: 'StructElem', S: 'Figure', Pg: brokenPage }));
  const weird = broken.context.register(broken.context.obj({ Type: 'StructElem', S: 'Weird', Pg: brokenPage }));
  const brokenRoot = broken.context.register(broken.context.obj({ Type: 'StructTreeRoot', K: [bareFigure, weird] }));
  broken.catalog.set(PDFName.of('StructTreeRoot'), brokenRoot);
  broken.catalog.set(PDFName.of('MarkInfo'), broken.context.obj({ Marked: true }));

  // UNDECIDABLE: an annotation without Contents that sits in the structure, and a field with no TU.
  const undecidable = await PDFDocument.create();
  const fieldPage = undecidable.addPage([400, 400]);
  undecidable.getForm().createTextField('name').addToPage(fieldPage, { x: 20, y: 300, width: 150, height: 20 });
  const structured = undecidable.context.register(
    undecidable.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 60, 60], StructParent: 0 }),
  );
  const annots = fieldPage.node.Annots();
  annots?.push(structured);

  return {
    bare: await bare.save(),
    prepared: await prepared.save(),
    brokenStructure: await broken.save(),
    undecidable: await undecidable.save(),
  };
}

async function verdicts(bytes: Uint8Array): Promise<Record<string, AccessibilityVerdict>> {
  const session = await mupdfWriter.open(bytes);
  try {
    const report = await checkAccessibility(session);
    expect(report.humanChecks).toStrictEqual(HUMAN_CHECKS);
    return Object.fromEntries(report.rules.map((rule) => [`${rule.clause}-${String(rule.test)}`, rule.verdict]));
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('checkAccessibility — PDF/UA-1 object rules, and what they cannot see', () => {
  it('a bare document fails every document rule, its annotations and its unembedded font', async () => {
    const { bare } = await accessibilityFixtures();
    expect(await verdicts(bare)).toStrictEqual({
      // RULES ON THE XMP PACKAGE, which this document does not have: 7.1-8 fails instead, as
      // veraPDF reports it (compared on these fixtures and the corpus, 2026-09-17).
      '5-1': 'not-applicable',
      '6.2-1': 'failed',
      '7.1-4': 'passed',
      '7.1-8': 'failed',
      '7.1-9': 'not-applicable',
      '7.1-10': 'failed',
      '7.1-11': 'failed',
      '7.1-5': 'not-applicable',
      '7.3-1': 'not-applicable',
      '7.16-1': 'not-applicable',
      '7.18.1-2': 'failed',
      '7.18.1-3': 'not-applicable',
      '7.18.3-1': 'failed',
      '7.18.5-2': 'failed',
      '7.21.4.1-1': 'failed',
    });
  });

  it('CONTROL: the prepared document passes each of them', async () => {
    const { prepared } = await accessibilityFixtures();
    expect(await verdicts(prepared)).toStrictEqual({
      '5-1': 'passed',
      '6.2-1': 'passed',
      '7.1-4': 'passed',
      '7.1-8': 'passed',
      '7.1-9': 'passed',
      '7.1-10': 'passed',
      '7.1-11': 'passed',
      '7.1-5': 'passed',
      '7.3-1': 'passed',
      '7.16-1': 'not-applicable',
      '7.18.1-2': 'passed',
      '7.18.1-3': 'not-applicable',
      '7.18.3-1': 'passed',
      '7.18.5-2': 'passed',
      '7.21.4.1-1': 'not-applicable',
    });
  });

  it('a figure with no Alt and an unmapped type fail the structure rules, and name their page', async () => {
    const { brokenStructure } = await accessibilityFixtures();
    const session = await mupdfWriter.open(brokenStructure);
    try {
      const report = await checkAccessibility(session);
      expect(report.rules.filter((rule) => rule.clause === '7.1' && rule.test === 5 || rule.clause === '7.3')).toStrictEqual([
        { clause: '7.1', test: 5, verdict: 'failed', count: 1, pages: [0] },
        { clause: '7.3', test: 1, verdict: 'failed', count: 1, pages: [0] },
      ]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('an annotation in the structure with no Contents is NOT DETERMINED, never passed; a field with no TU and no structure fails', async () => {
    const { undecidable } = await accessibilityFixtures();
    const found = await verdicts(undecidable);
    expect(found['7.18.1-2']).toBe('not-determined');
    expect(found['7.18.1-3']).toBe('failed');
    // THE FIELD'S FONT IS REACHED ONLY THROUGH ITS WIDGET'S APPEARANCE, and it is not embedded.
    expect(found['7.21.4.1-1']).toBe('failed');
  });

  it('XMP present without the identification or a title fails those two rules', async () => {
    const document = await PDFDocument.create();
    document.addPage([200, 200]);
    const bareXmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>';
    document.catalog.set(PDFName.of('Metadata'), document.context.register(document.context.stream(bareXmp, { Type: 'Metadata', Subtype: 'XML' })));
    const found = await verdicts(await document.save());
    expect([found['5-1'], found['7.1-8'], found['7.1-9']]).toStrictEqual(['failed', 'passed', 'failed']);
  });
});
