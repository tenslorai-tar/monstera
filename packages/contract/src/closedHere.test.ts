import { type DocId, asDocId, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { DOCUMENT_CLOSED_HERE, clientOver } from './closedHere.js';

/**
 * ADR-0294: the renderer's client answers `document-closed-here` where `main` answered `document-not-open` for a
 * document this window had already sent `document.close` for, and passes every other answer unchanged.
 */
const DOC: DocId = asDocId('doc-a');
const OTHER: DocId = asDocId('doc-b');

/** A transport whose answers a case releases by hand, in the order it chooses, recording each call. */
function heldTransport() {
  const pending: { id: string; params: unknown; answer: (value: unknown) => void }[] = [];
  const invoke = (id: string, params: unknown) =>
    new Promise<unknown>((resolve) => {
      pending.push({ id, params, answer: resolve });
    });
  const answerFirst = (id: string, value: unknown): void => {
    const at = pending.findIndex((each) => each.id === id);
    const held = pending.splice(at, 1)[0];
    if (held === undefined) throw new Error(`no call to ${id} is waiting`);
    held.answer(value);
  };
  return { invoke, pending, answerFirst };
}

describe('the renderer’s client answers a refusal for a document this window closed (ADR-0294)', () => {
  it('TODAY’S ORDER: a read asked, the close sent, then the read refused as not open — answered as closed here', async () => {
    const wire = heldTransport();
    const client = clientOver(wire.invoke);
    const read = client['document.textBlocks']({ docId: DOC, page: 0, from: 0 });
    const close = client['document.close']({ docId: DOC });
    // THE CLOSE RUNS AHEAD OF THE QUEUED READ in main's lane (ADR-0274), so it answers first and the read finds nothing.
    wire.answerFirst('document.close', ok({ closed: true }));
    wire.answerFirst('document.textBlocks', err({ code: 'document-not-open' }));
    expect(await close).toStrictEqual(ok({ closed: true }));
    expect(await read).toStrictEqual(err({ code: DOCUMENT_CLOSED_HERE }));
  });

  it('CONTROL: a document this window never closed, refused as not open, stays not open — main lost it, and it is said', async () => {
    const wire = heldTransport();
    const client = clientOver(wire.invoke);
    const read = client['document.textBlocks']({ docId: OTHER, page: 0, from: 0 });
    void client['document.close']({ docId: DOC });
    wire.answerFirst('document.close', ok({ closed: true }));
    wire.answerFirst('document.textBlocks', err({ code: 'document-not-open' }));
    expect(await read).toStrictEqual(err({ code: 'document-not-open' }));
  });

  it('an answer that is not a refusal passes unchanged after the close', async () => {
    const wire = heldTransport();
    const client = clientOver(wire.invoke);
    const unsaved = client['document.unsaved']({ docId: DOC });
    void client['document.close']({ docId: DOC });
    wire.answerFirst('document.close', ok({ closed: true }));
    wire.answerFirst('document.unsaved', ok({ unsaved: false }));
    expect(await unsaved).toStrictEqual(ok({ unsaved: false }));
  });

  it('another refusal for a document this window closed passes unchanged: only not open is the close’s own answer', async () => {
    const wire = heldTransport();
    const client = clientOver(wire.invoke);
    const read = client['document.textBlocks']({ docId: DOC, page: 0, from: 0 });
    void client['document.close']({ docId: DOC });
    wire.answerFirst('document.close', ok({ closed: true }));
    wire.answerFirst('document.textBlocks', err({ code: 'document-busy' }));
    expect(await read).toStrictEqual(err({ code: 'document-busy' }));
  });

  it('a call sent AFTER the close and refused as not open is the close’s answer too', async () => {
    const wire = heldTransport();
    const client = clientOver(wire.invoke);
    void client['document.close']({ docId: DOC });
    wire.answerFirst('document.close', ok({ closed: true }));
    const late = client['document.unsaved']({ docId: DOC });
    wire.answerFirst('document.unsaved', err({ code: 'document-not-open' }));
    expect(await late).toStrictEqual(err({ code: DOCUMENT_CLOSED_HERE }));
  });
});
