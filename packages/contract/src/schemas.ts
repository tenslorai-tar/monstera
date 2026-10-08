import {
  EDIT_STEPS,
  type FailureDetails,
  INTERNAL_FAILURE,
  asDocId,
  asDocVersion,
  asFileHandle,
  type StructuredError,
} from '@monstera/shared';
import { z } from 'zod';

import { AI_PROVIDER_KEY_SETTING_IDS } from './aiProviders.js';

/**
 * Wire schemas for the branded identity types.
 *
 * Each parses an untrusted primitive and brands it, so a value that arrives
 * from another process is branded only after it has been checked. Branding
 * first and validating later would put an unchecked value into a type that
 * claims it was checked.
 */

/**
 * How long a `DocId` may be. Main mints one as 32 random bytes in base64url, 43 characters (`token.ts`); the bound is
 * there for the reason a host session id has one, that an unbounded id is a peer deciding how many bytes of a frame
 * it spends, and so that a command naming a second document has a size at all (item 5c: three command kinds measured
 * as unbounded for their `source` alone).
 */
export const DOC_ID_MAX_CHARS = 64;

export const docIdSchema = z.string().min(1).max(DOC_ID_MAX_CHARS).transform(asDocId);
export const docVersionSchema = z.number().int().nonnegative().transform(asDocVersion);

/**
 * How long a `FileHandle` may be: minted as a `DocId` is, 32 random bytes in base64url (`capabilityRegistry.ts`), so
 * the same bound and for the same reason (CR-SEC-06). Unbounded, a renderer chose how much `main` allocated per call.
 */
export const FILE_HANDLE_MAX_CHARS = DOC_ID_MAX_CHARS;
export const fileHandleSchema = z.string().min(1).max(FILE_HANDLE_MAX_CHARS).transform(asFileHandle);

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
 * How long a declared failure code may be: kebab-case words, the longest declared 26 characters on 2026-10-04
 * (`secret-storage-unavailable`, read from the built `channels`), so 64 leaves room and bounds a peer's choice.
 * `channels.test.ts` holds every declared code under it, so a longer one fails there rather than at a refused answer.
 */
export const FAILURE_CODE_MAX_CHARS = 64;

/** How long an incident id may be: `IncidentLog` mints `i` and a counter. */
export const INCIDENT_ID_MAX_CHARS = 32;

/**
 * How many characters a `text-not-writable` refusal names at most, and how long they may be in UTF-16 units: a
 * grapheme can be several code points, so the second bound is the one the wire checks. A refusal over more characters
 * than this names the first ones typed.
 */
export const UNWRITABLE_CHARACTERS_MAX = 32;
export const UNWRITABLE_CHARACTERS_MAX_UNITS = 128;

/** The largest number `FPDF_GetLastError` can answer: it returns a C `unsigned long`, and Windows' is 32 bits. */
export const ENGINE_ERROR_MAX = 0xffff_ffff;

/** How long the command kind a `command-looped` refusal names may be (ADR-0221). */
const COMMAND_KIND_MAX_CHARS = 64;

/**
 * The schema of each code's declared detail (ADR-0169 Decision 4) — the runtime half of `@monstera/shared`'s
 * `FailureDetails`, which the `satisfies` below holds it to, and {@link FailureDetailSchemasMatch} holds the other way.
 */
export const FAILURE_DETAIL_SCHEMAS = {
  'text-not-writable': z.object({ characters: z.string().max(UNWRITABLE_CHARACTERS_MAX_UNITS) }).strict(),
  'edit-refused': z
    .object({ step: z.enum(EDIT_STEPS), engineError: z.number().int().min(0).max(ENGINE_ERROR_MAX) })
    .strict(),
  // A command kind is a camelCase identifier; the bound is a frame's worth of caution, not a derived figure.
  'command-looped': z.object({ command: z.string().min(1).max(COMMAND_KIND_MAX_CHARS) }).strict(),
} as const satisfies { readonly [C in keyof FailureDetails]: z.ZodType<FailureDetails[C]> };

/** Compiles only when `Listed` is assignable to `Whole`: `engineChannels.ts`' `Covers`, for one check here. */
type Covers<Whole, Listed extends Whole> = Listed;

/**
 * The other direction of the `satisfies` above: it holds each schema's output to its declared type, and this holds the
 * type to the schema's output, so a field the type declares and the schema omits is a compile error rather than a
 * refusal at the first failure that carries it.
 */
export type FailureDetailSchemasCoverTheirTypes = Covers<
  { readonly [C in keyof FailureDetails]: z.infer<(typeof FAILURE_DETAIL_SCHEMAS)[C]> },
  FailureDetails
>;

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
 *
 * **Both strings are bounded** (CR-SEC-13): a host is hostile by invariant 25's premise, and an unbounded `code` was
 * text of its choosing, up to a whole frame, carried into `main`'s diagnostics.
 *
 * **A code with a declared detail is a third shape** (ADR-0169 Decision 4): its own member, the detail required and
 * `.strict()`, and excluded from the plain member by the same refinement that excludes `internal`, so a detailed code
 * cannot arrive without its detail and a plain one cannot arrive with one.
 */
export const failureSchema = z.union([
  z
    .object({
      code: z.literal(INTERNAL_FAILURE),
      incident: z.string().min(1).max(INCIDENT_ID_MAX_CHARS),
    })
    .strict(),
  ...detailedFailureSchemas(),
  z
    .object({
      code: z
        .string()
        .min(1)
        .max(FAILURE_CODE_MAX_CHARS)
        .refine((code) => code !== INTERNAL_FAILURE, {
          message: `"${INTERNAL_FAILURE}" must carry an incident id; a declared code must not.`,
        })
        .refine((code) => !Object.hasOwn(FAILURE_DETAIL_SCHEMAS, code), {
          message: 'this code carries a declared detail, and arrived without it.',
        }),
    })
    .strict(),
]);

/**
 * One `{ code, detail }` member per code in {@link FAILURE_DETAIL_SCHEMAS}, for {@link failureSchema}: derived from the
 * table, so a code given a detail there is a member here with nothing else to edit.
 */
function detailedFailureSchemas() {
  return Object.entries(FAILURE_DETAIL_SCHEMAS).map(([code, detail]) =>
    z.object({ code: z.literal(code), detail }).strict(),
  );
}

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
 * {@link OCR_LANGUAGES} as a schema, derived rather than respelt.
 *
 * Here rather than in `channels.ts` because every engine host validates it, and a host
 * that reaches `channels.ts` builds the renderer's whole channel map at load (see
 * `host.ts`).
 */
export const ocrLanguageSchema = z.enum(OCR_LANGUAGES);

/** How many languages one recognition may read in at once: each is a model loaded for the call. */
export const MAX_OCR_LANGUAGES = 3;

/**
 * The languages a recognition reads in — one or a few, each named once. ONE SCHEMA for the command, the host's
 * request, the dialog's answer and the setting, so none of them can accept a list another refuses.
 */
export const ocrLanguagesSchema = z
  .array(ocrLanguageSchema)
  .min(1)
  .max(MAX_OCR_LANGUAGES)
  .refine((languages) => new Set(languages).size === languages.length, { message: 'each language is named once' })
  .readonly();

/** What {@link ocrLanguagesSchema} accepts. */
export type OcrLanguages = z.infer<typeof ocrLanguagesSchema>;

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
 *   models this build provisions. It is the one LOCAL engine: the TrOCR
 *   handwriting engine that stood beside it was removed 2026-09-18
 *   ([ADR-0085](../../../docs/DECISIONS/0085-handwriting-is-read-by-a-service-and-the-local-engine-is-removed.md)),
 *   because its models' training data is licensed for non-commercial research
 *   only — so handwriting is read by the two network engines.
 * - `azure` is Azure Document Intelligence, **on a region only** and for a
 *   different reason: the region's raster leaves the machine, and sending a
 *   whole page would send more of a reader's document than they asked about. It
 *   executes in `main` rather than in the engine host, because invariant 25 gives
 *   that process no network (ADR-0052's 2026-09-12 addition).
 * - `claude` is Anthropic's Claude, reading the same region raster for the same
 *   reasons and in the same process — the second network engine, added
 *   2026-09-12 after Stage 6 closed ([ADR-0057](../../../docs/DECISIONS/0057-a-network-recogniser-is-keyed-by-engine-and-a-providers-key-is-the-providers.md)).
 *
 * `azure` and `claude` each name a **service the reader's document is sent to**,
 * and that is the fact a person is choosing rather than an implementation detail.
 */
export const OCR_ENGINES = ['tesseract', 'azure', 'claude'] as const;

/** One of {@link OCR_ENGINES}. */
export type OcrEngine = (typeof OCR_ENGINES)[number];

/** {@link OCR_ENGINES} as a schema, derived rather than respelt; beside it for `ocrLanguageSchema`'s reason. */
export const ocrEngineSchema = z.enum(OCR_ENGINES);

/**
 * The engines that execute in `main`, because their input must reach a network —
 * and the ONLY list of them ([ADR-0057](../../../docs/DECISIONS/0057-a-network-recogniser-is-keyed-by-engine-and-a-providers-key-is-the-providers.md)).
 *
 * *Runs in main* used to be three literals, one of them a ternary that sent any
 * engine it did not name to the local handwriting recogniser. Every question with an
 * engine in it now reads this set: the command's pre-read, the composition root's
 * record of recognisers, the request type, and the tools that send a region out.
 */
export const NETWORK_OCR_ENGINES = ['azure', 'claude'] as const satisfies readonly OcrEngine[];

/** One of {@link NETWORK_OCR_ENGINES}. */
export type NetworkOcrEngine = (typeof NETWORK_OCR_ENGINES)[number];

/** Whether an engine executes in `main`. The guard every engine question reads. */
export function isNetworkOcrEngine(engine: OcrEngine): engine is NetworkOcrEngine {
  return NETWORK_OCR_ENGINES.some((network) => network === engine);
}

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
 * The Anthropic API key — the PROVIDER's key, not a recogniser's
 * ([ADR-0057](../../../docs/DECISIONS/0057-a-network-recogniser-is-keyed-by-engine-and-a-providers-key-is-the-providers.md) Decision 5).
 *
 * D6's Claude recogniser is the first thing to need it and main reads it by name.
 * **Declared in `aiProviders.ts` since 2026-09-17** and re-exported here, where its
 * readers have always found it: Stage 9's registry holds the other nine key ids, and
 * two ids for one credential would be two stored copies of it (ADR-0081).
 */
export { ANTHROPIC_KEY_SETTING_ID } from './aiProviders.js';

/**
 * How many device pixels one PDF point becomes, in a region snapshot.
 *
 * Bounded on both sides for two different reasons. Below 1 the snapshot is
 * coarser than the page's own points, which is a picture of a picture and not
 * what anybody drags a region for; above 8 the pixel bound above is reached by
 * quite ordinary regions, and a refusal at that end reads as the feature being
 * broken rather than as a scale being silly. Eight is 576 dpi.
 *
 * **Here rather than in `pageSnapshot.ts`, since 2026-09-13.** The host enforces
 * them, and main now chooses a scale too: the Claude recogniser lowers its raster
 * to fit the service's image limits and must not go below the floor the host
 * refuses. `pageSnapshot.ts` imports these and re-exports them, so there is one
 * definition and neither side restates it.
 */
export const MIN_SNAPSHOT_SCALE = 1;
export const MAX_SNAPSHOT_SCALE = 8;

/**
 * The smallest scale the host draws a WHOLE PAGE at — far below the snapshot's floor, because a whole page is asked
 * for to be looked at, not read.
 *
 * A vision ask sends a picture of the page (ADR-0090), and a page larger than Claude's image limit at 72 dpi is one the
 * provider would scale down itself, so drawing it smaller is what it would see anyway. With the snapshot's floor here
 * every A0 drawing — 2,384 × 3,370 pt, over 2,576 px at scale 1 — was refused as *"too large to send as a picture"*
 * (JOURNAL, *No document-size refusals*, table A row 11). The largest page PDF allows, 14,400 pt an edge (PDF 32000-1
 * Annex C), fits at 0.17; this floor only stops main's search at a scale the engine still draws.
 *
 * The page-image EXPORT keeps 72 dpi as a person's floor, {@link MIN_PAGE_IMAGE_DPI}: that is the renderer's schema,
 * and this is the host's.
 */
export const MIN_PAGE_PICTURE_SCALE = 0.01;

/**
 * The raster formats a page can be exported as — D10's *Pages → PNG / JPEG / WebP*.
 *
 * MuPDF is the export rasteriser for all three (§3). Its pixmap encodes PNG and
 * JPEG; it has no WebP writer, measured 2026-09-14 on 1.28.0, so WebP's bytes are
 * libwebp's over the same pixels (§3's *Page image → WebP encoding*, ADR-0070).
 */
export const PAGE_IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const;
export type PageImageFormat = (typeof PAGE_IMAGE_FORMATS)[number];

/**
 * An exported page's resolution, in dots per inch.
 *
 * **The snapshot's scale bounds in the unit a person types**, derived rather than
 * restated: a PDF point is 1/72 inch, so the host's scale is `dpi / 72`. The
 * ceiling is the host's; the floor is the export's own, above the host's
 * {@link MIN_PAGE_PICTURE_SCALE}, because an exported image is one a person reads.
 */
export const MIN_PAGE_IMAGE_DPI = MIN_SNAPSHOT_SCALE * 72;
export const MAX_PAGE_IMAGE_DPI = MAX_SNAPSHOT_SCALE * 72;

/**
 * A lossy image's quality: 1 to 100.
 *
 * The scale MuPDF's `asJPEG` takes and libwebp's `quality` option takes, so one
 * pair bounds both. A PNG is lossless, so the field is carried for every format
 * and ignored by one, rather than being a second request shape per format.
 */
export const MIN_IMAGE_QUALITY = 1;
export const MAX_IMAGE_QUALITY = 100;

/**
 * Every setting id whose value is a SECRET, and the only list of them.
 *
 * ## Why the contract has to know, when a setting id is otherwise the registry's
 *
 * `settings.save` carried `record(string, unknown)` and main wrote whatever
 * arrived into `settings.json`. The renderer's store includes secrets in
 * `all()`, and `persistSettings` sent `all()` — so a key set in that store
 * reached the plaintext document, measured 2026-09-12 by a case that failed
 * with the key present in what the channel carried. It had not happened only
 * because nothing had set one. That is a rule held by nobody doing a thing,
 * which is not a rule.
 *
 * With the ids here, `settings.save` REFUSES a record carrying one and
 * `settings.saveSecret` accepts nothing else, so the separation is a property of
 * the wire rather than of every caller's memory (B5). The registry's
 * `secret: true` flags must equal this list, and `settings/all.test.ts` asserts
 * that in both directions — a second list that agreed today is B3a's shape.
 */
/**
 * DocuSign's integration key — the client id a person registers in DocuSign's Apps
 * and Keys — as `BUILD-PROMPT.md` Part F files it: *Integrations (all secret)*.
 *
 * A public client's id is not a secret in OAuth's sense (RFC 8252 §8.4), and it is
 * kept in the secret store all the same, because the founding record says so and
 * nothing is lost by it.
 */
export const DOCUSIGN_INTEGRATION_KEY_SETTING_ID = 'integrations.docusign-integration-key';

/** Which DocuSign environment a sign-in reaches — production, or the developer demo. */
export const DOCUSIGN_ENVIRONMENT_SETTING_ID = 'integrations.docusign-environment';

/** The environments, as the setting stores them. */
export const DOCUSIGN_ENVIRONMENTS = ['production', 'demo'] as const;

/** One of {@link DOCUSIGN_ENVIRONMENTS}. */
export type DocusignEnvironment = (typeof DOCUSIGN_ENVIRONMENTS)[number];

/**
 * How long an envelope's email subject may be — DocuSign's eSignature OpenAPI v2.1,
 * `envelopeDefinition.emailSubject`: *"The subject line is limited to 100
 * characters, including any merged fields."* Read 2026-09-13.
 */
export const MAX_DOCUSIGN_SUBJECT = 100;

/**
 * How long a signer's name and email may each be — the same specification,
 * `signer.email` and `signer.name`: *"Maximum length: 100 characters."*
 */
export const MAX_DOCUSIGN_RECIPIENT_FIELD = 100;

/**
 * How many signers one envelope names.
 *
 * **A bound, not a measurement and not DocuSign's limit**: every array that crosses
 * from the renderer is bounded, and this one is set well past what a person types
 * into a dialog. DocuSign's own limit, if lower, refuses by its own answer.
 */
export const MAX_DOCUSIGN_SIGNERS = 20;

/**
 * Every way sending to DocuSign, or retrieving from it, ends without its result —
 * THE ONE LIST, for `SIGN_REFUSALS`' reason: the channels build their refusal member
 * from it and the renderer's problem dialog takes its reasons from it.
 */
export const DOCUSIGN_REFUSALS = [
  /** No integration key is stored. */
  'no-integration-key',
  /** This computer has no secure place to keep a token, so no sign-in is kept. */
  'secrets-unavailable',
  /** The person cancelled the sign-in, or closed the browser without finishing. */
  'sign-in-cancelled',
  /** The sign-in's redirect did not arrive in time. */
  'sign-in-timed-out',
  /** The person declined, or DocuSign refused the sign-in. */
  'sign-in-denied',
  /** The sign-in could not start: no browser would open, or no local port could be. */
  'sign-in-unavailable',
  /** DocuSign refused the stored sign-in, and a new one is needed. */
  'unauthorised',
  /** DocuSign answered with an error. */
  'rejected',
  /** DocuSign could not be reached. */
  'unreachable',
  /** DocuSign answered something this build does not read. */
  'unexpected-answer',
  /** The account has no default account to act in, or names a host outside DocuSign's. */
  'no-account',
] as const;

/** One of {@link DOCUSIGN_REFUSALS}. */
export type DocusignRefusalKind = (typeof DOCUSIGN_REFUSALS)[number];

/**
 * Why a source picked for import was refused rather than composed into a PDF
 * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * **One list for every composer.** It was Markdown's alone until CSV needed the same
 * three reasons: a second list would make the wire a union of two enums that agree
 * on every member they share.
 *
 * **Declared here and not in the kernel**, because two wires carry it: the compose
 * host's channel and the renderer's. The contract is the one package both sides
 * import, so a reason added in one place is a compile error in every place that
 * says what it means.
 */
export const COMPOSE_REFUSALS = [
  /** The file's bytes are not UTF-8 text. */
  'not-utf8',
  /** A character the standard fonts cannot draw; the refusal names its line. */
  'unencodable-text',
  /** The source holds no text, so a composed document would be blank. */
  'nothing-to-draw',
  /**
   * A CSV record breaks RFC 4180: a quoted field never closed, text after a closing
   * quote, or a quote inside an unquoted field. The refusal names its line.
   */
  'malformed-csv',
  /**
   * A picked image the decoder refused, or a PNG whose header states no size. The
   * refusal names which image, by its position among the files picked.
   */
  'image-unreadable',
  /**
   * A PNG larger than one image may be, or PNGs that together pass the import's pixel
   * bound — decoding cost follows pixels, not bytes. The refusal names the image where
   * the bound was crossed.
   */
  'too-many-pixels',
] as const;

/**
 * Whether an open document's own file could be written over now (cloud-4 7b) — the kernel's probe answers exactly these.
 */
export const FILE_ACCESS = [
  /** This account may write it, and nothing holds it against writers. */
  'writable',
  /** This account may not write it: its read-only attribute, its permissions, or a read-only volume. */
  'read-only',
  /** Another program has it open and lets nobody else write it. */
  'held',
  /** Nothing is at its path any more. */
  'absent',
] as const;

/**
 * Why a save of a document to its own file could not be written (cloud-4 7b), each with its own remedy — the kernel's
 * one resolver (`saveWriteCause`) answers exactly these.
 */
export const SAVE_WRITE_CAUSES = [
  /** The file is read-only to this account. */
  'read-only',
  /** Another program holds the file. */
  'held',
  /** The file's folder cannot be written by this account, so the new contents had nowhere to go first. */
  'folder-read-only',
  /** The disk is full. */
  'disk-full',
  /** None of these could be told. */
  'unknown',
] as const;

/**
 * Why a document was not fetched from a URL a person gave
 * ([ADR-0061](../../../docs/DECISIONS/0061-a-url-a-person-chose-is-fetched-through-one-guard-that-pins-every-resolution.md)).
 *
 * THE KERNEL'S GUARD REFUSES WITH EXACTLY THESE, and takes its type from this list, so a
 * reason the guard gains is a reason the channel can carry and the renderer must say.
 */
export const URL_FETCH_REFUSALS = [
  /** Not a URL, or a scheme other than `https:` — on the first request or a redirect. */
  'not-https',
  /** The URL carries a user name or password. */
  'credentials',
  /** The host is, or resolved to, an address that is not public. */
  'blocked-address',
  /** The host resolved to no address. */
  'unresolvable',
  /** More redirects than one fetch follows. */
  'too-many-redirects',
  /** The server answered with a status that is not a document. */
  'http-error',
  /** No answer: refused, reset, or silent past the idle limit. */
  'unreachable',
  /** The document passed the ceiling on bytes that arrived. */
  'too-large',
  /** The answer does not begin with `%PDF-`. */
  'not-a-pdf',
] as const;

export type UrlFetchRefusal = (typeof URL_FETCH_REFUSALS)[number];

/** One of {@link FILE_ACCESS}. */
export type FileAccess = (typeof FILE_ACCESS)[number];

/** One of {@link SAVE_WRITE_CAUSES}. */
export type SaveWriteCause = (typeof SAVE_WRITE_CAUSES)[number];

/** One of {@link COMPOSE_REFUSALS}. */
export type ComposeRefusal = (typeof COMPOSE_REFUSALS)[number];

/**
 * Optimize's three settings, by the name a person picks, and what each asks MuPDF's image
 * rewriter for ([ADR-0087](../../../docs/DECISIONS/0087-optimize-is-mupdfs-native-image-rewriter-in-the-compose-host.md)
 * Decision 3): the JPEG quality for images stored lossy, and the dpi above which a colour or grey
 * image is subsampled, and to what.
 *
 * Measured 2026-09-19 over the eleven-document corpus (`scripts/research/imageRewrite.mjs`):
 * −10.6%, −11.6% and −25.6% in total, every page count held, 4 of 4 tagged documents keeping
 * their structure tree. One table, read by the renderer for the names, by `main` for the numbers
 * it sends, and by the host's channel for the bounds.
 */
export const OPTIMIZE_SETTINGS = {
  high: { quality: 85, over: 300, to: 200 },
  medium: { quality: 70, over: 225, to: 150 },
  low: { quality: 50, over: 150, to: 100 },
} as const;

/** The setting names, in the order the dialog offers them, *high* first. */
export const OPTIMIZE_SETTING_NAMES = ['high', 'medium', 'low'] as const satisfies readonly (keyof typeof OPTIMIZE_SETTINGS)[];

/** One of {@link OPTIMIZE_SETTING_NAMES}. */
export type OptimizeSetting = (typeof OPTIMIZE_SETTING_NAMES)[number];

/**
 * The secrets a person may store and the renderer may learn are STORED — never a
 * value.
 *
 * **A DocuSign token is not here, deliberately.** This list is what the renderer
 * may write through `settings.saveSecret` and learn about through
 * `settings.loadSecrets`. Tokens are obtained by `main` from a sign-in and must
 * never be writable from the renderer, so `main` keeps them in the secret store
 * under an id outside this list ([ADR-0059](../../../docs/DECISIONS/0059-a-sign-in-redirect-returns-on-loopback-for-one-request.md)
 * Decision 4).
 */
export const SECRET_SETTING_IDS = [
  AZURE_KEY_SETTING_ID,
  // EVERY AI PROVIDER'S KEY, from the registry's own list (ADR-0081): a provider added
  // there without an entry here would be one whose key the Settings dialog cannot save.
  ...AI_PROVIDER_KEY_SETTING_IDS,
  DOCUSIGN_INTEGRATION_KEY_SETTING_ID,
] as const;

/** One of {@link SECRET_SETTING_IDS}. */
export type SecretSettingId = (typeof SECRET_SETTING_IDS)[number];

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

/** How many failures of one accessibility rule show their place on the page (ADR-0183). A bound, not a measurement. */
export const MAX_ACCESSIBILITY_SPOTS = 32;

/**
 * Where an accessibility failure is: a zero-based page, and a box on it in the page's display space at scale 1 — the
 * space the text layer and the links are reported in — or `null` where the object model places it on the page only
 * (ADR-0183).
 *
 * In this leaf for {@link DOCUMENT_ACCESS_VALUES}' reason: the engine host's wire and the renderer's channel take ONE
 * schema, so the two cannot differ about a box — and the host may load this module, which it may not do the channel
 * map (`host.ts`).
 */
export const accessibilitySpotsSchema = z
  .array(
    z.object({
      page: z.number().int().nonnegative(),
      box: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).nullable(),
    }),
  )
  .max(MAX_ACCESSIBILITY_SPOTS)
  .readonly();
