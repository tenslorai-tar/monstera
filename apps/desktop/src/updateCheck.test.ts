import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { UpdateManifest } from '@monstera/contract';
import { afterEach, describe, expect, it } from 'vitest';

import type { SettingsSurface } from './settingsFile.js';
import {
  createUpdateCheck,
  manifestTransport,
  MAX_MANIFEST_BYTES,
  STORE_UPDATE_PROVIDER,
  statusFor,
  UPDATE_PROVIDERS,
  WEB_UPDATE_PROVIDER,
} from './updateCheck.js';

/**
 * The update check (ADR-0110).
 *
 * ## The transport's cases use Node's real `fetch` against a server on 127.0.0.1
 *
 * *Sends nothing* is a claim about the request as it leaves, and a fake `fetch` sees only the arguments this module
 * passed — never the headers Node adds by itself. So the server records what ARRIVED, and each case also asserts that
 * something did: an empty capture must not read as *nothing was sent*.
 */

const MANIFEST: UpdateManifest = { schema: 1, channel: 'store', version: '1.4.0', minimumVersion: '1.2.0', security: false };

/** What reached a local server: each request's method, path and header names. */
interface Arrived {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: IncomingMessage['headers'];
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

/** A server on a free local port that answers every request with `answer`, recording what arrived. */
async function serve(
  answer: (response: ServerResponse) => void,
): Promise<{ readonly url: string; readonly arrived: Arrived[] }> {
  const arrived: Arrived[] = [];
  const server = createServer((request, response) => {
    arrived.push({ method: request.method, url: request.url, headers: request.headers });
    // DRAINED so a request that carried a body cannot leave it unread on the socket.
    request.resume();
    answer(response);
  });
  servers.push(server);
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${String(port)}/updates/v1/store.json`, arrived };
}

const json = (value: unknown) => (response: ServerResponse) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};

describe('manifestTransport — what leaves the machine', () => {
  it('U1: one GET of the path, with no query, no cookie, no body, and only the headers fetch adds itself', async () => {
    const server = await serve(json(MANIFEST));

    const manifest = await manifestTransport()(server.url);

    expect(manifest).toStrictEqual(MANIFEST);
    // SOMETHING ARRIVED, so the absences below are about a request rather than about no request.
    expect(server.arrived).toHaveLength(1);
    const [request] = server.arrived;
    expect(request?.method).toBe('GET');
    expect(request?.url).toBe('/updates/v1/store.json');
    expect(request?.headers.cookie).toBeUndefined();
    expect(request?.headers['content-length']).toBeUndefined();
    // THE HEADER NAMES, measured 2026-09-26 with Node 24.12.0's `fetch` (undici) against this server. Every one is
    // added by `fetch` itself; this module sets none. A mutant adding a header, a cookie or a query reddens here.
    expect(Object.keys(request?.headers ?? {}).sort()).toStrictEqual(MEASURED_HEADERS);
  });

  it('U2: a redirect is refused, and the server it pointed at receives nothing', async () => {
    // THE TARGET IS LIVE AND REACHABLE, so a transport that followed redirects would reach it: its empty record
    // separates *refused* from *could not have arrived* (the negative-probe rule).
    const target = await serve(json(MANIFEST));
    const redirecting = await serve((response) => {
      response.writeHead(302, { location: target.url });
      response.end();
    });

    await expect(manifestTransport()(redirecting.url)).rejects.toThrow();

    expect(redirecting.arrived).toHaveLength(1);
    expect(target.arrived).toHaveLength(0);
  });

  it('U3: a body one byte past the bound is refused by the bytes that arrived, with no length announced', async () => {
    // NO CONTENT-LENGTH (Node chunks the body), so the refusal cannot have come from a header.
    const server = await serve((response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(padded(MAX_MANIFEST_BYTES + 1));
    });

    await expect(manifestTransport()(server.url)).rejects.toThrow(/ceiling/u);
  });

  it('U3 CONTROL: a body exactly at the bound is read', async () => {
    const server = await serve((response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(padded(MAX_MANIFEST_BYTES));
    });

    await expect(manifestTransport()(server.url)).resolves.toStrictEqual(MANIFEST);
  });

  it('refuses an answer that is not HTTP 200, and a file the schema refuses', async () => {
    const missing = await serve((response) => {
      response.writeHead(404);
      response.end();
    });
    await expect(manifestTransport()(missing.url)).rejects.toThrow(/404/u);

    // A FIELD NOBODY DECLARED — the shape of a manifest that started carrying text.
    const noted = await serve(json({ ...MANIFEST, notes: 'Update now at https://example.com' }));
    await expect(manifestTransport()(noted.url)).rejects.toThrow();
  });
});

/** The manifest's JSON padded with trailing spaces to exactly `bytes` bytes — valid JSON at any length. */
function padded(bytes: number): string {
  const text = JSON.stringify(MANIFEST);
  return text + ' '.repeat(bytes - text.length);
}

/**
 * What `fetch` sends by itself — written from U1's first run (2026-09-26, Node 24.12.0 under vitest 4.1.11), never
 * from memory. Every one is a transport header or `fetch`'s own default: none names the person, the machine or the
 * install, and `user-agent` is the runtime's name.
 */
const MEASURED_HEADERS: readonly string[] = [
  'accept',
  'accept-encoding',
  'accept-language',
  'connection',
  'host',
  'sec-fetch-mode',
  'user-agent',
];

describe('statusFor — what a manifest says about the installed version (U5)', () => {
  const at = (installed: string, overrides: Partial<UpdateManifest> = {}, acknowledged: string | null = null) =>
    statusFor(installed, { ...MANIFEST, ...overrides }, acknowledged);

  it('compares numbers, not strings: 1.2.10 is above 1.2.9', () => {
    // A STRING COMPARE says '1.2.10' < '1.2.9', which would call the newer build out of date.
    expect(at('1.2.10', { version: '1.2.9', minimumVersion: '1.0.0' })).toStrictEqual({ kind: 'current' });
    expect(at('1.2.9', { version: '1.2.10', minimumVersion: '1.0.0' })).toStrictEqual({ kind: 'newer', version: '1.2.10' });
  });

  it('current when equal, and when the installed build is ahead of the manifest', () => {
    expect(at('1.4.0')).toStrictEqual({ kind: 'current' });
    expect(at('2.0.0')).toStrictEqual({ kind: 'current' });
  });

  it('newer between the minimum and the newest; unsupported below the minimum', () => {
    expect(at('1.3.5')).toStrictEqual({ kind: 'newer', version: '1.4.0' });
    expect(at('1.1.9')).toStrictEqual({ kind: 'unsupported', version: '1.4.0' });
  });

  it('a security release wins over unsupported, and is not claimed for a build that already has it', () => {
    expect(at('1.1.0', { security: true })).toStrictEqual({ kind: 'security', version: '1.4.0', acknowledged: false });
    expect(at('1.4.0', { security: true })).toStrictEqual({ kind: 'current' });
  });

  it('carries whether THIS release was acknowledged, and an older acknowledgement is not this one', () => {
    expect(at('1.3.0', { security: true }, '1.4.0')).toMatchObject({ kind: 'security', acknowledged: true });
    expect(at('1.3.0', { security: true }, '1.3.9')).toMatchObject({ kind: 'security', acknowledged: false });
  });

  it('an installed version that is not three numbers is unknown, never a guess', () => {
    expect(at('0.0.0-dev')).toStrictEqual({ kind: 'unknown' });
    expect(at('1.4')).toStrictEqual({ kind: 'unknown' });
  });
});

describe('the providers (ADR-0018)', () => {
  it('only the Store build checks; the web provider is registered with nothing behind it', () => {
    expect(UPDATE_PROVIDERS.store).toBe(STORE_UPDATE_PROVIDER);
    expect(UPDATE_PROVIDERS.web).toBe(WEB_UPDATE_PROVIDER);
    expect([UPDATE_PROVIDERS.store.checks, UPDATE_PROVIDERS.web.checks, UPDATE_PROVIDERS.development.checks]).toStrictEqual(
      [true, false, false],
    );
  });
});

/** A record in memory, standing where `createJsonFile` stands in the application. */
function memoryRecord(initial: Record<string, unknown> = {}): SettingsSurface & { stored: () => Record<string, unknown> } {
  let stored = { ...initial };
  return {
    read: () => stored,
    write: (values) => {
      stored = { ...values };
    },
    stored: () => stored,
  };
}

/** A manifest fetch that counts its calls and answers `manifest`. */
function counting(manifest: UpdateManifest | Error): { fetchManifest: (url: string) => Promise<UpdateManifest>; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetchManifest: (url) => {
      urls.push(url);
      return manifest instanceof Error ? Promise.reject(manifest) : Promise.resolve(manifest);
    },
  };
}

const LIVE = { state: 'live', url: 'https://monsterapdf.com/updates/v1/store.json' } as const;

describe('createUpdateCheck — which starts make the call (U4)', () => {
  const base = { installed: '1.3.0', enabled: () => true, record: null, log: () => undefined } as const;

  it('a build with no provider behind its channel answers none and calls nothing', async () => {
    const fetch = counting(MANIFEST);
    const check = createUpdateCheck({ ...base, ...fetch, provider: WEB_UPDATE_PROVIDER, address: LIVE });
    expect(await check.status()).toStrictEqual({ kind: 'none' });
    expect(fetch.urls).toHaveLength(0);
  });

  it('a dormant address answers dormant and calls nothing, whatever the setting says', async () => {
    const fetch = counting(MANIFEST);
    const check = createUpdateCheck({ ...base, ...fetch, provider: STORE_UPDATE_PROVIDER, address: { state: 'dormant' } });
    expect(await check.status()).toStrictEqual({ kind: 'dormant' });
    expect(fetch.urls).toHaveLength(0);
  });

  it('the setting turned off answers off and calls nothing', async () => {
    const fetch = counting(MANIFEST);
    const check = createUpdateCheck({
      ...base,
      ...fetch,
      provider: STORE_UPDATE_PROVIDER,
      address: LIVE,
      enabled: () => false,
    });
    expect(await check.status()).toStrictEqual({ kind: 'off' });
    expect(fetch.urls).toHaveLength(0);
  });

  it('CONTROL: live, on and a Store build calls the address ONCE, however often it is asked', async () => {
    const fetch = counting(MANIFEST);
    const check = createUpdateCheck({ ...base, ...fetch, provider: STORE_UPDATE_PROVIDER, address: LIVE });
    expect(await check.status()).toStrictEqual({ kind: 'newer', version: '1.4.0' });
    expect(await check.status()).toStrictEqual({ kind: 'newer', version: '1.4.0' });
    expect(fetch.urls).toStrictEqual([LIVE.url]);
  });

  it('no answer is unknown, with one line naming why and no second attempt', async () => {
    const fetch = counting(new Error('the manifest answered HTTP 503'));
    const lines: string[] = [];
    const check = createUpdateCheck({
      ...base,
      ...fetch,
      provider: STORE_UPDATE_PROVIDER,
      address: LIVE,
      log: (detail) => lines.push(detail),
    });
    expect(await check.status()).toStrictEqual({ kind: 'unknown' });
    expect(await check.status()).toStrictEqual({ kind: 'unknown' });
    expect(fetch.urls).toHaveLength(1);
    expect(lines).toStrictEqual(['the manifest answered HTTP 503']);
  });
});

describe('createUpdateCheck — the security notice is acknowledged once per release', () => {
  const security: UpdateManifest = { ...MANIFEST, security: true };
  const build = (record: SettingsSurface | null) =>
    createUpdateCheck({
      provider: STORE_UPDATE_PROVIDER,
      address: LIVE,
      installed: '1.3.0',
      enabled: () => true,
      record,
      log: () => undefined,
      ...counting(security),
    });

  it('records the release, answers acknowledged from then on, and the next start reads it back', async () => {
    const record = memoryRecord({ kept: 'as it was' });
    const check = build(record);
    expect(await check.status()).toMatchObject({ kind: 'security', acknowledged: false });

    expect(await check.acknowledge()).toBe(true);

    expect(await check.status()).toMatchObject({ kind: 'security', acknowledged: true });
    // THE REST OF THE RECORD SURVIVES the write.
    expect(record.stored()).toStrictEqual({ kept: 'as it was', acknowledgedSecurityVersion: '1.4.0' });
    expect(await build(record).status()).toMatchObject({ kind: 'security', acknowledged: true });
  });

  it('CONTROL: nothing to acknowledge, or nowhere to keep it, records nothing and says so', async () => {
    const record = memoryRecord();
    const current = createUpdateCheck({
      provider: STORE_UPDATE_PROVIDER,
      address: LIVE,
      installed: '1.4.0',
      enabled: () => true,
      record,
      log: () => undefined,
      ...counting(security),
    });
    expect(await current.acknowledge()).toBe(false);
    expect(record.stored()).toStrictEqual({});

    expect(await build(null).acknowledge()).toBe(false);
  });
});
