import { describe, expect, it } from 'vitest';

import { declaredCommands } from './commandDeclarations.js';
import type { CommandPrior } from './commandLog.js';
import type { ByteImage, MupdfSession } from './engineSeam.js';
import { localMupdfExecution, mupdfSpecs } from './mupdfSpecs.js';
import { localPdfiumExecution, pdfiumSpecs } from './pdfiumSpecs.js';

/**
 * Each engine's own spec table, and the refusal of a command routed elsewhere (finding
 * LLLLLL-3, the audit of `e08a99f..3fab823`).
 *
 * `commandSpecs.ts` spreads these tables into the exhaustive view, and the contained hosts take
 * them directly so they load no other writer's library. Two things follow that only these
 * files decide: which kinds each table holds, and what happens when a command routed to another
 * writer reaches one. Neither was reached by any case until this file.
 */

/** Every kind a writer's declaration routes to it, from the one place a route is declared. */
function kindsRoutedTo(writer: string): readonly string[] {
  return Object.entries(declaredCommands)
    .filter(([, declaration]) => declaration.writer === writer)
    .map(([kind]) => kind)
    .sort();
}

describe('the MuPDF table', () => {
  it('holds exactly the kinds declared for MuPDF, compared from both sides', () => {
    // SET EQUALITY, not iteration over one: a kind declared for MuPDF and missing here, and a kind
    // here declared for another writer, both fail — iterating either list would make it the
    // universe and hide the other's extra.
    expect(Object.keys(mupdfSpecs).sort()).toStrictEqual(kindsRoutedTo('mupdf'));
    expect(kindsRoutedTo('mupdf').length).toBeGreaterThan(0);
  });

  it('refuses a command routed to another writer by NAME, rather than calling an undefined apply', () => {
    // THROUGH A CAST, because the parameter type already refuses the call (B5): the runtime
    // refusal is what stands behind the type for a caller that escaped it, and a cast is the
    // only way to write that caller.
    const session = {} as unknown as MupdfSession;
    const elsewhere = 'replaceAllText' as unknown as 'rotatePages';
    expect(() =>
      localMupdfExecution.invert(session, elsewhere, {} as CommandPrior['rotatePages']),
    ).toThrow(/replaceAllText is not routed to MuPDF/u);
  });

  it('CONTROL: a MuPDF kind passes the routing check and reaches its own invert', async () => {
    // The kind is MuPDF's, so the lookup succeeds and the call reaches the implementation — which
    // fails on an empty session for its own reason. What must NOT appear is the routing refusal,
    // or the case above passes for a lookup that refuses everything.
    const session = {} as unknown as MupdfSession;
    let thrown: unknown;
    try {
      await localMupdfExecution.invert(session, 'rotatePages', {} as CommandPrior['rotatePages']);
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).not.toMatch(/not routed to MuPDF/u);
  });
});

describe('the PDFium table', () => {
  it('holds exactly the kinds declared for PDFium, compared from both sides', () => {
    expect(Object.keys(pdfiumSpecs).sort()).toStrictEqual(kindsRoutedTo('pdfium'));
    expect(kindsRoutedTo('pdfium').length).toBeGreaterThan(0);
  });

  it('refuses a command routed to another writer by NAME', () => {
    // Through a cast, for the case above's reason.
    const image = new Uint8Array(0) as unknown as ByteImage;
    const elsewhere = 'rotatePages' as unknown as 'replaceAllText';
    expect(() =>
      localPdfiumExecution.invert(image, elsewhere, {} as CommandPrior['replaceAllText']),
    ).toThrow(/rotatePages is not routed to PDFium/u);
  });
});
