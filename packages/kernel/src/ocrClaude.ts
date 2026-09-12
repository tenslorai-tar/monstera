import type { OcrLanguage } from '@monstera/contract';
import type { PdfPoint, Rotation } from '@monstera/shared';
import { pageTransform, toPdf, viewportPoint } from '@monstera/shared';
import { z } from 'zod';

import type { RecognisedLine, RecognisedPage, RecognisedWord } from './ocrRecognise.js';

/**
 * Recognition by Anthropic's Claude — D6's fourth recogniser, added 2026-09-12
 * after Stage 6 closed
 * ([ADR-0057](../../../docs/DECISIONS/0057-a-network-recogniser-is-keyed-by-engine-and-a-providers-key-is-the-providers.md)).
 *
 * ## Azure's class, and the ways it is not Azure
 *
 * It executes in `main`, because invariant 25 gives the engine host no network. It
 * reads the region raster the host produced and the frame that came with it, and
 * answers a `RecognisedPage` through the one converter — ADR-0052 §7's route,
 * unchanged. What differs is what the service promises, and every rule below comes
 * from Anthropic's own documentation, read 2026-09-13:
 *
 * - **Coordinates are pixels in the image Claude SEES, after any resize**
 *   (*Coordinates and bounding boxes*). So the raster is sized to fit before it is
 *   sent, and the image block carries `"oversized_image": "error"`: a resize the
 *   build did not do then becomes a refusal instead of a silent shift of every box.
 * - **They are approximate.** That word is Anthropic's, so how approximate is the
 *   live run's to measure; the row is not done until one happens.
 * - **The answer's shape is constrained by `output_config.format`, but the schema
 *   cannot bound a number or an array's length** (*Structured outputs*). So every
 *   box is checked here against the raster it claims to be in.
 * - **A refusal arrives as HTTP 200** (*Handling stop reasons*), and `max_tokens`
 *   cuts the JSON off. Any stop reason but `end_turn` is refused by name — never
 *   read as a page with no text on it.
 *
 * ## What it does not claim
 *
 * **No confidence.** Claude reports none, and inventing one would be a number this
 * build made up about a service's judgement; a word's confidence is 0, the value
 * `recogniseThroughAzure` uses for a missing one.
 */

/**
 * The model, read from Anthropic's models overview on 2026-09-13: vision, the
 * high-resolution image tier, and structured outputs, at $5 / $25 per million
 * input / output tokens. **A constant until Stage 9's model setting exists**, which
 * the D6 row names as this constant's expiry.
 */
export const CLAUDE_OCR_MODEL = 'claude-opus-5';

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * The high-resolution tier's image limits (*Vision*, read 2026-09-13): a long edge
 * of 2576 px and 4784 visual tokens, one token per 28×28 patch. `claude-opus-5` is
 * on that tier, as every Claude 4.7-or-later model is.
 */
export const CLAUDE_MAX_EDGE = 2576;
export const CLAUDE_MAX_VISUAL_TOKENS = 4784;
const PATCH = 28;

/** How long the answer may run. A region's words are far below it; a cut-off is refused. */
const MAX_OUTPUT_TOKENS = 16_000;

/** Why a recognition did not happen. */
export type ClaudeRefusal =
  | 'unauthorised'
  | 'rejected'
  | 'unavailable'
  | 'unreachable'
  | 'refused'
  | 'truncated'
  | 'too-large'
  | 'unreadable-answer';

/** A refused recognition, carrying which thing refused it — `AzureRecognitionRefused`'s shape. */
export class ClaudeRecognitionRefused extends Error {
  readonly reason: ClaudeRefusal;

  constructor(reason: ClaudeRefusal, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ClaudeRecognitionRefused';
    this.reason = reason;
  }
}

/** The key, from `secretStore.ts`. Never logged, and sent only in a header. */
export interface ClaudeCredentials {
  readonly key: string;
}

/** One raster, and the frame the host says it sits in. `AzureRequest`'s fields. */
export interface ClaudeRequest {
  readonly png: Uint8Array;
  readonly crop: readonly [number, number, number, number];
  readonly rotation: Rotation;
  readonly origin: readonly [number, number];
  readonly scale: number;
  /** Injected so the cases drive the protocol with no network and no key. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Whether Claude reads a raster of this size WITHOUT resizing it — Anthropic's
 * rule, *How Claude resizes and pads images*: each side rounded up to a whole patch
 * is within the edge limit, and the patch count is within the token limit.
 */
export function fitsClaudeImage(width: number, height: number): boolean {
  return (
    Math.ceil(width / PATCH) * PATCH <= CLAUDE_MAX_EDGE &&
    Math.ceil(height / PATCH) * PATCH <= CLAUDE_MAX_EDGE &&
    Math.ceil(width / PATCH) * Math.ceil(height / PATCH) <= CLAUDE_MAX_VISUAL_TOKENS
  );
}

/**
 * The largest raster scale, from `ceiling` down to `floor` in hundredths, whose
 * raster of a region this size Claude reads unresized — or `null` when none does.
 *
 * **One pixel of slack on each axis**, because the host's `deviceBox` rounds
 * outward: the raster is up to a pixel larger than `points × scale`. A `null` is a
 * region too large to send at the smallest scale the snapshot accepts, which the
 * caller refuses by name before rasterising anything.
 */
export function claudeRasterScale(
  widthPoints: number,
  heightPoints: number,
  ceiling: number,
  floor: number,
): number | null {
  for (
    let hundredths = Math.round(ceiling * 100);
    hundredths >= Math.round(floor * 100);
    hundredths -= 1
  ) {
    const scale = hundredths / 100;
    if (fitsClaudeImage(Math.ceil(widthPoints * scale) + 1, Math.ceil(heightPoints * scale) + 1)) {
      return scale;
    }
  }
  return null;
}

/**
 * A PNG's pixel size, read from its IHDR chunk.
 *
 * The PNG specification fixes it: an eight-byte signature, then the IHDR chunk,
 * whose width and height are the first eight bytes of its data, big-endian. The
 * raster is the host's own output, so a buffer that is not a PNG is a defect in
 * this build and throws as one rather than as a refusal.
 */
export function pngSize(png: Uint8Array): { readonly width: number; readonly height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const isPng =
    png.byteLength >= 24 &&
    signature.every((byte, index) => png[index] === byte) &&
    String.fromCharCode(png[12] ?? 0, png[13] ?? 0, png[14] ?? 0, png[15] ?? 0) === 'IHDR';
  if (!isPng) throw new Error('the region raster is not a PNG, so its size cannot be read');
  return { width: header.getUint32(16), height: header.getUint32(20) };
}

/** What is asked for. English, because the model reads it; no person ever does. */
const INSTRUCTION =
  'Transcribe every word of text visible in this image, in reading order, grouped into lines. ' +
  'For each word give its exact text and its bounding box as [x1, y1, x2, y2]: the top-left and ' +
  'bottom-right corners, in pixel coordinates of this image, with the origin at the top-left ' +
  'corner. If the image contains no text, return an empty list of lines.';

/** The answer's shape, as `output_config.format` constrains it. */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          words: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                box: { type: 'array', items: { type: 'number' } },
              },
              required: ['text', 'box'],
              additionalProperties: false,
            },
          },
        },
        required: ['words'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
} as const;

/** The same shape, checked here, because the schema above cannot bound a box. */
const answerSchema = z.object({
  lines: z.array(
    z.object({
      words: z.array(z.object({ text: z.string(), box: z.array(z.number()) })),
    }),
  ),
});

/** The parts of a Messages response this build reads. */
const messageSchema = z.object({
  stop_reason: z.string().nullable(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

/** A refusal for an HTTP status, by the error types the API documents. */
function refusalFor(status: number): ClaudeRecognitionRefused {
  if (status === 401 || status === 403) {
    return new ClaudeRecognitionRefused('unauthorised', `the Claude API refused the key (${String(status)})`);
  }
  if (status === 413) {
    return new ClaudeRecognitionRefused('too-large', 'the Claude API refused the request as too large (413)');
  }
  if (status === 429 || status === 500 || status === 504 || status === 529) {
    return new ClaudeRecognitionRefused(
      'unavailable',
      `the Claude API is not taking requests right now (${String(status)})`,
    );
  }
  return new ClaudeRecognitionRefused('rejected', `the Claude API rejected the request (${String(status)})`);
}

/** The extent of a box's four corners once converted to the page. */
function pageBoxOf(
  [x1, y1, x2, y2]: readonly [number, number, number, number],
  toPage: (x: number, y: number) => PdfPoint,
): readonly [number, number, number, number] {
  const corners = [toPage(x1, y1), toPage(x2, y1), toPage(x2, y2), toPage(x1, y2)];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Sends one region's raster to Claude and answers a `RecognisedPage`.
 *
 * @throws {@link ClaudeRecognitionRefused} for every way this does not happen.
 */
export async function recogniseThroughClaude(
  credentials: ClaudeCredentials,
  request: ClaudeRequest,
): Promise<RecognisedPage> {
  const { width, height } = pngSize(request.png);
  if (!fitsClaudeImage(width, height)) {
    throw new ClaudeRecognitionRefused(
      'too-large',
      `a ${String(width)}×${String(height)} raster is larger than Claude reads without resizing, ` +
        'and the coordinates of a resized image would not be this raster’s',
    );
  }

  const fetchImpl = request.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': credentials.key,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_OCR_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: Buffer.from(request.png).toString('base64'),
                },
                // A RESIZE BECOMES A 400, never a silent shift of every box.
                transformations: { oversized_image: 'error' },
              },
              { type: 'text', text: INSTRUCTION },
            ],
          },
        ],
        output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      }),
    });
  } catch (cause) {
    throw new ClaudeRecognitionRefused('unreachable', 'the Claude API could not be reached', {
      cause,
    });
  }
  if (!response.ok) throw refusalFor(response.status);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new ClaudeRecognitionRefused('unreadable-answer', 'the Claude API answered something that is not JSON', {
      cause,
    });
  }
  const message = messageSchema.safeParse(payload);
  if (!message.success) {
    throw new ClaudeRecognitionRefused('unreadable-answer', 'the Claude API answered a message this build cannot read');
  }

  // ONLY `end_turn` IS AN ANSWER. A refusal is a 200 and a cut-off is a 200; both
  // would otherwise parse, or fail to parse, as if they were a page.
  const stop = message.data.stop_reason;
  if (stop === 'refusal') {
    throw new ClaudeRecognitionRefused('refused', 'Claude declined to read the region');
  }
  if (stop === 'max_tokens' || stop === 'model_context_window_exceeded') {
    throw new ClaudeRecognitionRefused('truncated', `Claude's answer was cut off (${stop})`);
  }
  if (stop !== 'end_turn') {
    throw new ClaudeRecognitionRefused('unreadable-answer', `Claude stopped for a reason this build does not read (${String(stop)})`);
  }

  const text = message.data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new ClaudeRecognitionRefused('unreadable-answer', 'Claude’s answer is not the JSON it was asked for', {
      cause,
    });
  }
  const answer = answerSchema.safeParse(parsed);
  if (!answer.success) {
    throw new ClaudeRecognitionRefused('unreadable-answer', 'Claude’s answer is not the shape it was asked for');
  }

  const transform = pageTransform(
    { x0: request.crop[0], y0: request.crop[1], x1: request.crop[2], y1: request.crop[3] },
    request.rotation,
    request.scale,
  );
  const toPage = (x: number, y: number): PdfPoint =>
    toPdf(viewportPoint(x + request.origin[0], y + request.origin[1]), transform);

  const lines: RecognisedLine[] = [];
  for (const line of answer.data.lines) {
    const words: RecognisedWord[] = [];
    for (const word of line.words) {
      // EVERY BOX IS CHECKED AGAINST THE RASTER IT CLAIMS TO BE IN. The schema
      // could not bound it, and a box outside the image or inside out is a
      // coordinate the answer got wrong — so the whole answer is refused rather
      // than one word drawn somewhere nobody asked for.
      const [x1, y1, x2, y2] = word.box;
      if (
        word.box.length !== 4 ||
        x1 === undefined ||
        y1 === undefined ||
        x2 === undefined ||
        y2 === undefined ||
        !(x1 >= 0 && y1 >= 0 && x1 < x2 && y1 < y2 && x2 <= width && y2 <= height)
      ) {
        throw new ClaudeRecognitionRefused(
          'unreadable-answer',
          `Claude placed a word outside the ${String(width)}×${String(height)} raster it was reading`,
        );
      }
      words.push({ text: word.text, box: pageBoxOf([x1, y1, x2, y2], toPage), confidence: 0 });
    }
    if (words.length === 0) continue;
    const xs = words.flatMap((word) => [word.box[0], word.box[2]]);
    const ys = words.flatMap((word) => [word.box[1], word.box[3]]);
    lines.push({
      text: words.map((word) => word.text).join(' '),
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      words,
    });
  }

  return {
    lines,
    confidence: 0,
    // `recogniseThroughAzure`'s reason: the service detects the language, and a
    // `RecognisedPage` must name one of a closed set.
    language: 'eng' satisfies OcrLanguage,
  };
}
