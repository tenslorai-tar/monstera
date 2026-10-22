import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { type IncomingHttpHeaders, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  POST_CHUNK_BYTES,
  type PostTransport,
  type Resolve,
  type StagedImage,
  postGuarded,
  writeInParts,
} from '@monstera/kernel';
import { afterEach, describe, expect, it } from 'vitest';

import { sentFromBodyFile, sentFromStaged } from './stagedUpload.js';

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

describe('a whole document posted from its staged file (ADR-0261 Decision 2)', () => {
  /** A staged image as a host leaves one: a file of its own, MOVED by `place`, removed by `discard`. */
  function stagedFile(bytes: Uint8Array): { readonly staged: StagedImage; readonly path: string } {
    const path = join(directory, 'host', 'staged.pdf');
    mkdirSync(join(directory, 'host'), { recursive: true });
    writeFileSync(path, bytes);
    return {
      path,
      staged: {
        byteLength: bytes.byteLength,
        place: (destination) => rename(path, destination),
        discard: () => rm(path, { force: true }),
      },
    };
  }
  const resolve: Resolve = (host) =>
    Promise.resolve([{ address: host === 'inside.example' ? '10.0.0.7' : '93.184.216.34', family: 4 }]);
  /** A socket that is always full, resolving through the guard's own `lookup`, and keeping what each part carried. */
  function recording(): { readonly transport: PostTransport; readonly written: Uint8Array[]; readonly filesDuring: string[][] } {
    const written: Uint8Array[] = [];
    const filesDuring: string[][] = [];
    const transport: PostTransport = (url, lookup, _idle, body) =>
      new Promise((settle, reject) => {
        lookup(url.hostname, { all: true }, (error) => {
          if (error !== null) {
            reject(error);
            return;
          }
          filesDuring.push(readdirSync(join(directory, '.uploads')));
          writeInParts(body, {
            write: (part) => {
              written.push(Uint8Array.from(part));
              return false;
            },
            drained: () => Promise.resolve(),
          }).then(() => {
            settle({ statusCode: 200 });
          }, reject);
        });
      });
    return { transport, written, filesDuring };
  }

  it('posts the document from a private file a part at a time, every byte in order, and leaves no file behind', async () => {
    directory = mkdtempSync(join(tmpdir(), 'monstera-post-document-'));
    const bytes = Uint8Array.from({ length: 2 * POST_CHUNK_BYTES + 4321 }, (_unused, at) => (at * 7) & 0xff);
    const { staged, path } = stagedFile(bytes);
    const { transport, written, filesDuring } = recording();
    await sentFromStaged(staged, directory, (source) =>
      postGuarded('https://forms.example/take', source, 'application/pdf', { resolve, transport }),
    );
    // SENT FROM ONE FILE in the uploads folder, which existed while the request was made.
    expect(filesDuring.map((names) => names.length)).toStrictEqual([1]);
    // BOUNDED: no part past the part size, so `main` held one part and never the document.
    expect(written.map((part) => part.byteLength)).toStrictEqual([POST_CHUNK_BYTES, POST_CHUNK_BYTES, 4321]);
    expect(Buffer.concat(written).equals(Buffer.from(bytes))).toBe(true);
    expect(readdirSync(join(directory, '.uploads'))).toStrictEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it('CONTROL: to a private address nothing is written, and the file and the staged image are both gone', async () => {
    directory = mkdtempSync(join(tmpdir(), 'monstera-post-document-'));
    const { staged, path } = stagedFile(new Uint8Array(POST_CHUNK_BYTES + 1));
    const { transport, written } = recording();
    await expect(
      sentFromStaged(staged, directory, (source) =>
        postGuarded('https://inside.example/take', source, 'application/pdf', { resolve, transport }),
      ),
    ).rejects.toMatchObject({ reason: 'blocked-address' });
    expect(written).toStrictEqual([]);
    expect(readdirSync(join(directory, '.uploads'))).toStrictEqual([]);
    expect(existsSync(path)).toBe(false);
  });
});

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
