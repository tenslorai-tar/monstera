import type { LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  type HopTransport,
  MAX_URL_REDIRECTS,
  PDF_PREFIX_BYTES,
  type Resolve,
  UrlFetchRefused,
  addressBlocked,
  checkedUrl,
  fetchGuardedPdf,
} from './guardedFetch.js';

/**
 * Part C8's SSRF guard (ADR-0061), and every case touches loopback or nothing.
 *
 * ## Each refusal's input is one the ABSENT guard would let through
 *
 * A URL that could not be reached anyway proves nothing about a refusal. So the name
 * cases resolve to a socket that IS listening, and assert that it saw no connection —
 * with a control that the same socket does see one when the guard is not in the way.
 * The redirect cases use a scripted transport that still calls the guard's own `lookup`,
 * and assert which names were RESOLVED, because *every resolution is checked* is a
 * claim about calls made, not about the state a refusal leaves.
 */

/** A loopback socket that counts connections and closes each one. */
async function listening(): Promise<{
  readonly port: number;
  readonly connections: () => number;
  readonly close: () => Promise<void>;
}> {
  let count = 0;
  const server = createServer((socket) => {
    count += 1;
    socket.destroy();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the server has no port');
  return {
    port: address.port,
    connections: () => count,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** A resolver answering from a table, recording every name it was asked. */
function table(entries: Readonly<Record<string, readonly string[]>>): { resolve: Resolve; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    resolve: (host) => {
      asked.push(host);
      return Promise.resolve(
        (entries[host] ?? []).map((address): LookupAddress => ({ address, family: address.includes(':') ? 6 : 4 })),
      );
    },
  };
}

/** One scripted answer. */
interface Scripted {
  readonly status: number;
  readonly location?: string;
  readonly body?: string;
}

/**
 * A transport that resolves through the guard's own `lookup`, as a socket would, and then
 * answers from a script. `connected` records what a socket would have been handed.
 */
function scripted(answers: Readonly<Record<string, Scripted>>): {
  readonly transport: HopTransport;
  readonly connected: string[];
} {
  const connected: string[] = [];
  return {
    connected,
    transport: (url, lookup) =>
      new Promise((resolve, reject) => {
        lookup(url.hostname, { all: true }, (error, addresses) => {
          if (error !== null) {
            reject(error);
            return;
          }
          const handed = Array.isArray(addresses) ? addresses.map((entry) => entry.address) : [addresses];
          connected.push(`${url.hostname}=${handed.join(',')}`);
          const answer = answers[url.href];
          if (answer === undefined) {
            reject(new Error(`no answer scripted for ${url.href}`));
            return;
          }
          resolve({
            statusCode: answer.status,
            headers: answer.location === undefined ? {} : { location: answer.location },
            body: Readable.from(answer.body === undefined ? [] : [Buffer.from(answer.body)]),
          });
        });
      }),
  };
}

/** A body read back as UTF-8 — the encoding `scripted` wrote it in. */
async function readAll(stream: Readable): Promise<string> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(parts).toString('utf8');
}

const PDF = '%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n';

describe('addressBlocked', () => {
  it('refuses a representative of every block, in every form an address can be written', () => {
    const refused = [
      '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1',
      '192.0.0.8', '192.0.2.1', '192.88.99.2', '192.168.1.1', '198.18.0.1', '198.51.100.1',
      '203.0.113.1', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
      '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254',
      '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b:1::1', '100::1', '2001:db8::1',
      '2001::1', '2002:7f00:1::1', '3fff::1', '5f00::1', 'fc00::1', 'fd12::1', 'fe80::1',
      'ff02::1', 'not an address',
    ];
    expect(refused.filter((address) => !addressBlocked(address))).toStrictEqual([]);
  });

  it('CONTROL: passes public addresses, including a public one mapped or translated', () => {
    // WITHOUT THIS a guard refusing everything passes the case above. The mapped and
    // NAT64 forms are the ones a whole-prefix entry would wrongly refuse.
    const passed = ['1.1.1.1', '93.184.215.14', '2606:4700:4700::1111', '::ffff:1.1.1.1', '64:ff9b::101:101'];
    expect(passed.filter((address) => addressBlocked(address))).toStrictEqual([]);
  });
});

describe('checkedUrl', () => {
  it('refuses a scheme that is not https, and a URL carrying credentials', () => {
    expect(() => checkedUrl('http://example.com/a.pdf')).toThrow(expect.objectContaining({ reason: 'not-https' }));
    expect(() => checkedUrl('file:///C:/a.pdf')).toThrow(expect.objectContaining({ reason: 'not-https' }));
    expect(() => checkedUrl('not a url')).toThrow(expect.objectContaining({ reason: 'not-https' }));
    expect(() => checkedUrl('https://user:secret@example.com/a.pdf')).toThrow(
      expect.objectContaining({ reason: 'credentials' }),
    );
  });

  it('refuses a blocked LITERAL host however it is spelt, before any request', () => {
    // A LITERAL NEVER REACHES `lookup` (measured), so this is the only check a literal
    // meets. The decimal and hexadecimal spellings are the WHATWG parser's to normalise.
    for (const url of [
      'https://127.0.0.1/a.pdf',
      'https://2130706433/a.pdf',
      'https://0x7f.1/a.pdf',
      'https://[::1]/a.pdf',
      'https://[::ffff:127.0.0.1]/a.pdf',
      'https://[64:ff9b::7f00:1]/a.pdf',
    ]) {
      expect(() => checkedUrl(url), url).toThrow(expect.objectContaining({ reason: 'blocked-address' }));
    }
  });

  it('CONTROL: accepts a public literal and a name', () => {
    expect(checkedUrl('https://1.1.1.1/a.pdf').hostname).toBe('1.1.1.1');
    expect(checkedUrl('https://example.com:8443/a.pdf').port).toBe('8443');
  });
});

describe('fetchGuardedPdf, against a real socket', () => {
  it('a NAME resolving to a listening loopback socket is refused, and the socket sees no connection', async () => {
    const server = await listening();
    try {
      const names = table({ 'rebind.test': ['127.0.0.1'] });
      await expect(
        fetchGuardedPdf(`https://rebind.test:${String(server.port)}/a.pdf`, 1024, { resolve: names.resolve }),
      ).rejects.toMatchObject({ reason: 'blocked-address' });
      expect(names.asked).toStrictEqual(['rebind.test']);
      expect(server.connections()).toBe(0);

      // CONTROL: the same socket IS connected to when nothing guards the request, so the
      // zero above is the guard and not a socket nothing could reach.
      await new Promise<void>((resolve) => {
        const plain = httpsRequest({ host: '127.0.0.1', port: server.port, agent: false });
        plain.on('error', () => {
          resolve();
        });
        plain.end();
      });
      expect(server.connections()).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  it('a LITERAL loopback host is refused before any socket opens', async () => {
    const server = await listening();
    try {
      await expect(
        fetchGuardedPdf(`https://127.0.0.1:${String(server.port)}/a.pdf`, 1024),
      ).rejects.toMatchObject({ reason: 'blocked-address' });
      expect(server.connections()).toBe(0);
    } finally {
      await server.close();
    }
  });
});

describe('fetchGuardedPdf, hop by hop', () => {
  it('resolves EVERY hop through the guard, relative redirects included, and answers the body', async () => {
    const names = table({ 'first.test': ['1.1.1.1'], 'second.test': ['2606:4700:4700::1111'] });
    const hops = scripted({
      'https://first.test/start': { status: 302, location: '/moved' },
      'https://first.test/moved': { status: 301, location: 'https://second.test/doc.pdf' },
      'https://second.test/doc.pdf': { status: 200, body: PDF },
    });

    const body = await fetchGuardedPdf('https://first.test/start', 1024, {
      resolve: names.resolve,
      transport: hops.transport,
    });

    expect(await readAll(body)).toBe(PDF);
    // THREE HOPS, THREE RESOLUTIONS — the same name twice, because a pin that remembered
    // its first answer is exactly the check the law refuses.
    expect(names.asked).toStrictEqual(['first.test', 'first.test', 'second.test']);
    expect(hops.connected).toStrictEqual([
      'first.test=1.1.1.1',
      'first.test=1.1.1.1',
      'second.test=2606:4700:4700::1111',
    ]);
  });

  it('refuses a redirect to a name that resolves privately, AT that hop, with nothing handed to a socket', async () => {
    const names = table({ 'first.test': ['1.1.1.1'], 'inside.test': ['10.0.0.5'] });
    const hops = scripted({ 'https://first.test/': { status: 302, location: 'https://inside.test/' } });

    await expect(
      fetchGuardedPdf('https://first.test/', 1024, { resolve: names.resolve, transport: hops.transport }),
    ).rejects.toMatchObject({ reason: 'blocked-address' });
    expect(names.asked).toStrictEqual(['first.test', 'inside.test']);
    expect(hops.connected).toStrictEqual(['first.test=1.1.1.1']);
  });

  it('refuses the WHOLE of a mixed answer rather than handing on its public half', async () => {
    // A FILTERING guard would hand the socket 1.1.1.1 and pass every assertion about the
    // outcome except this list, so the list is the assertion.
    const names = table({ 'mixed.test': ['1.1.1.1', '127.0.0.1'] });
    const hops = scripted({ 'https://mixed.test/': { status: 200, body: PDF } });

    await expect(
      fetchGuardedPdf('https://mixed.test/', 1024, { resolve: names.resolve, transport: hops.transport }),
    ).rejects.toMatchObject({ reason: 'blocked-address' });
    expect(hops.connected).toStrictEqual([]);
  });

  it('refuses a downgrade to http at the hop, before resolving its host', async () => {
    const names = table({ 'first.test': ['1.1.1.1'], 'plain.test': ['1.1.1.1'] });
    const hops = scripted({ 'https://first.test/': { status: 302, location: 'http://plain.test/a.pdf' } });

    await expect(
      fetchGuardedPdf('https://first.test/', 1024, { resolve: names.resolve, transport: hops.transport }),
    ).rejects.toMatchObject({ reason: 'not-https' });
    expect(names.asked).toStrictEqual(['first.test']);
  });

  it('refuses one redirect past the bound, and CONTROL: follows exactly the bound', async () => {
    const chain = (length: number): Record<string, Scripted> => {
      const answers: Record<string, Scripted> = {};
      for (let at = 0; at < length; at += 1) {
        answers[`https://loop.test/${String(at)}`] = { status: 302, location: `/${String(at + 1)}` };
      }
      answers[`https://loop.test/${String(length)}`] = { status: 200, body: PDF };
      return answers;
    };
    const names = table({ 'loop.test': ['1.1.1.1'] });

    const within = await fetchGuardedPdf('https://loop.test/0', 1024, {
      resolve: names.resolve,
      transport: scripted(chain(MAX_URL_REDIRECTS)).transport,
    });
    expect(await readAll(within)).toBe(PDF);

    await expect(
      fetchGuardedPdf('https://loop.test/0', 1024, {
        resolve: names.resolve,
        transport: scripted(chain(MAX_URL_REDIRECTS + 1)).transport,
      }),
    ).rejects.toMatchObject({ reason: 'too-many-redirects' });
  });

  it('refuses a name that resolves to nothing, and an answer that is not a 2xx', async () => {
    const empty = table({});
    await expect(
      fetchGuardedPdf('https://nowhere.test/', 1024, { resolve: empty.resolve, transport: scripted({}).transport }),
    ).rejects.toMatchObject({ reason: 'unresolvable' });

    const names = table({ 'gone.test': ['1.1.1.1'] });
    await expect(
      fetchGuardedPdf('https://gone.test/', 1024, {
        resolve: names.resolve,
        transport: scripted({ 'https://gone.test/': { status: 404, body: 'not found' } }).transport,
      }),
    ).rejects.toMatchObject({ reason: 'http-error' });
  });
});

describe('fetchGuardedPdf, the body', () => {
  async function bodyOf(text: string, maxBytes = 1_000_000): Promise<string> {
    const names = table({ 'doc.test': ['1.1.1.1'] });
    const stream = await fetchGuardedPdf('https://doc.test/', maxBytes, {
      resolve: names.resolve,
      transport: scripted({ 'https://doc.test/': { status: 200, body: text } }).transport,
    });
    return readAll(stream);
  }

  it('refuses a body that is not a PDF, including a short one, and one whose marker starts too late', async () => {
    await expect(bodyOf('<html>error</html>')).rejects.toBeInstanceOf(UrlFetchRefused);
    await expect(bodyOf('<html>error</html>')).rejects.toMatchObject({ reason: 'not-a-pdf' });
    await expect(bodyOf(`${' '.repeat(PDF_PREFIX_BYTES)}${PDF}`)).rejects.toMatchObject({ reason: 'not-a-pdf' });
  });

  it('CONTROL: passes a PDF whose marker starts after a few bytes of junk, byte for byte', async () => {
    // PDF 32000-1 readers accept leading bytes before the header, and so does this check,
    // up to its window — so the window's edge is the case above, not the start of the file.
    const junk = '\u00ef\u00bb\u00bf  ';
    expect(await bodyOf(`${junk}${PDF}`)).toBe(`${junk}${PDF}`);
  });

  it('refuses a body past its ceiling by the bytes that arrived', async () => {
    await expect(bodyOf(`${PDF}${'x'.repeat(200)}`, 64)).rejects.toMatchObject({ reason: 'too-large' });
    expect(await bodyOf(PDF, PDF.length)).toBe(PDF);
  });
});
