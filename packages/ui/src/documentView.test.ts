// @vitest-environment happy-dom
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `openDocumentView`'s decisions, none of which is about parsing.
 *
 * `getDocument` is replaced and everything else in `pdfjs-dist` is kept — the
 * transport this file constructs extends `PDFDataRangeTransport`, so a whole-
 * module mock would leave it extending `undefined` and every case would fail for
 * a reason that has nothing to do with what is under test.
 *
 * What a real parser does with real bytes is `proof:rendererpolicy`'s job.
 */
const getDocument = vi.fn();

vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<typeof import('pdfjs-dist')>()),
  getDocument: (...args: unknown[]) => getDocument(...args) as unknown,
}));

const { openDocumentView } = await import('./documentView.js');

const DOC = asDocId('doc-view');
const VERSION = asDocVersion(2);

/** A client that answers no range — nothing here reaches the transport. */
function idleClient(): ContractClient {
  return createClient(channels, () =>
    Promise.resolve(ok({ kind: 'bytes', bytes: new Uint8Array(0) })),
  );
}

function open(task: { promise: Promise<unknown>; destroy: () => Promise<void> }) {
  getDocument.mockReturnValue(task);
  return openDocumentView({
    client: idleClient(),
    docId: DOC,
    version: VERSION,
    byteLength: 1024,
    onVersionMoved: vi.fn(),
  });
}

beforeEach(() => {
  getDocument.mockReset();
});

describe('openDocumentView', () => {
  it('destroys the loading task when the open FAILS', async () => {
    // The task owns a worker whether or not it produced a document, so a failed
    // open that did not destroy it leaks one per attempt — and a leaked worker
    // is invisible until the machine is out of them. Nothing about the thrown
    // error says whether the cleanup ran, which is why this asserts the CALL.
    const destroy = vi.fn(() => Promise.resolve());

    await expect(
      open({ promise: Promise.reject(new Error('bad header')), destroy }),
    ).rejects.toThrow('bad header');

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a successful open does NOT destroy it', async () => {
    // Without this the case above passes for an implementation that destroys the
    // task unconditionally — which would tear down the parser it just built, and
    // would look identical from the failure side.
    const destroy = vi.fn(() => Promise.resolve());

    const view = await open({ promise: Promise.resolve({ numPages: 3 }), destroy });

    expect(destroy).not.toHaveBeenCalled();
    expect(view.version).toBe(VERSION);
  });

  it('CLOSES ITSELF when the version moves, before telling the caller', async () => {
    // Finding IIIII-1. The failed-open case above guards a leaked worker; this
    // path had the same hazard and no guard, eleven lines away in the same
    // function. A moved version is a second failure reported through a callback
    // rather than a throw, which is what made it read as the happy path.
    //
    // The ORDER is asserted, not merely that both happened: a caller told first
    // may reopen immediately, and two live parsers for one document is the state
    // this closes rather than the one worker it saves.
    const order: string[] = [];
    getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1 }),
      destroy: () => {
        order.push('destroyed');
        return Promise.resolve();
      },
    });

    // Main holds the document at 99; the view is bound to VERSION, so the first
    // range it asks for comes back `stale`. Driven through the transport the
    // view actually built, rather than by calling the option back — the point is
    // the wiring, and invoking the callback directly would assert nothing about
    // it.
    const stale = createClient(channels, () =>
      Promise.resolve(ok({ kind: 'stale', version: asDocVersion(99), byteLength: 2048 })),
    );
    await openDocumentView({
      client: stale,
      docId: DOC,
      version: VERSION,
      byteLength: 1024,
      onVersionMoved: () => {
        order.push('told');
      },
    });

    const built = getDocument.mock.calls[0]?.[0] as {
      range: { requestDataRange: (begin: number, end: number) => void };
    };
    built.range.requestDataRange(0, 16);
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();

    expect(order).toStrictEqual(['destroyed', 'told']);
  });

  it('close is idempotent, because two paths can reach it', async () => {
    // A view is closed both by the document closing and by its version moving
    // underneath it, and those race. A second `destroy` on a destroyed task is
    // an error inside PDF.js that surfaces nowhere useful.
    const destroy = vi.fn(() => Promise.resolve());
    const view = await open({ promise: Promise.resolve({ numPages: 1 }), destroy });

    await view.close();
    await view.close();

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('drives the parser demand-only, with no progressive data', async () => {
    // The property is structural rather than optional: with `range` supplied and
    // no progressive read ever pushed, there is no full-document stream to
    // disable. Measured — `disableAutoFetch`/`disableStream` change the byte
    // counts not at all — so asserting them would assert a setting that does
    // nothing, while asserting the transport is what actually decides it.
    await open({ promise: Promise.resolve({ numPages: 1 }), destroy: () => Promise.resolve() });

    const params = getDocument.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(params?.['range']).toBeDefined();
    expect(params?.['useWasm']).toBe(false);
    expect(params?.['useWorkerFetch']).toBe(false);
  });
});
