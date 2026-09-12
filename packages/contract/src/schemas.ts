import {
  INTERNAL_FAILURE,
  asDocId,
  asDocVersion,
  asFileHandle,
  type StructuredError,
} from '@monstera/shared';
import { z } from 'zod';

/**
 * Wire schemas for the branded identity types.
 *
 * Each parses an untrusted primitive and brands it, so a value that arrives
 * from another process is branded only after it has been checked. Branding
 * first and validating later would put an unchecked value into a type that
 * claims it was checked.
 */
export const docIdSchema = z.string().min(1).transform(asDocId);
export const docVersionSchema = z.number().int().nonnegative().transform(asDocVersion);
export const fileHandleSchema = z.string().min(1).transform(asFileHandle);

/**
 * How an error crosses a process or worker boundary (C5).
 *
 * Structured, never a bare string. An `Error` does not survive
 * `structuredClone` or JSON with its identity intact — it arrives as `{}` or as
 * a message with no name, no stack and, worst of all, no `cause`, which is
 * usually where the actual failure is. Recursive so the cause chain survives
 * the trip.
 */
export const structuredErrorSchema: z.ZodType<StructuredError> = z.lazy(() =>
  z.object({
    name: z.string(),
    message: z.string(),
    stack: z.string().optional(),
    cause: structuredErrorSchema.optional(),
  }),
);

/**
 * The envelope every channel result travels in.
 *
 * A rejection is data, not an exception, for exactly as long as it is in
 * transit. The preload bridge turns it back into a thrown `Error` so renderer
 * callers stay idiomatic, but on the wire it is a value the schema can check.
 *
 * @param value schema for the success payload
 */
export function envelopeSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: failureSchema }),
  ]);
}

/**
 * What a failure looks like on the wire (ADR-0009 §9, and its 2026-08-19
 * decision).
 *
 * **Two shapes, both `.strict()`, and neither one is optional-field shaped.** A
 * declared code travels alone; `internal` travels with the id of the log entry
 * its diagnostic was withheld into. `.strict()` is the load-bearing part on both:
 * a `message`, a `stack` or a `cause` arriving on a failure is rejected here
 * rather than passed through, and this schema is what the renderer validates
 * against — the last place a diagnostic could cross from a main build that
 * drifted, and a silent place, since extra fields are exactly what a permissive
 * parse ignores.
 *
 * **The `internal`-without-an-id state is closed by the refinement, not left to
 * member order.** A union tries its members in turn, so `{ code: 'internal' }`
 * with no id would fall through the first member and parse cleanly as the second
 * — an unreportable failure arriving as a well-formed one. Excluding the code
 * there is what makes the two shapes disjoint rather than merely ordered.
 *
 * `structuredErrorSchema` above is unchanged and still describes the diagnostic
 * that stays main-side. Two schemas for two objects: one crosses and one does
 * not.
 */
export const failureSchema = z.union([
  z
    .object({
      code: z.literal(INTERNAL_FAILURE),
      incident: z.string().min(1),
    })
    .strict(),
  z
    .object({
      code: z
        .string()
        .min(1)
        .refine((code) => code !== INTERNAL_FAILURE, {
          message: `"${INTERNAL_FAILURE}" must carry an incident id; a declared code must not.`,
        }),
    })
    .strict(),
]);

/**
 * The languages this build can RECOGNISE — Stage 6's set, and a decision.
 *
 * `BUILD-PROMPT.md`:473 asks for *13+ languages* and names none. Fourteen ship:
 * seven Latin-script, plus Cyrillic, Arabic, Hebrew, Devanagari, Japanese,
 * Korean and Simplified Chinese — because a set that is Latin-only fails the
 * documents it fails **silently**, and two of the seven are right-to-left.
 *
 * ## It is HERE rather than in `channels.ts`, where it was written
 *
 * Moved 2026-09-11, when `ocrPage`'s payload needed it: `channels.ts` imports
 * `commands.ts`, so a command schema cannot import back without a cycle, and a
 * second enum beside this one is a second opinion about which fourteen models
 * this build has (B3a). This file is the leaf both of them already import.
 *
 * ## Tesseract's own names, not BCP 47
 *
 * `chi_sim` is not a language tag; it is the file `tessdata` publishes. A tag
 * here would need a mapping table somewhere, and a mapping table is a second
 * opinion about which model a language means (B3a) — so the names are the
 * models' own and the display titles are keyed on them.
 *
 * ## Choosing one is NOT what ADR-0014's constraint 1 forbids
 *
 * That constraint says the language and datadir reaching the engine *must not be
 * influenced by a document, and must not be user-supplied without a new
 * decision* — because both of Tesseract's live advisories are reached through a
 * **crafted model file**. A person picking one of fourteen names from this
 * closed set supplies no file and no path: the models are provisioned by digest
 * (`scripts/provision/tessdata.mjs`) and the datadir is ours. This sentence is
 * that new decision, and the shape of it is what keeps the constraint true —
 * an enum rather than a string.
 */
export const OCR_LANGUAGES = [
  'eng',
  'spa',
  'fra',
  'deu',
  'por',
  'ita',
  'nld',
  'rus',
  'ara',
  'heb',
  'hin',
  'jpn',
  'kor',
  'chi_sim',
] as const;

/** One of {@link OCR_LANGUAGES}. */
export type OcrLanguage = (typeof OCR_LANGUAGES)[number];

/**
 * Which recogniser answers — **the request names it, and nothing else chooses**.
 *
 * [ADR-0052](../../../docs/DECISIONS/0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md)
 * Decision 1. §3's matrix assigns *a raster becomes characters and their boxes*
 * to one concern, and a second engine answering the same question is B3 unless
 * the selection lives in one explicit place. The alternative — a second command,
 * a second channel and a second surface — would put *which recogniser* in as
 * many places as there are callers, and both engines answer the same shape
 * precisely so they need not have one each.
 *
 * - `tesseract` reads a page or a region, in one of {@link OCR_LANGUAGES}, from
 *   models this build provisions.
 * - `handwriting` is TrOCR, **offered on a region only** — it reads one text
 *   line, which is the model rather than the wiring, and a page of thirty lines
 *   is thirty encoder runs. Its stack downloads on demand and is never bundled.
 * - `azure` is Azure Document Intelligence, **on a region only** and for a
 *   different reason: the region's raster leaves the machine, and sending a
 *   whole page would send more of a reader's document than they asked about. It
 *   is the one engine that executes in `main` rather than in the engine host,
 *   because invariant 25 gives that process no network (ADR-0052's 2026-09-12
 *   addition).
 *
 * Named for what a reader is choosing rather than for the library behind it: a
 * person picks *handwriting*, and `trocr` would put a model's name in a surface
 * and in every payload that carries the choice. `azure` is the exception and is
 * deliberate — it names a **service the reader's document is sent to**, and that
 * is the fact they are choosing rather than an implementation detail.
 */
export const OCR_ENGINES = ['tesseract', 'handwriting', 'azure'] as const;

/** One of {@link OCR_ENGINES}. */
export type OcrEngine = (typeof OCR_ENGINES)[number];

/**
 * Which TrOCR the handwriting engine loads — `BUILD-PROMPT.md`:619's setting.
 *
 * Measured 2026-09-11 against the repositories themselves, quantised, the two
 * files a run needs plus the tokenizer:
 *
 * | size | bytes | tokenizer |
 * |---|---|---|
 * | `small` | 67,737,573 | `Unigram` + `Metaspace` |
 * | `base` | 339,045,465 | `BPE` + `ByteLevel` |
 *
 * **The tokenizer family differs between them**, which is not a detail: a
 * detokeniser written for one and handed the other's ids produces an empty
 * string, and an empty string is this feature's own reassuring answer — *the
 * image has no text*. So the family travels in the manifest beside the digests
 * rather than being inferred at the point of decoding.
 */
export const TROCR_SIZES = ['small', 'base'] as const;

/** One of {@link TROCR_SIZES}. */
export type TrocrSize = (typeof TROCR_SIZES)[number];

/**
 * The two setting ids the cloud recogniser's credentials are stored under.
 *
 * ## Why these two ids are HERE and every other setting's is not
 *
 * A setting id is normally the registry's business alone: the renderer declares
 * it, main stores whatever it is handed, and nothing in main knows what any of
 * them mean. These two are the exception, because **main is the reader** — it
 * makes the HTTPS call, so it has to look them up by name, and the registry
 * lives in `packages/ui`, which `apps/desktop` may not import.
 *
 * Spelt once, in the leaf both sides already take, rather than as a string in
 * the settings definition and a matching string in the composition root. A pair
 * of literals that agree today is the shape B3a is about: the day one is
 * renamed, the cloud engine stops finding a key and reports that the service
 * refused it.
 */
export const AZURE_ENDPOINT_SETTING_ID = 'editing.azure-di-endpoint';
export const AZURE_KEY_SETTING_ID = 'editing.azure-di-key';

/**
 * How long a document password may be, on any wire in this build
 * ([ADR-0055](../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)).
 *
 * **Here rather than beside either wire, because there are two** — renderer →
 * main on `document.unlock`, and main → host on `engine/open` — and a bound
 * spelt twice is the pair that disagrees the day one is raised, with the
 * failure landing as a frame error in the middle of somebody typing (B3a).
 *
 * Wider than PDF's own limits (32 **bytes** to revision 4, 127 at revision 6)
 * deliberately: a password longer than the engine accepts is a **wrong
 * password**, and refusing it at the schema would report a malformed message
 * where a person wants to be told they mistyped.
 */
export const DOCUMENT_PASSWORD_MAX_CHARS = 512;

/**
 * What a document password bought, exactly as MuPDF's `authenticatePassword`
 * answers it.
 *
 * Measured 2026-09-12 (JOURNAL that date): `1` a document with no `/Encrypt`
 * dictionary, `2` the user password, `4` the owner password, `6` one password
 * that is both. `0` — refused — is not here, because a refusal produces no
 * session and therefore never reaches a caller as an access.
 *
 * In this leaf rather than in the kernel, so the channel schema and the engine
 * seam are one declaration: the permission rows read this and a second spelling
 * would be a second opinion about a bitfield the engine already defines (B3a).
 */
export const DOCUMENT_ACCESS_VALUES = [1, 2, 4, 6] as const;

/** One of {@link DOCUMENT_ACCESS_VALUES}. */
export type DocumentAccess = (typeof DOCUMENT_ACCESS_VALUES)[number];
