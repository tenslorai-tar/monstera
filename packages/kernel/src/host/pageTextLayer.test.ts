import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createClient, wrapHandlers } from '@monstera/contract';

import type { ByteImage, MupdfSession } from '../engineSeam.js';
import { mupdfWriter } from '../mupdfWriter.js';
import { readPageTextWithLetters } from '../pageText.js';
import { engineChannels } from './engineChannels.js';
import { type EngineHandlerParts, type HostSession, createEngineHandlers } from './engineHandlers.js';
import { createRemoteSessions, remoteMupdfPageTextLayer } from './remoteEngine.js';

/**
 * THE LETTERS' FILE BESIDE `engine/page-text`'s ANSWER, over the real boundary
 * ([ADR-0280](../../../../docs/DECISIONS/0280-the-text-layer-places-each-letter-where-the-engine-reads-it.md), its
 * second and fourth corrections): the real handler and the real reader in the host, the contract's validating client,
 * and `main`'s reader. The output directory both halves see is one map, so a file left behind is a key still in it.
 */

const AREA = { snapshotDirectory: 'in', outputDirectory: 'out' };

/** What the host's boundary reported, so a case that fails inside the handler says why. */
const incidents: unknown[] = [];

/** The output directory, as both halves see it. */
const written = new Map<string, Uint8Array>();
const keyOf = (directory: string, name: string): string => `${directory}/${name}`;

let session: MupdfSession;

beforeAll(async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.TimesRoman);
  const page = document.addPage([612, 792]);
  ['Each letter of this line is where the engine reads it.', 'A second line.'].forEach((text, at) => {
    page.drawText(text, { x: 72.4, y: 700.6 - at * 20, size: 11, font });
  });
  session = await mupdfWriter.open(await document.save());
});

afterAll(async () => {
  await mupdfWriter.close(session);
});

/**
 * The host's handlers with only what this channel touches: its session table, its output directory and the text
 * layer's reader. Every other part throws if it is reached, so a case that wandered would fail rather than pass.
 */
function hostParts(overrides: Partial<Pick<EngineHandlerParts, 'pageTextLetters' | 'files'>> = {}): EngineHandlerParts {
  const held = new Map<string, HostSession>([['h1', { session, ...AREA }]]);
  const parts: Partial<EngineHandlerParts> = {
    sessions: {
      lookup: (id) => held.get(id),
      issue: () => {
        throw new Error('no case here opens a session');
      },
      forget: () => {
        throw new Error('no case here closes a session');
      },
    },
    files: {
      readSnapshot: () => {
        throw new Error('no case here reads a snapshot');
      },
      writeOutput: (directory, name, bytes) => {
        written.set(keyOf(directory, name), bytes);
        return Promise.resolve(bytes.length);
      },
      writeOutputStream: () => {
        throw new Error('no case here writes a stream');
      },
    },
    pageTextLetters: readPageTextWithLetters,
    ...overrides,
  };
  return new Proxy(parts, {
    get: (target, key) =>
      key in target
        ? target[key as keyof EngineHandlerParts]
        : () => {
            throw new Error(`the text layer's read reached ${String(key)}`);
          },
  }) as EngineHandlerParts;
}

let minted = 0;

/** `main`'s view of the same directory: take held to the announced count, refused unread otherwise; remove on absence. */
const areas = {
  // A NAME THE OUTPUT-NAME RULE ACCEPTS (`outputNameSchema`: hex digits and hyphens), fresh for each call.
  mintName: (): string => `abc-${(minted += 1).toString(16)}`,
  takeOutput: (area: typeof AREA, name: string, announced: number): Promise<ByteImage> => {
    const bytes = written.get(keyOf(area.outputDirectory, name));
    // REFUSED UNREAD, AND LEFT WHERE IT IS: the worst case for this side, so the reader's own removal is what is tested.
    if (bytes?.length !== announced) return Promise.reject(new Error(`announced ${String(announced)}, found ${String(bytes?.length)}`));
    written.delete(keyOf(area.outputDirectory, name));
    return Promise.resolve(bytes);
  },
  removeOutput: (area: typeof AREA, name: string): Promise<void> => {
    written.delete(keyOf(area.outputDirectory, name));
    return Promise.resolve();
  },
};

/** `main`'s reader over a client whose transport may be broken in the ways a case names. */
function reader(parts: EngineHandlerParts, transport: 'ok' | 'ends-after-answer' | 'drops-letters' = 'ok') {
  const wrapped = wrapHandlers(engineChannels, createEngineHandlers(parts), (incident) => {
    incidents.push(incident);
  });
  const client = createClient(engineChannels, async (id, params) => {
    const answer = (await wrapped[id](params)) as { ok: boolean; value?: Record<string, unknown> };
    // THE HOST ENDS MID-ANSWER: it has done its work, the file is written, and the answer never arrives.
    if (transport === 'ends-after-answer') throw new Error('the host ended before its answer arrived');
    if (transport === 'drops-letters' && answer.ok && answer.value !== undefined) {
      const { letters: _dropped, ...rest } = answer.value;
      return { ...answer, value: rest };
    }
    return answer;
  });
  const sessions = createRemoteSessions();
  const token = sessions.adopt('h1', AREA);
  const read = remoteMupdfPageTextLayer(client, sessions, areas);
  return () => read(token, 0);
}

describe('engine/page-text with the letters’ file (ADR-0280)', () => {
  it('answers the page’s JSON and its letters, taken at exactly the count the host wrote, and leaves no file', async () => {
    written.clear();
    incidents.length = 0;
    const answer = await reader(hostParts())().catch((error: unknown) => {
      throw new Error(`${String(error)}; the host reported ${JSON.stringify(incidents)}`);
    });
    expect(answer.truncated).toBe(false);
    expect(answer.json).toContain('A second line.');
    expect(answer.letters?.walked).toBe(2);
    // 2 lines: 12-byte headers and two bytes a letter, 54 and 14 letters.
    expect(answer.letters?.bytes.length).toBe(2 * 12 + 2 * (54 + 14));
    expect([...written.keys()]).toStrictEqual([]);
  });

  it('leaves no file when the read fails in the host after the letters were written', async () => {
    written.clear();
    const parts = hostParts({
      files: {
        readSnapshot: () => {
          throw new Error('unused');
        },
        writeOutput: (directory, name, bytes) => {
          written.set(keyOf(directory, name), bytes);
          return Promise.reject(new Error('the disk filled after the bytes landed'));
        },
        writeOutputStream: () => {
          throw new Error('unused');
        },
      },
    });
    await expect(reader(parts)()).rejects.toThrow();
    expect([...written.keys()]).toStrictEqual([]);
  });

  it('leaves no file when the host ends mid-answer, with the letters already written', async () => {
    written.clear();
    await expect(reader(hostParts(), 'ends-after-answer')()).rejects.toThrow('the host ended');
    expect([...written.keys()]).toStrictEqual([]);
  });

  it('leaves no file when the host announces another count than it wrote, and refuses the file unread', async () => {
    written.clear();
    const parts = hostParts({
      files: {
        readSnapshot: () => {
          throw new Error('unused');
        },
        writeOutput: (directory, name, bytes) => {
          written.set(keyOf(directory, name), bytes);
          return Promise.resolve(bytes.length + 2);
        },
        writeOutputStream: () => {
          throw new Error('unused');
        },
      },
    });
    await expect(reader(parts)()).rejects.toThrow('announced');
    expect([...written.keys()]).toStrictEqual([]);
  });

  it('places the page as today, and leaves no file, when an answer names no letters though a file was written', async () => {
    written.clear();
    const answer = await reader(hostParts(), 'drops-letters')();
    expect(answer.letters).toBeNull();
    expect(answer.json).toContain('A second line.');
    expect([...written.keys()]).toStrictEqual([]);
  });

  it('CONTROL: each failing case did write the file, so “no file left” is the reader removing it and not a write that never happened', async () => {
    written.clear();
    const parts = hostParts({
      files: {
        readSnapshot: () => {
          throw new Error('unused');
        },
        writeOutput: (directory, name, bytes) => {
          written.set(keyOf(directory, name), bytes);
          return Promise.resolve(bytes.length);
        },
        writeOutputStream: () => {
          throw new Error('unused');
        },
      },
    });
    const wrapped = wrapHandlers(engineChannels, createEngineHandlers(parts), () => undefined);
    await wrapped['engine/page-text']({ session: 'h1', page: 0, read: 'substrate', letters: 'abcdef' });
    expect([...written.keys()]).toStrictEqual(['out/abcdef']);
  });
});
