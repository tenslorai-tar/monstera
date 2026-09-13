import { TIMESTAMP_AUTHORITIES } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { MAX_TIMESTAMP_REPLY_BYTES, timestampTransport } from './timestampTransport.js';

/**
 * The timestamp transport — what leaves the machine, and what it will read back.
 *
 * ## The CALL is the observable, not the answer
 *
 * A transport that sent the request somewhere else, or followed a redirect, would
 * still hand a correct reply back from a fake that answers anything. So the cases
 * record what `fetch` was asked, and assert that.
 */

interface Asked {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** A fetch that records its call and answers `response`. */
function recording(response: () => Response): { fetchImpl: typeof fetch; asked: Asked[] } {
  const asked: Asked[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    asked.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      init,
    });
    return Promise.resolve(response());
  }) as typeof fetch;
  return { fetchImpl, asked };
}

const QUERY = Uint8Array.of(0x30, 0x03, 0x02, 0x01, 0x01);

describe('timestampTransport', () => {
  it('POSTS the query to the CONTRACT’S url for that authority, refusing redirects', async () => {
    const { fetchImpl, asked } = recording(() => new Response(Uint8Array.of(1, 2, 3)));

    const reply = await timestampTransport(fetchImpl)('globalsign', QUERY);

    expect(Array.from(reply)).toStrictEqual([1, 2, 3]);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.url).toBe(TIMESTAMP_AUTHORITIES.globalsign.url);
    expect(asked[0]?.init?.method).toBe('POST');
    expect(asked[0]?.init?.redirect).toBe('error');
    expect(asked[0]?.init?.body).toBe(QUERY);
    expect((asked[0]?.init?.headers as Record<string, string>)['content-type']).toBe(
      'application/timestamp-query',
    );
    // BOUNDED IN TIME: a signal is passed, because `fetch` has no timeout of its own.
    expect(asked[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('CONTROL: a different authority reaches a different url', async () => {
    // Without this, a transport that always asked one authority passes the case
    // above for `globalsign` by coincidence of the fixture.
    const { fetchImpl, asked } = recording(() => new Response(Uint8Array.of(1)));
    await timestampTransport(fetchImpl)('freetsa', QUERY);
    expect(asked[0]?.url).toBe(TIMESTAMP_AUTHORITIES.freetsa.url);
    expect(asked[0]?.url).not.toBe(TIMESTAMP_AUTHORITIES.globalsign.url);
  });

  it('throws on an HTTP error rather than handing its body to the verifier', async () => {
    const { fetchImpl } = recording(() => new Response('busy', { status: 503 }));
    await expect(timestampTransport(fetchImpl)('digicert', QUERY)).rejects.toThrow(/HTTP 503/u);
  });

  it('refuses a reply past the ceiling by bytes RECEIVED, whatever Content-Length says', async () => {
    // THE HEADER LIES SMALL, and the body is one byte over: the refusal must come
    // from counting, which is the only thing a sender cannot write.
    const over = new Uint8Array(MAX_TIMESTAMP_REPLY_BYTES + 1);
    const { fetchImpl } = recording(
      () => new Response(over, { headers: { 'content-length': '10' } }),
    );
    await expect(timestampTransport(fetchImpl)('sectigo', QUERY)).rejects.toThrow(/ceiling/u);
  });

  it('CONTROL: a reply exactly at the ceiling is read whole', async () => {
    const at = new Uint8Array(MAX_TIMESTAMP_REPLY_BYTES);
    const { fetchImpl } = recording(() => new Response(at));
    const reply = await timestampTransport(fetchImpl)('sectigo', QUERY);
    expect(reply.byteLength).toBe(MAX_TIMESTAMP_REPLY_BYTES);
  });
});
