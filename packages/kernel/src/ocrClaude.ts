import type { OcrLanguage } from '@monstera/contract';
import type { PdfPoint, Rotation } from '@monstera/shared';
import { pageTransform, toPdf, viewportPoint } from '@monstera/shared';
import { z } from 'zod';

import { anthropicErrorMessage, isAnthropicOutOfCredit } from './anthropicCredit.js';
import type { RecognisedLine, RecognisedPage, RecognisedWord } from './ocrRecognise.js';
import { type RecognisedTable, placedTables } from './recognisedTables.js';

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

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * A model's native image resolution: the long edge and the visual tokens (one per 28×28 patch) it reads WITHOUT
 * resizing. A picture past either is downscaled by the service — or, on a request marked `"oversized_image": "error"`
 * as the recogniser's are, refused with a 400.
 */
export interface ClaudeImageLimits {
  readonly edge: number;
  readonly visualTokens: number;
}

/**
 * THE ONE TABLE of what each model reads unresized, read from *Vision › Resolution and token cost*
 * (platform.claude.com/docs/en/build-with-claude/vision) on 2026-10-08: two tiers, and which model is on which is
 * {@link claudeImageLimits}'s alone. Every image request this build makes is sized from this table — the recognisers,
 * the table reader, the Assistant's page picture — so a model is never sent a raster for another tier's limits (B3a).
 *
 * The recogniser was sized for the high-resolution tier whatever the model was, and the person's own choice of Haiku 4.5
 * (ADR-0117) answered a 400: *an image of 1191x1684 exceeds the maximum image size of the model and would be downsized
 * to 924x1307* (the owner's screenshot of 2026-10-07; 43 × 61 patches is 2623 visual tokens against Haiku's 1568).
 */
export const CLAUDE_HIGH_RESOLUTION: ClaudeImageLimits = { edge: 2576, visualTokens: 4784 };
export const CLAUDE_STANDARD_RESOLUTION: ClaudeImageLimits = { edge: 1568, visualTokens: 1568 };
const PATCH = 28;

/** The first model generation on the high-resolution tier: *"Claude 4.7 and later models"* (the same page). */
const HIGH_RESOLUTION_FROM = { major: 4, minor: 7 } as const;

/**
 * The limits for a model id: **the high-resolution tier for Claude 4.7 and later, the standard tier for every other
 * model**, which is the documentation's own sentence.
 *
 * ## An id this cannot place gets the STANDARD tier
 *
 * The tighter of the two, so a raster sized for it is read unresized by every model; the cost of a wrong guess is fidelity,
 * never a refusal. The generation is read from the id's `claude-<family>-<major>[-<minor>]` or `claude-<major>[-<minor>]-<family>`
 * form; a trailing eight-digit date is not a minor.
 */
export function claudeImageLimits(model: string): ClaudeImageLimits {
  const named =
    /^claude-(?:opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-|$)/u.exec(model) ??
    /^claude-(\d+)(?:-(\d{1,2}))?-(?:opus|sonnet|haiku|fable)(?:-|$)/u.exec(model);
  if (named === null) return CLAUDE_STANDARD_RESOLUTION;
  const major = Number(named[1]);
  const minor = named[2] === undefined ? 0 : Number(named[2]);
  const high =
    major > HIGH_RESOLUTION_FROM.major || (major === HIGH_RESOLUTION_FROM.major && minor >= HIGH_RESOLUTION_FROM.minor);
  return high ? CLAUDE_HIGH_RESOLUTION : CLAUDE_STANDARD_RESOLUTION;
}

/** How long the answer may run. A region's words are far below it; a cut-off is refused. */
const MAX_OUTPUT_TOKENS = 16_000;

/** Why a recognition did not happen. */
export type ClaudeRefusal =
  | 'unauthorised'
  | 'out-of-credit'
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

/**
 * The key, from `secretStore.ts` — never logged, and sent only in a header — and the model to read with: Anthropic's
 * entry of `ai.models`, or `defaultModel` of Anthropic's list when none was chosen ([ADR-0117](../../../docs/DECISIONS/0117-an-ai-model-is-chosen-per-provider-from-the-fetched-list.md)).
 * Required, so no caller can send a model this module chose.
 */
export interface ClaudeCredentials {
  readonly key: string;
  readonly model: string;
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
export function fitsClaudeImage(width: number, height: number, limits: ClaudeImageLimits): boolean {
  return (
    Math.ceil(width / PATCH) * PATCH <= limits.edge &&
    Math.ceil(height / PATCH) * PATCH <= limits.edge &&
    Math.ceil(width / PATCH) * Math.ceil(height / PATCH) <= limits.visualTokens
  );
}

/**
 * The most an image may weigh once base64-encoded, in bytes.
 *
 * Read from the API's own refusal on 2026-09-18, sending a 2240×1652 scan whose PNG
 * was 8,234,490 bytes: *"image exceeds 10 MB maximum: 10979320 bytes > 10485760
 * bytes"*. The limit is on the ENCODED form, which is four bytes for every three, so a
 * raster that passes {@link fitsClaudeImage} can still be refused: pixels and bytes are
 * separate limits, and a photographed page compresses badly.
 */
export const CLAUDE_MAX_IMAGE_ENCODED_BYTES = 10_485_760;

/**
 * The largest side, in pixels, the API accepts at all — *"The maximum dimensions per image are 8000x8000 px"*
 * (*Vision*, Request limits, read 2026-10-02 at platform.claude.com/docs/en/build-with-claude/vision). A picture past
 * the model's own edge (`ClaudeImageLimits`) and inside this is downscaled by the service; past this it is refused. It applies while a
 * request carries at most 20 images, which the eight attachments and a page picture stay under.
 */
export const CLAUDE_MAX_IMAGE_SIDE = 8000;

/** The base64 length of `bytes` raw bytes, which is what the limit above counts. */
export function encodedLength(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/**
 * Whether Claude accepts a PNG of this many bytes, and if not, the linear factor to
 * shrink its raster by — below 1, with a margin, because a PNG's size tracks its
 * pixel count only roughly.
 */
export function claudeAcceptsBytes(pngBytes: number): { readonly ok: true } | { readonly ok: false; readonly shrinkBy: number } {
  const encoded = encodedLength(pngBytes);
  if (encoded <= CLAUDE_MAX_IMAGE_ENCODED_BYTES) return { ok: true };
  return { ok: false, shrinkBy: Math.sqrt(CLAUDE_MAX_IMAGE_ENCODED_BYTES / encoded) * 0.95 };
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
  limits: ClaudeImageLimits,
): number | null {
  for (
    let hundredths = Math.round(ceiling * 100);
    hundredths >= Math.round(floor * 100);
    hundredths -= 1
  ) {
    const scale = hundredths / 100;
    if (fitsClaudeImage(Math.ceil(widthPoints * scale) + 1, Math.ceil(heightPoints * scale) + 1, limits)) {
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
  // A RULED LINE IS A BOUNDARY (the owner's page of 2026-10-08, where the handwritten header "Names | Hours" was read as the
  // one word "NamedHours"): words either side of a ruled line, or of a gap as wide as a column, are separate words.
  'Words on either side of a ruled line, or of a gap as wide as a table column, are separate words: never join them, ' +
  'and give each its own box. ' +
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

/** How much of the API's own explanation a refusal carries. */
const EXPLANATION_MAX = 300;

/**
 * The API's own sentence about why it refused, or `null` where the body has none.
 *
 * A status alone hides what a reader can act on: *"Your credit balance is too low"*
 * and a malformed request are both a 400 (measured 2026-09-18), and only the first is
 * theirs to fix. Read by `anthropicCredit.ts`, which the chat reads it with too; bounded
 * here, because the text is the peer's and this one travels in a refusal.
 */
async function explanationOf(response: Response): Promise<string | null> {
  return (await anthropicErrorMessage(response))?.slice(0, EXPLANATION_MAX) ?? null;
}

/**
 * A refusal for an HTTP status, by the error types the API documents.
 *
 * Out of credit is asked FIRST, of the one reader both Anthropic callers share: it is a
 * 400 like a malformed request, and only the message separates them.
 */
function refusalFor(status: number, explanation: string | null): ClaudeRecognitionRefused {
  const why = explanation === null ? '' : `: ${explanation}`;
  if (isAnthropicOutOfCredit(status, explanation)) {
    return new ClaudeRecognitionRefused('out-of-credit', `the Anthropic account is out of credit (${String(status)})${why}`);
  }
  if (status === 401 || status === 403) {
    return new ClaudeRecognitionRefused('unauthorised', `the Claude API refused the key (${String(status)})${why}`);
  }
  if (status === 413) {
    return new ClaudeRecognitionRefused('too-large', `the Claude API refused the request as too large (413)${why}`);
  }
  if (status === 429 || status === 500 || status === 504 || status === 529) {
    return new ClaudeRecognitionRefused(
      'unavailable',
      `the Claude API is not taking requests right now (${String(status)})${why}`,
    );
  }
  return new ClaudeRecognitionRefused('rejected', `the Claude API rejected the request (${String(status)})${why}`);
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
  const parsed = await askClaudeAboutImage(credentials, request, INSTRUCTION, OUTPUT_SCHEMA, 'the region');
  const answer = answerSchema.safeParse(parsed);
  if (!answer.success) {
    throw new ClaudeRecognitionRefused('unreadable-answer', 'Claude’s answer is not the shape it was asked for');
  }
  return pageFrom(answer.data, request);
}

/** What is asked for a table. English, for {@link INSTRUCTION}'s reason. */
const TABLE_INSTRUCTION =
  'Find every table in this image of a page. For each table give its number of rows and ' +
  'columns, and each cell once: its zero-based row and column where the cell starts, how many ' +
  'rows and columns it spans (1 when it does not span), and its exact text. A merged cell is one ' +
  'cell with spans, never repeated. If the page holds no table, return an empty list of tables.';

/**
 * A table's shape, as `output_config.format` constrains it — **Azure's Layout shape on purpose**
 * (ADR-0086 Decision 3), so one reader turns either service's answer into the export's table,
 * and a schema that cannot express a span cannot be answered with one.
 */
const TABLE_SCHEMA = {
  type: 'object',
  properties: {
    tables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rowCount: { type: 'integer' },
          columnCount: { type: 'integer' },
          cells: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                rowIndex: { type: 'integer' },
                columnIndex: { type: 'integer' },
                rowSpan: { type: 'integer' },
                columnSpan: { type: 'integer' },
                content: { type: 'string' },
              },
              required: ['rowIndex', 'columnIndex', 'rowSpan', 'columnSpan', 'content'],
              additionalProperties: false,
            },
          },
        },
        required: ['rowCount', 'columnCount', 'cells'],
        additionalProperties: false,
      },
    },
  },
  required: ['tables'],
  additionalProperties: false,
} as const;

/** The same shape, checked here: the schema constrains the answer's form, not its numbers. */
const tableAnswerSchema = z.object({
  tables: z.array(
    z.object({
      rowCount: z.number(),
      columnCount: z.number(),
      cells: z.array(
        z.object({
          rowIndex: z.number(),
          columnIndex: z.number(),
          rowSpan: z.number(),
          columnSpan: z.number(),
          content: z.string(),
        }),
      ),
    }),
  ),
});

/**
 * Sends one page's raster to Claude and answers the tables it found
 * ([ADR-0086](../../../docs/DECISIONS/0086-a-scanned-table-is-read-by-a-service-that-answers-tables.md)).
 *
 * Each table goes through {@link recognisedTable}, the one reader of a service's grid, so a
 * grid that does not fit itself refuses the answer rather than being placed by a rule of ours.
 *
 * @throws {@link ClaudeRecognitionRefused}, or `RecognisedTableRefused`.
 */
export async function readTablesThroughClaude(
  credentials: ClaudeCredentials,
  request: { readonly png: Uint8Array; readonly fetchImpl?: typeof fetch },
  bounds: { readonly maxCells: number; readonly maxText: number },
): Promise<readonly RecognisedTable[]> {
  const parsed = await askClaudeAboutImage(credentials, request, TABLE_INSTRUCTION, TABLE_SCHEMA, 'the page');
  const answer = tableAnswerSchema.safeParse(parsed);
  if (!answer.success) {
    throw new ClaudeRecognitionRefused('unreadable-answer', 'Claude’s tables are not the shape they were asked for');
  }
  // THE DECLARED COUNTS ARE NOT READ (ADR-0222): the grid is the extent of the cells, so a model that declared three columns
  // and returned four cells a row is written as four columns. Each table is its own answer.
  return placedTables(
    answer.data.tables.map((table) =>
      table.cells.map((cell) => ({
        row: cell.rowIndex,
        column: cell.columnIndex,
        rowSpan: cell.rowSpan,
        columnSpan: cell.columnSpan,
        text: cell.content,
      })),
    ),
    bounds.maxCells,
    bounds.maxText,
  );
}

/**
 * One question about one image, answered as JSON in a schema: the byte limit, the request, the
 * stop reasons and the parse. **The one sequence**, so the text recogniser and the table reader
 * cannot differ about what counts as an answer (B3a,
 * [ADR-0086](../../../docs/DECISIONS/0086-a-scanned-table-is-read-by-a-service-that-answers-tables.md)).
 *
 * @param subject what the image is, in a refusal's words — *the region*, *the page*
 * @returns the parsed JSON, which the caller checks against its own schema
 */
async function askClaudeAboutImage(
  credentials: ClaudeCredentials,
  request: { readonly png: Uint8Array; readonly fetchImpl?: typeof fetch },
  instruction: string,
  schema: object,
  subject: string,
): Promise<unknown> {
  // THE PIXEL LIMIT OF THIS MODEL, BEFORE ANYTHING IS SENT, for the text recogniser and the table reader alike: the
  // request below says `oversized_image: error` so no box shifts, and the model's own limit is what decides whether it
  // would be one. The caller sized the raster from the same table (`claudeImageLimits`); this refuses what it did not.
  const { width, height } = pngSize(request.png);
  if (!fitsClaudeImage(width, height, claudeImageLimits(credentials.model))) {
    throw new ClaudeRecognitionRefused(
      'too-large',
      `a ${String(width)}×${String(height)} raster is larger than ${credentials.model} reads without resizing, ` +
        'and the coordinates of a resized image would not be this raster’s',
    );
  }
  // THE BYTE LIMIT, BEFORE ANYTHING IS SENT: the API refuses an oversized image with a
  // bare 400, which reaches a reader as *rejected* and names neither number.
  if (!claudeAcceptsBytes(request.png.byteLength).ok) {
    throw new ClaudeRecognitionRefused(
      'too-large',
      `a ${String(request.png.byteLength)}-byte raster is ${String(encodedLength(request.png.byteLength))} ` +
        `bytes once encoded, over the ${String(CLAUDE_MAX_IMAGE_ENCODED_BYTES)} Claude accepts`,
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
        model: credentials.model,
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
              { type: 'text', text: instruction },
            ],
          },
        ],
        output_config: { format: { type: 'json_schema', schema } },
      }),
    });
  } catch (cause) {
    throw new ClaudeRecognitionRefused('unreachable', 'the Claude API could not be reached', {
      cause,
    });
  }
  if (!response.ok) throw refusalFor(response.status, await explanationOf(response));

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
    throw new ClaudeRecognitionRefused('refused', `Claude declined to read ${subject}`);
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
  return parsed;
}

/** The recogniser's answer, as a page in PDF space — every box checked against its raster. */
function pageFrom(data: z.infer<typeof answerSchema>, request: ClaudeRequest): RecognisedPage {
  const { width, height } = pngSize(request.png);
  const transform = pageTransform(
    { x0: request.crop[0], y0: request.crop[1], x1: request.crop[2], y1: request.crop[3] },
    request.rotation,
    request.scale,
  );
  const toPage = (x: number, y: number): PdfPoint =>
    toPdf(viewportPoint(x + request.origin[0], y + request.origin[1]), transform);

  const lines: RecognisedLine[] = [];
  for (const line of data.lines) {
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
    languages: ['eng' satisfies OcrLanguage],
  };
}
