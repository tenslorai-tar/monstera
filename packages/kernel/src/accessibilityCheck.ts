import type { PDFDocument, PDFObject } from 'mupdf';

import {
  type AccessibilityReport,
  type AccessibilityRuleResult,
  HUMAN_CHECKS,
  MAX_REPORTED_PAGES,
} from './accessibilityRules.js';
import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';

/**
 * D8's *accessibility check*: the PDF/UA-1 rules a machine can decide from a document's objects,
 * and the ones only a person can, said as such
 * ([ADR-0078](../../../docs/DECISIONS/0078-the-accessibility-check-is-pdf-ua-object-rules-and-names-what-it-cannot-see.md)).
 *
 * ## Each rule is veraPDF's, keyed to its clause and test number
 *
 * The rules and their conditions are taken from veraPDF's PDF/UA-1 validation profile
 * (`veraPDF-validation-profiles`, `PDF_UA/PDFUA-1.xml` at commit `e462c0a7`, 2026-05-30), which
 * is ISO 14289-1's machine-checkable part written as tests. veraPDF itself validates in
 * development and never ships (the owner's answer, 2026-09-16), so this module answers the subset
 * that MuPDF's object model can decide. Compared with veraPDF 1.30.2 on this file's test fixtures
 * and the eleven corpus documents (2026-09-17): 222 verdicts agree, none disagree, 3 not
 * determined — after two corrections the comparison found, recorded in ADR-0078.
 *
 * ## Four verdicts, and none of them is "accessible"
 *
 * `passed`, `failed`, `not-applicable` (a figure rule on a document with no figures), and
 * `not-determined` — where the object model cannot decide what veraPDF's test reads, such as an
 * annotation with no `/Contents` whose alternative text may be on a structure element. A
 * `not-determined` is never counted as a pass, and the report carries the human checks beside
 * the machine ones so an empty failure list cannot read as conformance.
 */


/** ISO 32000-1's standard structure types (14.8.4), which need no role map. */
const STANDARD_TYPES = new Set([
  'Document', 'Part', 'Art', 'Sect', 'Div', 'BlockQuote', 'Caption', 'TOC', 'TOCI', 'Index',
  'NonStruct', 'Private', 'P', 'H', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'L', 'LI', 'Lbl', 'LBody',
  'Table', 'TR', 'TH', 'TD', 'THead', 'TBody', 'TFoot', 'Span', 'Quote', 'Note', 'Reference',
  'BibEntry', 'Code', 'Link', 'Annot', 'Ruby', 'RB', 'RT', 'RP', 'Warichu', 'WT', 'WP', 'Figure',
  'Formula', 'Form',
]);

/** How many structure elements one walk visits before the structure rules answer `not-determined`. */
const MAX_STRUCTURE_ELEMENTS = 200_000;

/** How deep a Form XObject's resources are followed when looking for fonts. */
const MAX_XOBJECT_DEPTH = 8;

/** The whole report for a document. */
export function checkAccessibility(session: MupdfSession): Promise<AccessibilityReport> {
  return withDocument(session, (document) => {
    const catalog = document.getTrailer().get('Root');
    const rules: AccessibilityRuleResult[] = [];
    const whole = (clause: string, test: number, passed: boolean): void => {
      rules.push({ clause, test, verdict: passed ? 'passed' : 'failed', count: passed ? 0 : 1, pages: [] });
    };

    const metadata = metadataText(catalog);
    // 5-1 AND 7.1-9 ARE RULES ON THE XMP PACKAGE, so with no metadata stream there is nothing for
    // them to test and they do not apply — 7.1-8 is the rule that fails. Measured 2026-09-17: veraPDF
    // reports neither on a document with no XMP, and failing them here disagreed on 11 files.
    const onXmp = (clause: string, test: number, passed: (xmp: string) => boolean): void => {
      if (metadata === null) rules.push({ clause, test, verdict: 'not-applicable', count: 0, pages: [] });
      else whole(clause, test, passed(metadata));
    };
    // 5-1: `containsPDFUAIdentification`. The identification schema's `part`, as an element or
    // an attribute — the two forms RDF/XML writes a simple property in.
    onXmp('5', 1, (xmp) => /pdfuaid:part(?:\s*=\s*["']\d+["']|\s*>\s*\d+\s*<)/u.test(xmp));
    // 6.2-1: `Marked == true`.
    const markInfo = catalog.get('MarkInfo');
    whole('6.2', 1, markInfo.isDictionary() && isTrue(markInfo.get('Marked')));
    // 7.1-4: `Suspects != true`.
    whole('7.1', 4, !(markInfo.isDictionary() && isTrue(markInfo.get('Suspects'))));
    // 7.1-8: `containsMetadata`.
    whole('7.1', 8, metadata !== null);
    // 7.1-9: `dc_title != null`.
    onXmp('7.1', 9, (xmp) => /<dc:title[\s>]/u.test(xmp));
    // 7.1-10: `DisplayDocTitle == true`.
    const preferences = catalog.get('ViewerPreferences');
    whole('7.1', 10, preferences.isDictionary() && isTrue(preferences.get('DisplayDocTitle')));
    // 7.1-11: `containsStructTreeRoot`.
    const treeRoot = catalog.get('StructTreeRoot');
    whole('7.1', 11, treeRoot.isDictionary());

    // A STRUCTURE ELEMENT NAMES ITS PAGE BY OBJECT (`/Pg`), so the walk is given the index of each.
    const pageIndexOf = new Map<number, number>();
    for (let index = 0; index < document.countPages(); index += 1) {
      const page = document.findPage(index);
      if (page.isIndirect()) pageIndexOf.set(page.asIndirect(), index);
    }
    rules.push(...structureRules(treeRoot, pageIndexOf));

    // 7.16-1: `P != null && (P & 512) == 512`, for an encrypted file only.
    const encryption = document.getTrailer().get('Encrypt');
    if (encryption.isDictionary()) {
      const permissions = encryption.get('P');
      whole('7.16', 1, permissions.isNumber() && (permissions.asNumber() & 512) === 512);
    } else {
      rules.push({ clause: '7.16', test: 1, verdict: 'not-applicable', count: 0, pages: [] });
    }

    rules.push(...pageRules(document));
    return { rules, humanChecks: HUMAN_CHECKS };
  });
}

function isTrue(value: PDFObject): boolean {
  return value.isBoolean() && value.asBoolean();
}

function textOf(value: PDFObject): string {
  return value.isString() ? value.asString() : '';
}

/** The catalog's XMP as text, or `null` where there is no metadata stream. */
function metadataText(catalog: PDFObject): string | null {
  const stream = catalog.get('Metadata');
  if (!stream.isStream()) return null;
  return stream.readStream().asString();
}

/**
 * 7.1-5 (every non-standard type maps to a standard one) and 7.3-1 (a Figure has `Alt` or
 * `ActualText`), from one walk of the structure tree.
 */
function structureRules(treeRoot: PDFObject, pageIndexOf: ReadonlyMap<number, number>): AccessibilityRuleResult[] {
  if (!treeRoot.isDictionary()) {
    return [
      { clause: '7.1', test: 5, verdict: 'not-applicable', count: 0, pages: [] },
      { clause: '7.3', test: 1, verdict: 'not-applicable', count: 0, pages: [] },
    ];
  }
  const roleMap = treeRoot.get('RoleMap');
  const standardFor = (type: string): string | null => {
    let current = type;
    for (let step = 0; step < 16; step += 1) {
      if (STANDARD_TYPES.has(current)) return current;
      const mapped = roleMap.isDictionary() ? roleMap.get(current) : null;
      if (!mapped?.isName()) return null;
      current = mapped.asName();
    }
    return null;
  };

  let unmapped = 0;
  let figures = 0;
  let figuresWithoutAlt = 0;
  const unmappedPages: number[] = [];
  const figurePages: number[] = [];
  const seen = new Set<number>();
  const stack: PDFObject[] = [treeRoot.get('K')];
  let visited = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node.isArray()) {
      for (let index = 0; index < node.length; index += 1) stack.push(node.get(index));
      continue;
    }
    if (!node.isDictionary()) continue;
    if (node.isIndirect()) {
      const number = node.asIndirect();
      if (seen.has(number)) continue;
      seen.add(number);
    }
    const type = node.get('S');
    if (!type.isName()) continue;
    visited += 1;
    if (visited > MAX_STRUCTURE_ELEMENTS) {
      return [
        { clause: '7.1', test: 5, verdict: 'not-determined', count: 0, pages: [] },
        { clause: '7.3', test: 1, verdict: 'not-determined', count: 0, pages: [] },
      ];
    }
    const standard = standardFor(type.asName());
    if (standard === null) {
      unmapped += 1;
      notePage(unmappedPages, node, pageIndexOf);
    }
    if (standard === 'Figure') {
      figures += 1;
      const alt = textOf(node.get('Alt'));
      if (alt === '' && !node.get('ActualText').isString()) {
        figuresWithoutAlt += 1;
        notePage(figurePages, node, pageIndexOf);
      }
    }
    stack.push(node.get('K'));
  }
  return [
    { clause: '7.1', test: 5, verdict: unmapped === 0 ? 'passed' : 'failed', count: unmapped, pages: unmappedPages },
    {
      clause: '7.3',
      test: 1,
      verdict: figures === 0 ? 'not-applicable' : figuresWithoutAlt === 0 ? 'passed' : 'failed',
      count: figuresWithoutAlt,
      pages: figurePages,
    },
  ];
}

/** Records an element's page index, from its `/Pg`, while the list has room. An element without one names no page. */
function notePage(pages: number[], element: PDFObject, pageIndexOf: ReadonlyMap<number, number>): void {
  if (pages.length >= MAX_REPORTED_PAGES) return;
  const page = element.get('Pg');
  if (!page.isIndirect()) return;
  const index = pageIndexOf.get(page.asIndirect());
  if (index !== undefined && !pages.includes(index)) pages.push(index);
}

/**
 * The page rules: 7.18.3-1 (`/Tabs /S` on a page with annotations), 7.18.1-2 (an annotation's
 * alternative text), 7.18.1-3 (a widget's `TU`), 7.18.5-2 (a link's `Contents`) and 7.21.4.1-1
 * (embedded fonts).
 */
function pageRules(document: PDFDocument): AccessibilityRuleResult[] {
  const tally = (): { count: number; undetermined: number; pages: number[]; applicable: boolean } => ({
    count: 0,
    undetermined: 0,
    pages: [],
    applicable: false,
  });
  const tabs = tally();
  const annotationAlt = tally();
  const widgetTu = tally();
  const linkContents = tally();
  const fonts = tally();
  /** Each font's embedded-ness, and each form XObject's "reaches nothing unembedded", by object. */
  const fontsSeen = new Map<number, boolean>();
  /** Names a page an entry fails on, without counting a failure — a shared object seen again. */
  const blameAt = (entry: ReturnType<typeof tally>, page: number): void => {
    if (entry.pages.length < MAX_REPORTED_PAGES && !entry.pages.includes(page)) entry.pages.push(page);
  };
  const failAt = (entry: ReturnType<typeof tally>, page: number): void => {
    entry.count += 1;
    blameAt(entry, page);
  };
  /** An unembedded font met on `page`: counted the first time its object is seen, blamed every time. */
  const fontFailsAt = (page: number) => (firstSight: boolean): void => {
    if (firstSight) failAt(fonts, page);
    else blameAt(fonts, page);
  };

  const pages = document.countPages();
  for (let index = 0; index < pages; index += 1) {
    const page = document.findPage(index);
    const annotations = page.get('Annots');
    const hasAnnotations = annotations.isArray() && annotations.length > 0;
    if (hasAnnotations) {
      tabs.applicable = true;
      const order = page.get('Tabs');
      if (!(order.isName() && order.asName() === 'S')) failAt(tabs, index);
      for (let at = 0; at < annotations.length; at += 1) {
        const annotation = annotations.get(at);
        if (!annotation.isDictionary()) continue;
        // AN APPEARANCE STREAM RENDERS WITH ITS OWN FONTS: measured 2026-09-17, a form field's
        // Helvetica, reached only through its widget's `/AP /N`, is a failure to veraPDF.
        appearanceStreams(annotation.get('AP')).forEach((stream) => {
          collectFonts(stream.get('Resources'), 1, fontsSeen, () => {
            fonts.applicable = true;
          }, fontFailsAt(index));
        });
        const flags = annotation.get('F');
        if (flags.isNumber() && (flags.asNumber() & 2) === 2) continue;
        const subtype = annotation.get('Subtype').isName() ? annotation.get('Subtype').asName() : '';
        const hasContents = textOf(annotation.get('Contents')) !== '';
        const inStructure = annotation.get('StructParent').isNumber();
        if (subtype === 'Widget') {
          widgetTu.applicable = true;
          const field = fieldOf(annotation);
          if (textOf(field.get('TU')) !== '') continue;
          // THE ALT MAY BE ON THE ENCLOSING STRUCTURE ELEMENT, which this walk does not resolve.
          if (inStructure) widgetTu.undetermined += 1;
          else failAt(widgetTu, index);
          continue;
        }
        if (subtype === 'Link') {
          linkContents.applicable = true;
          if (!hasContents) failAt(linkContents, index);
        }
        annotationAlt.applicable = true;
        if (hasContents) continue;
        if (inStructure) annotationAlt.undetermined += 1;
        else failAt(annotationAlt, index);
      }
    }
    collectFonts(page.get('Resources'), 0, fontsSeen, () => {
      fonts.applicable = true;
    }, fontFailsAt(index));
  }

  const result = (clause: string, test: number, entry: ReturnType<typeof tally>): AccessibilityRuleResult => ({
    clause,
    test,
    verdict: !entry.applicable
      ? 'not-applicable'
      : entry.count > 0
        ? 'failed'
        : entry.undetermined > 0
          ? 'not-determined'
          : 'passed',
    count: entry.count > 0 ? entry.count : entry.undetermined,
    pages: entry.pages,
  });
  return [
    result('7.18.1', 2, annotationAlt),
    result('7.18.1', 3, widgetTu),
    result('7.18.3', 1, tabs),
    result('7.18.5', 2, linkContents),
    result('7.21.4.1', 1, fonts),
  ];
}

/** An appearance dictionary's streams: `/N`, `/R` and `/D`, each a stream or a dictionary of states. */
function appearanceStreams(appearance: PDFObject): PDFObject[] {
  if (!appearance.isDictionary()) return [];
  const streams: PDFObject[] = [];
  for (const key of ['N', 'R', 'D']) {
    const entry = appearance.get(key);
    if (entry.isStream()) streams.push(entry);
    else if (entry.isDictionary()) {
      entry.forEach((state: PDFObject) => {
        if (state.isStream()) streams.push(state);
      });
    }
  }
  return streams;
}

/** A widget's field: the widget itself when it carries `/T`, or its parent — the merged-dictionary rule. */
function fieldOf(widget: PDFObject): PDFObject {
  if (widget.get('T').isString()) return widget;
  const parent = widget.get('Parent');
  return parent.isDictionary() ? parent : widget;
}

/**
 * Every font a resource dictionary reaches, directly and through Form XObjects, each once.
 *
 * `renderingMode == 3` is veraPDF's exception for a font only used invisibly, which needs the
 * content stream; this reads resources, so a font declared and never drawn counts as used.
 */
function collectFonts(
  resources: PDFObject,
  depth: number,
  seen: Map<number, boolean>,
  found: () => void,
  unembedded: (firstSight: boolean) => void,
): boolean {
  if (!resources.isDictionary() || depth > MAX_XOBJECT_DEPTH) return false;
  // WHETHER ANYTHING REACHED FROM HERE IS UNEMBEDDED, so a shared form XObject can answer for a
  // second page without being walked — and without being counted — again.
  let anyUnembedded = false;
  const fonts = resources.get('Font');
  if (fonts.isDictionary()) {
    fonts.forEach((font: PDFObject) => {
      if (!font.isDictionary()) return;
      // A FONT SEEN BEFORE IS COUNTED ONCE AND BLAMED ON EVERY PAGE THAT USES IT. The count is
      // veraPDF's, one per font object; the pages are what a person fixes. This returned early
      // for a seen font, so a font shared by every page was reported on the first page alone —
      // measured live 2026-09-18, "Pages: 1" for a font used on pages 1 to 3.
      const number = font.isIndirect() ? font.asIndirect() : undefined;
      const known = number === undefined ? undefined : seen.get(number);
      if (known !== undefined) {
        if (!known) {
          anyUnembedded = true;
          unembedded(false);
        }
        return;
      }
      found();
      const subtype = font.get('Subtype').isName() ? font.get('Subtype').asName() : '';
      // A TYPE 0 FONT PASSES ITSELF and its descendant CIDFont is a font of its own to veraPDF,
      // whose program must be embedded — so the descendant's descriptor is the one read.
      const descendants = font.get('DescendantFonts');
      const program = subtype === 'Type0' && descendants.isArray() && descendants.length > 0 ? descendants.get(0) : font;
      const descriptor = program.isDictionary() ? program.get('FontDescriptor') : undefined;
      const embedded =
        subtype === 'Type3' ||
        !program.isDictionary() ||
        (descriptor !== undefined &&
          descriptor.isDictionary() &&
          (descriptor.get('FontFile').isStream() ||
            descriptor.get('FontFile2').isStream() ||
            descriptor.get('FontFile3').isStream()));
      if (number !== undefined) seen.set(number, embedded);
      if (!embedded) {
        anyUnembedded = true;
        unembedded(true);
      }
    });
  }
  const xobjects = resources.get('XObject');
  if (xobjects.isDictionary()) {
    xobjects.forEach((xobject: PDFObject) => {
      if (!xobject.isStream()) return;
      const subtype = xobject.get('Subtype');
      if (!(subtype.isName() && subtype.asName() === 'Form')) return;
      const number = xobject.isIndirect() ? -xobject.asIndirect() : undefined;
      const known = number === undefined ? undefined : seen.get(number);
      if (known !== undefined) {
        // `seen` holds EMBEDDED-ness for a font and "holds nothing unembedded" for a form, so
        // false means this form reaches an unembedded font: blame this page, count nothing.
        if (!known) {
          anyUnembedded = true;
          unembedded(false);
        }
        return;
      }
      if (number !== undefined) seen.set(number, true);
      const inner = collectFonts(xobject.get('Resources'), depth + 1, seen, found, unembedded);
      if (number !== undefined) seen.set(number, !inner);
      if (inner) anyUnembedded = true;
    });
  }
  return anyUnembedded;
}
