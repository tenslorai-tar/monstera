import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, type Socket, connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hostFilesystem, hostPipeStream } from './hostNodeSurfaces.js';

/** A pipe name nothing listens on yet: a Windows named pipe, or a socket file elsewhere. */
function pipeName(): string {
  const token = randomBytes(8).toString('hex');
  return process.platform === 'win32' ? `\\\\.\\pipe\\monstera-surfaces-${token}` : join(tmpdir(), `monstera-surfaces-${token}.sock`);
}

/** Lets the event loop run `turns` times, so whatever the socket was going to do by itself has happened. */
async function settle(turns = 20): Promise<void> {
  for (let at = 0; at < turns; at += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

/**
 * The host's end of the pipe, connected BEFORE the body registers for it (ADR-0251): a launcher connects, then loads
 * the handlers, then hands the stream over. What arrives in between must reach the body when it registers.
 */
describe('the host pipe, connected before the handlers exist', () => {
  it('an ending that happened before the body registered is reported when it does', async () => {
    // A PIPE NOBODY SERVES: the connect fails at once, which is the ending a launcher can meet while its handlers load.
    const stream = hostPipeStream(pipeName());
    await settle();
    const told: string[] = [];
    stream.onEnd((detail) => told.push(detail));
    expect(told).toHaveLength(1);
    expect(told[0]).toMatch(/^the pipe failed: /u);
  });

  it('CONTROL: a close listener registered after the same failure hears nothing, so the case above is the fix', async () => {
    const socket: Socket = connect({ path: pipeName() });
    socket.on('error', () => undefined);
    await settle();
    const heard: string[] = [];
    socket.once('close', () => heard.push('close'));
    await settle();
    expect(heard).toStrictEqual([]);
  });

  it('bytes the peer sent before the body registered for data are delivered when it does', async () => {
    const name = pipeName();
    const server: Server = createServer((peer) => {
      peer.write(Buffer.from('early frame'));
    });
    await new Promise<void>((resolve) => {
      server.listen(name, resolve);
    });
    try {
      const stream = hostPipeStream(name);
      await settle();
      const chunks: Uint8Array[] = [];
      stream.onData((chunk) => chunks.push(chunk));
      await settle();
      expect(Buffer.concat(chunks).toString()).toBe('early frame');
      stream.close();
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });
});

/**
 * The host's real file surface. `readSnapshot` hands the document's bytes to the engine, and the whole point of
 * reading them as a view is that it does not copy them — measured, 210 MB of the 200 MB scan's open peak. What a test
 * can hold it to is the property the view must keep: the array owns exactly what it spans, so its `.buffer` is the
 * document and nothing else (a `ByteImage`'s rule).
 */
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'monstera-host-files-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('the host reads a snapshot', () => {
  it.each([
    ['a small file', 37],
    ['a file larger than any pool', 3 * 1024 * 1024],
  ])('%s: the document’s own bytes, in an array that owns exactly what it spans', async (_label, size) => {
    const bytes = Uint8Array.from({ length: size }, (_unused, index) => (index * 31 + 7) & 0xff);
    writeFileSync(join(directory, 'snapshot.pdf'), bytes);

    const read = await hostFilesystem.readSnapshot(directory, 'snapshot.pdf');
    expect(read.byteLength).toBe(size);
    expect(read.byteOffset).toBe(0);
    expect(read.buffer.byteLength).toBe(size);
    expect(Buffer.from(read).equals(Buffer.from(bytes))).toBe(true);
  });
});
