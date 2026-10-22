import type { ContractClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { type OpenDocumentDeps, settleButtonFileOpen } from './openDocument.js';

/**
 * A push button's Open a file, settled (ADR-0259): what main answers is what any open answers, so it is settled by the
 * one place a pick and a drop are, and the two answers only a button's step can give are the press's to say.
 */
function recording(): { readonly deps: OpenDocumentDeps; readonly seen: unknown[] } {
  const seen: unknown[] = [];
  const deps: OpenDocumentDeps = {
    client: {} as ContractClient,
    onOpened: (opened) => seen.push({ opened: opened.docId }),
    onProblem: (problems) => seen.push({ problems }),
    onAlreadyOpen: (docId) => seen.push({ alreadyOpen: docId }),
  };
  return { deps, seen };
}

describe('settleButtonFileOpen', () => {
  it('settles an open as a pick is: a new tab, the open one brought forward, a moved file said', () => {
    const guide = asDocId('doc-guide');
    const opened = recording();
    expect(
      settleButtonFileOpen(opened.deps, ok({ kind: 'opened', docId: guide, version: asDocVersion(1), byteLength: 9, name: 'guide.pdf' })),
    ).toBe('shown');
    expect(opened.seen).toStrictEqual([{ opened: guide }]);
    const already = recording();
    expect(settleButtonFileOpen(already.deps, ok({ kind: 'already-open', docId: guide }))).toBe('shown');
    expect(already.seen).toStrictEqual([{ alreadyOpen: guide }]);
    const absent = recording();
    expect(settleButtonFileOpen(absent.deps, ok({ kind: 'absent' }))).toBe('none');
    expect(absent.seen).toStrictEqual([{ problems: [{ reason: 'absent' }] }]);
  });

  it('CONTROL: a button that moved, or a step that is not Open a file, is refused and settles NOTHING', () => {
    for (const kind of ['stale', 'no-such-file'] as const) {
      const { deps, seen } = recording();
      expect(settleButtonFileOpen(deps, ok({ kind }))).toBe('refused');
      expect(seen).toStrictEqual([]);
    }
    // And a failure is the open's own, said as any failed open is.
    const failed = recording();
    expect(settleButtonFileOpen(failed.deps, err({ code: 'internal' as const, incident: 'i9' }))).toBe('none');
    expect(failed.seen).toStrictEqual([{ problems: [{ reason: 'failed' }] }]);
  });
});
