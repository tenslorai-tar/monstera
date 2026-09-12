import { describe, expect, it } from 'vitest';

import {
  CLAUDE_MAX_EDGE,
  CLAUDE_OCR_MODEL,
  ClaudeRecognitionRefused,
  claudeRasterScale,
  fitsClaudeImage,
  pngSize,
  recogniseThroughClaude,
} from './ocrClaude.js';

/**
 * The Claude recogniser, driven end to end with no network and no key.
 *
 * ## WHAT THESE CASES ASSERT, AND WHAT THEY CANNOT
 *
 * Every fixture is written **from Anthropic's documentation**, read 2026-09-13. So
 * what passes is a reading of the documented request and response — not evidence
 * that the service places boxes where this build expects. That is the D6 row's
 * open trigger, one live run, and it is said here too because a file of green cases
 * about a cloud API is exactly the shape that reads as verified.
 *
 * ## The coordinate case asserts the drawn point AND the mirrored one
 *
 * `ocrAzure.test.ts`' pair and its reason: on a centred fixture a flipped sign
 * produces the identical box, so a box containing the drawn point alone could be
 * the right answer for the wrong reason.
 */

const CREDENTIALS = { key: 'k' };

/** The frame a 200×300 raster of an upright page carries, at scale 1 and origin zero. */
const FRAME = {
  crop: [0, 0, 200, 300] as const,
  rotation: 0 as const,
  origin: [0, 0] as const,
  scale: 1,
};

/**
 * A PNG header claiming `width × height`, built byte by byte.
 *
 * Only the signature and IHDR are real, which is all `pngSize` reads and all the
 * recogniser needs from the raster: the service is scripted, so no decoder ever
 * sees these bytes.
 */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** A Messages response carrying `json` as its text, with `stopReason`. */
function answer(json: unknown, stopReason = 'end_turn'): Response {
  return new Response(
    JSON.stringify({
      stop_reason: stopReason,
      content: [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** What `fetch` was called with, as a string, whichever of its three forms it took. */
function addressOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** A scripted service that records what it was sent. */
function service(respond: () => Response | Error): {
  readonly fetchImpl: typeof fetch;
  readonly calls: { url: string; init: RequestInit | undefined }[];
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: addressOf(input), init });
    const next = respond();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** One word at a known pixel box, as Claude would answer it. */
const ONE_WORD = { lines: [{ words: [{ text: 'MONSTERA', box: [20, 30, 80, 50] }] }] };

describe('fitsClaudeImage — Anthropic’s resize rule', () => {
  it('fits an image at the edge limit, and CONTROL: one pixel more does not', () => {
    // 2576 is a whole number of 28 px patches (92), so it is the largest edge that
    // needs no rounding past the limit.
    expect(fitsClaudeImage(CLAUDE_MAX_EDGE, 28)).toBe(true);
    expect(fitsClaudeImage(CLAUDE_MAX_EDGE + 1, 28)).toBe(false);
  });

  it('fits 69×69 patches, and CONTROL: 70×70 is past the 4784-token budget', () => {
    expect(fitsClaudeImage(69 * 28, 69 * 28)).toBe(true);
    expect(fitsClaudeImage(70 * 28, 70 * 28)).toBe(false);
  });
});

describe('claudeRasterScale', () => {
  it('keeps the ceiling for a letter page, which fits at 2×', () => {
    expect(claudeRasterScale(612, 792, 2, 1)).toBe(2);
  });

  it('lowers the scale for a larger region to the LARGEST that fits', () => {
    const scale = claudeRasterScale(842, 1191, 2, 1);
    expect(scale).not.toBeNull();
    if (scale === null) return;
    expect(scale).toBeLessThan(2);
    // THE LARGEST, not merely one that fits: a hundredth more must not.
    expect(fitsClaudeImage(Math.ceil(842 * scale) + 1, Math.ceil(1191 * scale) + 1)).toBe(true);
    const next = scale + 0.01;
    expect(fitsClaudeImage(Math.ceil(842 * next) + 1, Math.ceil(1191 * next) + 1)).toBe(false);
  });

  it('answers null for a region too large at the smallest scale', () => {
    expect(claudeRasterScale(3000, 3000, 2, 1)).toBeNull();
  });
});

describe('pngSize', () => {
  it('reads IHDR’s width and height', () => {
    expect(pngSize(pngHeader(640, 480))).toStrictEqual({ width: 640, height: 480 });
  });

  it('CONTROL: refuses bytes that are not a PNG', () => {
    const notPng = pngHeader(640, 480);
    notPng[1] = 0;
    expect(() => pngSize(notPng)).toThrow(/not a PNG/u);
  });
});

describe('recogniseThroughClaude', () => {
  it('POSTS the image with oversized_image: error and a JSON schema, the key in a HEADER', async () => {
    const { fetchImpl, calls } = service(() => answer(ONE_WORD));

    await recogniseThroughClaude(CREDENTIALS, { png: pngHeader(200, 300), ...FRAME, fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    // THE BODY IS A STRING, asserted before it is parsed — so a body the
    // recogniser sent in some other form fails here rather than parsing as text.
    const sent = calls[0]?.init?.body;
    expect(typeof sent).toBe('string');
    if (typeof sent !== 'string') return;
    const body = JSON.parse(sent) as {
      model: string;
      messages: { content: { type: string; transformations?: unknown }[] }[];
      output_config: { format: { type: string } };
    };
    expect(body.model).toBe(CLAUDE_OCR_MODEL);
    expect(body.messages[0]?.content[0]).toMatchObject({
      type: 'image',
      transformations: { oversized_image: 'error' },
    });
    expect(body.output_config.format.type).toBe('json_schema');
    // AND NEVER IN THE URL.
    expect(calls[0]?.url).not.toContain('k');
  });

  it('PUTS THE WORD WHERE IT WAS DRAWN, and CONTROL: not at the mirrored point', async () => {
    const { fetchImpl } = service(() => answer(ONE_WORD));

    const page = await recogniseThroughClaude(CREDENTIALS, {
      png: pngHeader(200, 300),
      ...FRAME,
      fetchImpl,
    });

    const box = page.lines[0]?.words[0]?.box;
    expect(box).toBeDefined();
    if (box === undefined) return;
    // Pixel (50, 40) is the word's centre; at scale 1 on a 0..300 crop, its PDF y is
    // 300 − 40 = 260. The mirrored point is PDF y 40.
    const inside = (x: number, y: number): boolean =>
      x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
    expect(inside(50, 260)).toBe(true);
    expect(inside(50, 40)).toBe(false);
    expect(page.lines[0]?.text).toBe('MONSTERA');
  });

  it('refuses a raster Claude would resize BEFORE sending anything', async () => {
    // THE DECISION IS THE ASSERTION: no request was made. A refusal after the call
    // would also say `too-large`, having uploaded the region anyway.
    const { fetchImpl, calls } = service(() => answer(ONE_WORD));

    await expect(
      recogniseThroughClaude(CREDENTIALS, { png: pngHeader(3000, 10), ...FRAME, fetchImpl }),
    ).rejects.toMatchObject({ reason: 'too-large' });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['refusal', 'refused'],
    ['max_tokens', 'truncated'],
    ['model_context_window_exceeded', 'truncated'],
    ['pause_turn', 'unreadable-answer'],
  ])('a %s stop is refused as %s, never read as a page', async (stop, reason) => {
    const { fetchImpl } = service(() => answer(ONE_WORD, stop));
    await expect(
      recogniseThroughClaude(CREDENTIALS, { png: pngHeader(200, 300), ...FRAME, fetchImpl }),
    ).rejects.toMatchObject({ reason });
  });

  it.each([
    [401, 'unauthorised'],
    [403, 'unauthorised'],
    [429, 'unavailable'],
    [529, 'unavailable'],
    [400, 'rejected'],
  ])('HTTP %i is refused as %s', async (status, reason) => {
    const { fetchImpl } = service(() => new Response('{}', { status }));
    await expect(
      recogniseThroughClaude(CREDENTIALS, { png: pngHeader(200, 300), ...FRAME, fetchImpl }),
    ).rejects.toMatchObject({ reason });
  });

  it('refuses the whole answer when a box lies outside the raster', async () => {
    const outside = { lines: [{ words: [{ text: 'MONSTERA', box: [20, 30, 260, 50] }] }] };
    const { fetchImpl } = service(() => answer(outside));
    await expect(
      recogniseThroughClaude(CREDENTIALS, { png: pngHeader(200, 300), ...FRAME, fetchImpl }),
    ).rejects.toMatchObject({ reason: 'unreadable-answer' });
  });

  it('refuses a box that is not four numbers', async () => {
    const short = { lines: [{ words: [{ text: 'MONSTERA', box: [20, 30, 80] }] }] };
    const { fetchImpl } = service(() => answer(short));
    await expect(
      recogniseThroughClaude(CREDENTIALS, { png: pngHeader(200, 300), ...FRAME, fetchImpl }),
    ).rejects.toMatchObject({ reason: 'unreadable-answer' });
  });

  it('refuses text that is not the JSON asked for', async () => {
    const { fetchImpl } = service(() => answer('Here are the words: MONSTERA'));
    await expect(
      recogniseThroughClaude(CREDENTIALS, { png: pngHeader(200, 300), ...FRAME, fetchImpl }),
    ).rejects.toMatchObject({ reason: 'unreadable-answer' });
  });

  it('reports an unreachable service as its own reason', async () => {
    const { fetchImpl } = service(() => new TypeError('fetch failed'));
    const refused = recogniseThroughClaude(CREDENTIALS, {
      png: pngHeader(200, 300),
      ...FRAME,
      fetchImpl,
    });
    await expect(refused).rejects.toBeInstanceOf(ClaudeRecognitionRefused);
    await expect(refused).rejects.toMatchObject({ reason: 'unreachable' });
  });

  it('answers an image with no text as an empty page, not a refusal', async () => {
    const { fetchImpl } = service(() => answer({ lines: [] }));
    const page = await recogniseThroughClaude(CREDENTIALS, {
      png: pngHeader(200, 300),
      ...FRAME,
      fetchImpl,
    });
    expect(page.lines).toStrictEqual([]);
  });
});
