import { type ChannelResult, clientOver } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { createDocumentStore } from '../documentStores.js';
import { readCertificationLine } from './certificationLine.js';

/**
 * The certification line's read (ADR-0291's amendment of 2026-11-12): main's answer into the document's store, and a
 * copy's line kept against a read of the copy, which is uncertified.
 */
const DOC = asDocId('00000000-0000-4000-8000-0000000000e1');

function answering(answer: ChannelResult<'document.certification'> | 'not-open') {
  const asked: unknown[] = [];
  const client = clientOver((id, params) => {
    if (id !== 'document.certification') throw new Error(`this case does not answer ${id}`);
    asked.push(params);
    return Promise.resolve(answer === 'not-open' ? err({ code: 'document-not-open' as const }) : ok(answer));
  });
  return { client, asked };
}

describe('the certification line is read from main', () => {
  it('a certified document’s line names the certifier and the level, asked by its own id', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    const { client, asked } = answering({ certification: { level: 'form-fill', signer: 'Grace Hopper' }, signed: true });
    await readCertificationLine(client, DOC, store);
    expect(asked).toStrictEqual([{ docId: DOC }]);
    expect(store.getState().certificationLine).toStrictEqual({ kind: 'certified', level: 'form-fill', signer: 'Grace Hopper' });
  });

  it('CONTROL: an uncertified document has no line, and a read that fails draws none', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    await readCertificationLine(answering({ certification: null, signed: true }).client, DOC, store);
    expect(store.getState().certificationLine).toBeNull();
    await readCertificationLine(answering('not-open').client, DOC, store);
    expect(store.getState().certificationLine).toBeNull();
  });

  it('A COPY’S LINE STAYS: the copy is uncertified, so its own read answers none, and that does not replace it', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    store.getState().certificationShown({ kind: 'uncertified-copy', signer: 'Grace Hopper' });
    await readCertificationLine(answering({ certification: null, signed: true }).client, DOC, store);
    expect(store.getState().certificationLine).toStrictEqual({ kind: 'uncertified-copy', signer: 'Grace Hopper' });
    // CONTROL: on a document that is not a copy, the same answer of none does clear a certified line.
    const certified = createDocumentStore(DOC, asDocVersion(1));
    certified.getState().certificationShown({ kind: 'certified', level: 'no-changes', signer: 'Grace Hopper' });
    await readCertificationLine(answering({ certification: null, signed: false }).client, DOC, certified);
    expect(certified.getState().certificationLine).toBeNull();
  });
});
