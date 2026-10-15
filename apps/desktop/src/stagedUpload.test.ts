import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { type IncomingHttpHeaders, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { sentFromBodyFile } from './stagedUpload.js';

/**
 * A body written to a file and sent as a file-backed `Blob` (ADR-0165's correction of 2026-10-15).
 *
 * ## The framing is run, not asserted
 *
 * The claim that lets *Send to DocuSign* stream without a new live run is that the request is the one the live run
 * proved: the same bytes, sent with their `content-length`, never chunked. That is Node's `fetch` behaviour, so these
 * cases send to a real server on loopback and read what arrived, headers and all.
 */

let directory = '';
afterEach(() => {
  if (directory !== '') rmSync(directory, { recursive: true, force: true });
  directory = '';
});

/** A loopback server that answers `{}` and keeps each request's headers and body. */
async function listening(): Promise<{
  readonly url: string;
  readonly received: { readonly headers: IncomingHttpHeaders; readonly body: string }[];
  readonly close: () => Promise<void>;
}> {
  const received: { headers: IncomingHttpHeaders; body: string }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/`,
    received,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

async function* parts(...each: string[]): AsyncGenerator<string> {
  for (const part of each) yield await Promise.resolve(part);
}

describe('sentFromBodyFile', () => {
  it('sends the parts joined, WITH their content-length and not chunked, and leaves no file behind', async () => {
    directory = mkdtempSync(join(tmpdir(), 'body-file-'));
    const server = await listening();
    try {
      const written = ['{"documents":[{"documentBase64":"', 'JVBERi0', 'xLjc=', '"}]}'];
      const status = await sentFromBodyFile(parts(...written), directory, async (body) => {
        const response = await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
        await response.text();
        return response.status;
      });

      expect(status).toBe(200);
      const [request] = server.received;
      expect(request?.body).toBe(written.join(''));
      // THE PROVEN FRAMING: the length declared up front, as a whole-string body sends it.
      expect(request?.headers['content-length']).toBe(String(Buffer.byteLength(written.join(''), 'utf8')));
      expect(request?.headers['transfer-encoding']).toBeUndefined();
      expect(readdirSync(join(directory, '.uploads'))).toStrictEqual([]);
    } finally {
      await server.close();
    }
  });

  it('CONTROL: a streamed body with no known length IS sent chunked, which is why the body is a Blob', async () => {
    const server = await listening();
    try {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"a":'));
          controller.enqueue(new TextEncoder().encode('1}'));
          controller.close();
        },
      });
      const response = await fetch(server.url, { method: 'POST', body: stream, duplex: 'half' });
      await response.text();
      expect(server.received[0]?.headers['transfer-encoding']).toBe('chunked');
      expect(server.received[0]?.headers['content-length']).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it('removes the body file when the send throws', async () => {
    directory = mkdtempSync(join(tmpdir(), 'body-file-'));
    await expect(
      sentFromBodyFile(parts('{}'), directory, () => Promise.reject(new Error('the network is down in this case'))),
    ).rejects.toThrow('the network is down in this case');
    expect(readdirSync(join(directory, '.uploads'))).toStrictEqual([]);
  });
});
