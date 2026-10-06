import type { CommandKind } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { declaredCommands } from './commandDeclarations.js';
import { breaksSignatures } from './signatureKeeping.js';

/** Every declared kind, read from the declarations so a kind added tomorrow is classified here too. */
const KINDS = Object.keys(declaredCommands) as CommandKind[];

describe('breaksSignatures (ADR-0149)', () => {
  it('names exactly PDFium’s eight edits and the four removals — an independent list, so a kind that moves fails here', () => {
    // THE ANCHOR IS WRITTEN OUT, never derived from the rule it checks: a list computed by the same predicate agrees
    // with any mistake in it (audit item 4c).
    const expected = [
      'applyRedactions',
      'deletePageObjects',
      'editTextBlock',
      'flattenFormFields',
      'placePageObject',
      'promoteFormObjects',
      'recolorPageObjects',
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
    for (const kind of ['rotatePages', 'addAnnotation', 'watermarkPages', 'insertImagePage', 'signDocument'] as const) {
      expect(breaksSignatures(kind), kind).toBe(false);
    }
  });
});
