import { type IncomingHttpHeaders, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { listModels } from './aiModels.js';
import { streamChat } from './aiChat.js';
import { listCloudPdfs } from './cloudStorage.js';
import { credentialedFetch } from './credentialedFetch.js';
import { recogniseThroughAzure } from './ocrAzure.js';
import { recogniseThroughClaude } from './ocrClaude.js';

/**
 * Addendum 5's X3: a request that carries a credential is never followed to another address.
 *
 * ## The redirect is REAL, on loopback
 *
 * A stub `fetch` would decide the redirect itself, so it could only show what options a caller passed. Here the
 * declared address is a server that answers every request with a 307 to a second server, and `fetch` itself decides
 * whether to go there; the second server counts what reaches it. Each caller's own `fetchImpl` sends its request to
 * the first server, path and all, so the rule under test is the caller's, through `fetch`'s own redirect handling.
 */

interface Seen {
  readonly method: string | undefined;
  readonly headers: IncomingHttpHeaders;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function server(
  answer: (response: import('node:http').ServerResponse, method: string | undefined) => void,
): Promise<{ readonly origin: string; readonly seen: Seen[] }> {
  const seen: Seen[] = [];
  const listening = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      seen.push({ method: request.method, headers: request.headers });
      answer(response, request.method);
    });
  });
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
  const { port } = listening.address() as AddressInfo;
  closers.push(
    () =>
      new Promise((resolve) => {
        listening.close(() => {
          resolve();
        });
      }),
  );
  return { origin: `http://127.0.0.1:${String(port)}`, seen };
}

/**
 * A declared server that redirects to an undeclared one, and the undeclared one. `accepted`, where given, is answered to
 * a POST as Azure's `202` naming that result address, so the redirect meets the poll, which carries the key and no body.
 *
 * WHY THE POLL: `fetch` sends a `Uint8Array` body by transferring it, so following a 307 with one fails on a detached
 * buffer (measured 2026-10-15, Node 22: *Cannot perform ArrayBuffer.prototype.slice on a detached ArrayBuffer*). Azure's
 * POST is protected by that accident whatever the rule says, and a case that stopped there would pass without it.
 */
async function redirecting(accepted?: string): Promise<{ readonly declared: Awaited<ReturnType<typeof server>>; readonly elsewhere: Awaited<ReturnType<typeof server>> }> {
  const elsewhere = await server((response) => response.writeHead(200, { 'content-type': 'application/json' }).end('{}'));
  const declared = await server((response, method) => {
    if (accepted !== undefined && method === 'POST') response.writeHead(202, { 'operation-location': accepted }).end();
    else response.writeHead(307, { location: `${elsewhere.origin}/taken` }).end();
  });
  return { declared, elsewhere };
}

/** A `fetchImpl` that sends every request to `origin`, keeping its path, and lets real `fetch` handle what comes back. */
function to(origin: string): typeof fetch {
  return (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return fetch(`${origin}${url.pathname}${url.search}`, init);
  };
}

describe('credentialedFetch', () => {
  it('refuses a 307 to another host: the second request is never made', async () => {
    const { declared, elsewhere } = await redirecting();
    await expect(
      credentialedFetch(fetch, `${declared.origin}/ask`, { method: 'POST', headers: { 'x-api-key': 'secret' }, body: 'page' }),
    ).rejects.toThrow();
    expect(declared.seen).toHaveLength(1);
    expect(elsewhere.seen).toStrictEqual([]);
  });

  it('CONTROL: fetch’s default follows the 307 and re-sends the key header and the body to the other host', async () => {
    const { declared, elsewhere } = await redirecting();
    await fetch(`${declared.origin}/ask`, { method: 'POST', headers: { 'x-api-key': 'secret' }, body: 'page' });
    expect(elsewhere.seen).toHaveLength(1);
    expect(elsewhere.seen[0]?.method).toBe('POST');
    expect(elsewhere.seen[0]?.headers['x-api-key']).toBe('secret');
  });

  it('lets a caller that asks to see the hop see it, without following it', async () => {
    const { declared, elsewhere } = await redirecting();
    const response = await credentialedFetch(fetch, `${declared.origin}/ask`, { redirect: 'manual' });
    expect(response.status).toBe(307);
    expect(elsewhere.seen).toStrictEqual([]);
  });
});

describe('every request that carries a credential takes the rule', () => {
  const png = new Uint8Array(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(png.buffer).setUint32(8, 13);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(png.buffer).setUint32(16, 200);
  new DataView(png.buffer).setUint32(20, 300);
  const frame = { crop: [0, 0, 200, 300] as const, rotation: 0 as const, origin: [0, 0] as const, scale: 1, drawn: true };

  const AZURE_RESULT = 'https://example.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-read/analyzeResults/1';
  const callers: [string, (fetchImpl: typeof fetch) => Promise<unknown>, string?][] = [
    ['Claude OCR (x-api-key, the page)', (fetchImpl) => recogniseThroughClaude({ key: 'secret', model: 'claude-haiku-4-5' }, { png, ...frame, fetchImpl })],
    [
      'Azure OCR (Ocp-Apim-Subscription-Key, the page)',
      (fetchImpl) =>
        recogniseThroughAzure(
          { endpoint: 'https://example.cognitiveservices.azure.com', key: 'secret' },
          { png, ...frame, fetchImpl },
          { sleep: () => Promise.resolve(), now: () => 0 },
        ),
      AZURE_RESULT,
    ],
    [
      'the assistant’s chat (x-api-key, the conversation)',
      (fetchImpl) => streamChat({ provider: 'anthropic', model: 'claude-haiku-4-5', key: 'secret', messages: [{ role: 'user', text: 'hello' }], web: false, fetchImpl }),
    ],
    ['the assistant’s model list (x-api-key)', (fetchImpl) => listModels({ provider: 'anthropic', key: 'secret', fetchImpl })],
    ['cloud storage’s shared transport (a bearer token)', (fetchImpl) => listCloudPdfs('onedrive', 'secret-token', fetchImpl)],
  ];

  for (const [name, call, accepted] of callers) {
    it(name, async () => {
      const { declared, elsewhere } = await redirecting(accepted);
      await call(to(declared.origin)).catch(() => undefined);
      // THE POSITIVE CONTROL, per caller: it reached the declared server, so silence at the other one means something.
      expect(declared.seen.length).toBeGreaterThan(0);
      expect(elsewhere.seen).toStrictEqual([]);
    });
  }
});
