import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { annotationReadsFor } from './annotationReads.js';

/**
 * The one reader of a document's annotation walk (`annotationReads.ts`): what it asks `main`, counted, since the
 * decision it exists for is a read NOT made.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000e1');

/** A client whose walk answers at `version()` — or refuses while `refusing` — and counts each asking. */
function walking(version: () => number, refusing: () => boolean = () => false): { client: ContractClient; asked: () => number } {
  let asked = 0;
  const client = createClient(channels, (id) => {
    if (id !== 'document.annotations') return Promise.resolve(ok({}));
    asked += 1;
    if (refusing()) return Promise.resolve(err({ code: 'document-not-open' }));
    return Promise.resolve(ok({ version: asDocVersion(version()), annotations: [], next: null, truncated: false }));
  });
  return { client, asked: () => asked };
}

describe('annotationReadsFor', () => {
  it('a second asking at a version ALREADY READ asks main nothing; a new version asks again', async () => {
    let at = 3;
    const { client, asked } = walking(() => at);
    const reads = annotationReadsFor(client);
    await reads.read(DOC, asDocVersion(3));
    await reads.read(DOC, asDocVersion(3));
    expect(asked()).toBe(1);
    at = 4;
    const moved = await reads.read(DOC, asDocVersion(4));
    expect([asked(), moved.ok ? moved.value.version : undefined]).toStrictEqual([2, 4]);
    // ONE PER CLIENT, whoever asks: a page list and the shell holding the same client share what is read.
    expect(annotationReadsFor(client)).toBe(reads);
  });

  it('a read is kept under the version it ANSWERED at, not the one it was asked at', async () => {
    const { client, asked } = walking(() => 7);
    const reads = annotationReadsFor(client);
    // ASKED FOR NO VERSION, or a version the document has already left: kept as the 7 it describes.
    await reads.read(DOC, undefined);
    await reads.read(DOC, asDocVersion(7));
    expect(asked()).toBe(1);
  });

  it('CONTROL: a REFUSED read is not kept, and a FORGOTTEN document is read again', async () => {
    let refusing = true;
    const { client, asked } = walking(
      () => 2,
      () => refusing,
    );
    const reads = annotationReadsFor(client);
    expect((await reads.read(DOC, asDocVersion(2))).ok).toBe(false);
    refusing = false;
    expect((await reads.read(DOC, asDocVersion(2))).ok).toBe(true);
    await reads.read(DOC, asDocVersion(2));
    expect(asked()).toBe(2);
    reads.forget(DOC);
    await reads.read(DOC, asDocVersion(2));
    expect(asked()).toBe(3);
  });
});
