import type { CommandKind } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { declaredCommands } from './commandDeclarations.js';
import { allowedByCertification, breaksSignatures } from './signatureKeeping.js';

/** Every declared kind, read from the declarations so a kind added tomorrow is classified here too. */
const KINDS = Object.keys(declaredCommands) as CommandKind[];

describe('breaksSignatures (ADR-0149)', () => {
  it('names exactly PDFium’s five edits and the four removals — an independent list, so a kind that moves fails here', () => {
    // THE ANCHOR IS WRITTEN OUT, never derived from the rule it checks: a list computed by the same predicate agrees
    // with any mistake in it (audit item 4c).
    const expected = [
      'applyRedactions',
      'editTextBlock',
      'flattenFormFields',
      'promoteFormObjects',
      'replaceAllText',
      // ONE WORD REPLACED IS A PDFIUM EDIT, so the page is regenerated and the document rewritten whole (ADR-0156).
      'replaceTextAt',
      'replaceTextObject',
      'sanitizeDocument',
      'setDocumentProtection',
    ];
    expect(KINDS.filter(breaksSignatures).sort()).toStrictEqual(expected);
  });

  it('CONTROL: an ordinary MuPDF edit, a pdf-lib command and a signature keep a signature', () => {
    for (const kind of ['rotatePages', 'addAnnotation', 'watermarkPages', 'generateToc', 'signDocument'] as const) {
      expect(breaksSignatures(kind), kind).toBe(false);
    }
  });
});

describe('allowedByCertification (ADR-0291 Decision 2)', () => {
  // THE ANCHORS ARE WRITTEN OUT, as above: a list computed by the rule it checks agrees with any mistake in it.
  const FILLS = ['fillFormField', 'importFormData', 'resetForm', 'resetWholeForm'];
  const SIGNS = ['signDocument'];
  const ANNOTATES = [
    'addAnnotation',
    'addLink',
    'editAnnotationText',
    'editLink',
    'importAnnotations',
    'markMatchesForRedaction',
    'placeAnnotation',
    'placeImage',
    'placeSignatureMark',
    'placeSignaturePicture',
    'removeAnnotation',
    'replyToAnnotation',
    'reshapeAnnotation',
    'setAnnotationAuthor',
    'setLinkOutline',
    'styleAnnotation',
  ];

  it('no changes allows nothing at all', () => {
    expect(KINDS.filter((kind) => allowedByCertification(kind, 'no-changes'))).toStrictEqual([]);
  });

  it('form filling and signing allows exactly the value commands and the signature', () => {
    expect(KINDS.filter((kind) => allowedByCertification(kind, 'form-fill')).sort()).toStrictEqual([...FILLS, ...SIGNS].sort());
  });

  it('form filling, signing and comments adds exactly the annotation commands', () => {
    expect(KINDS.filter((kind) => allowedByCertification(kind, 'form-fill-and-annotate')).sort()).toStrictEqual([...FILLS, ...SIGNS, ...ANNOTATES].sort());
  });

  it('CONTROL: a document with no certification allows every kind, and a field’s definition is never a fill', () => {
    expect(KINDS.filter((kind) => allowedByCertification(kind, null))).toStrictEqual(KINDS);
    for (const kind of ['editFormFields', 'createFormField', 'showHideFields', 'flattenFormFields', 'deleteFormFields'] as const) {
      expect(allowedByCertification(kind, 'form-fill-and-annotate'), kind).toBe(false);
    }
  });

  it('every kind a level allows keeps the signatures, so an allowed change never reaches ADR-0149’s question', () => {
    const allowed = KINDS.filter((kind) => allowedByCertification(kind, 'form-fill-and-annotate'));
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed.filter(breaksSignatures)).toStrictEqual([]);
  });
});
