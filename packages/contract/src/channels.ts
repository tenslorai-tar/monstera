import { MATCH_TEXT_WINDOW } from '@monstera/shared';
import { z } from 'zod';

import { AI_PROVIDER_IDS } from './aiProviders.js';
import {
  MAX_ASK_ATTACHMENTS,
  MAX_ASK_CONTEXT,
  MAX_ASK_DOCUMENTS,
  askAboutSchema,
  askAmongSchema,
  askFileSchema,
  askSentSchema,
  namesEachOnce,
  pairsWith,
} from './askAbout.js';
import {
  CLOUD_PROVIDER_IDS,
  CLOUD_REFUSALS,
  MAX_CLOUD_FILE_ID,
  MAX_CLOUD_FILES,
  cloudFileSchema,
  cloudPickerProviderSchema,
  cloudProviderSchema,
  cloudStateSchema,
} from './cloudProviders.js';
import type { PreloadChannelId } from './bridge.js';
import { SHOWN_SCHEME_MAX } from './followedLinks.js';
import { pageSetSchema } from './pageSet.js';
import { channel, type Channel, type ClientApi, type Handlers, type ParamsOf, type ResultOf } from './channel.js';
import { AI_ANSWER_REFUSALS, MAX_WEB_SOURCES, answerIdSchema, subscriptionIdSchema } from './events.js';
import { TRANSLATION_LANGUAGE_IDS } from './translationLanguages.js';
import { WORD_MODES } from './wordModes.js';
import {
  MAX_ANNOTATION_BORDER,
  MAX_REMOVED_ANNOTATIONS,
  MAX_ANNOTATION_TEXT,
  MAX_IMAGE_BYTES,
  MAX_IMPORT_IMAGES,
  MAX_IMPORT_IMAGE_BYTES,
  MAX_WORKBOOK_ROW,
  MAX_WORKBOOK_SHEET_NAME,
  MAX_LINK_URI,
  MAX_LAYER_NAME_LENGTH,
  MAX_EDIT_RUNS,
  MAX_OBJECT_INDEX,
  blockEditAgrees,
  blockEditSchema,
  annotationKindNameSchema,
  annotationRectSchema,
  annotationAuthorSchema,
  annotationBlendSchema,
  annotationWordsStyleSchema,
  annotationStampSchema,
  annotationInstantSchema,
  formDataFormatSchema,
  formDataImportFormatSchema,
  annotationDataFormatSchema,
  formFieldKindSchema,
  renderableCommandSchema,
} from './commands.js';
import {
  MAX_LIBRARY_ENTRIES,
  MAX_LIBRARY_PICTURE_BYTES,
  MAX_BLOCK_FONTS,
  MAX_FONT_RUNS,
  MAX_RUN_FONT_BYTES,
  keepableSignatureSchema,
  libraryEntrySchema,
  libraryIdSchema,
  libraryKindSchema,
  MAX_SIGNATURE_FIELD,
  requestedSignatureMarkSchema,
  SIGN_REFUSALS,
  signaturePlacementSchema,
  TIMESTAMP_AUTHORITY_IDS,
} from './commands.js';
import {
  DOCUMENT_ACCESS_VALUES,
  DOCUMENT_PASSWORD_MAX_CHARS,
  DOCUSIGN_REFUSALS,
  MAX_DOCUSIGN_RECIPIENT_FIELD,
  MAX_DOCUSIGN_SIGNERS,
  MAX_DOCUSIGN_SUBJECT,
  OCR_LANGUAGES,
  ocrLanguageSchema,
  SECRET_SETTING_IDS,
  docIdSchema,
  docVersionSchema,
  fileHandleSchema,
  COMPOSE_REFUSALS,
  MAX_BOXED_CHARACTERS,
  boxedCharacterSchema,
  OPTIMIZE_SETTING_NAMES,
  URL_FETCH_REFUSALS,
  FILE_ACCESS,
  SAVE_WRITE_CAUSES,
  PAGE_IMAGE_FORMATS,
  MIN_PAGE_IMAGE_DPI,
  MAX_PAGE_IMAGE_DPI,
  MIN_IMAGE_QUALITY,
  MAX_IMAGE_QUALITY,
  FAILURE_DETAIL_SCHEMAS,
  drawnBoxesShape,
} from './schemas.js';

/**
 * Every IPC channel, defined once.
 *
 * A channel is added here only when a real handler for it exists. The wired
 * rule (Part H) applies as much to the contract as to the UI: a declared
 * channel with nothing behind it is a call that hangs, which is worse than a
 * call that is absent. The `Handlers` mapped type enforces this mechanically —
 * adding an entry here breaks the build until something implements it.
 *
 * **Invariant L11 applies to every entry below, and the gate it was owed is
 * {@link MAX_RANGE_BYTES}.** No channel's payload may scale with document size
 * *per operation*. That gate was deliberately not written at Stage 0: with one
 * channel carrying a version string it would have inspected nothing, passed, and
 * stayed green while the channels that make L11 bite were added. It was owed by
 * the first document-carrying channel, `document.readRange` is it, and the
 * answer is a bound in that channel's own params schema rather than a scan over
 * this file — see the note there for why the schema is the stronger of the two.
 *
 * The sentence this replaced said the single sanctioned byte crossing is a
 * snapshot once per version. There is no snapshot; §2 was amended on 2026-08-29
 * ([ADR-0031](../../../docs/DECISIONS/0031-the-renderer-reads-the-document-by-demand-paged-ranges.md)).
 */

/**
 * The largest byte range one read may carry.
 *
 * **This is invariant L11's mechanism, so its size is an argument and not a
 * preference.** Any constant satisfies L11 — a fixed bound cannot scale with
 * document size, which is the whole of what the invariant asks. So the only real
 * constraint is the lower one: it must sit above the largest range a working
 * renderer actually asks for, or the bound stops being a guard and becomes a
 * bug.
 *
 * Measured 2026-08-29 with `pdfjs-dist@6.2.108` against
 * `packages/testing/fixtures/generated/perf-image-200mb.pdf` (209,105,721 bytes):
 * the largest single range requested while opening the document and producing
 * page 1 was **5,111,808 bytes** — the page's image XObject, asked for whole.
 * The object-dense fixture's largest was 327,680. 16 MiB leaves 3.28× headroom
 * over the measured maximum and is about 1% of `main`'s 1.5 GB budget, so a
 * request at the bound is nowhere near a figure the budget notices.
 *
 * ## An object larger than this is read in pieces, never refused
 *
 * PDF.js asks for an object whole and must be answered in ONE call — measured,
 * its reader completes and is deleted after the first chunk. So a scan stored as
 * one image past this bound used to be a page that never drew. The renderer's
 * transport now reads such a range in pieces of at most this size and answers
 * PDF.js once with the joined bytes (`documentTransport.ts`, 2026-10-02;
 * `largeObject.pw.ts` draws an 18,750,000-byte image). This bound is what one
 * read carries, which is L11's *per operation*; the joined copy is bounded by the
 * object PDF.js asked for.
 */
export const MAX_RANGE_BYTES = 16 * 1024 * 1024;

/**
 * How many pages one view-model read may name.
 *
 * L11's mechanism for the geometry channel, and the same argument
 * {@link MAX_RANGE_BYTES} makes: any constant satisfies the invariant, so the
 * only real constraint is the lower one — it must sit above what a working
 * renderer actually asks for, or the bound stops being a guard and becomes a
 * bug. This build draws one page; a thumbnail strip is the surface that will
 * ask for many, and 512 is far above any window a screen can hold.
 *
 * **The trigger:** the first surface that legitimately needs more than this in
 * one read is the evidence the bound is wrong, and the fix is a measurement of
 * what that surface draws — not a larger round number.
 */
export const MAX_VIEW_MODEL_PAGES = 512;

/**
 * How many matches one page's search may answer with.
 *
 * L11's mechanism for the search channel, and it needs the bound more plainly
 * than its two siblings do: a common word in a dense page produces a result
 * list that scales with the *content*, and across a document-wide search that
 * is document-scaled by another name.
 *
 * **The caller states its own limit and this is the ceiling on it**, so
 * *exhausted* and *truncated* stay distinguishable — a bound applied silently
 * would make "no more matches" and "the cap was reached" the same observation
 * for every caller. `truncated` in the result is what separates them.
 *
 * 512 for the same reason `MAX_VIEW_MODEL_PAGES` is: any constant satisfies the
 * invariant, so the only real constraint is the lower one, and no results
 * surface shows more than a screenful before the user narrows the query.
 *
 * **The trigger:** the first surface that legitimately needs more than this from
 * one page is the evidence the bound is wrong, and the fix is a measurement of
 * what that surface shows — not a larger round number.
 */
export const MAX_SEARCH_MATCHES = 512;

/**
 * How many lines of one page's text may cross as a selectable layer.
 *
 * ## The reasoning above does NOT transfer, which is why this is its own number
 *
 * `MAX_SEARCH_MATCHES` rests on *no results surface shows more than a screenful
 * before the user narrows the query*. A text layer has no such escape: it must
 * cover the **whole** page or the part past the bound cannot be selected, and
 * there is no query to narrow. So this bound is set from what a page actually
 * holds rather than from what a surface shows.
 *
 * Measured 2026-09-08 with the shipped substrate (`textStructure.ts` over MuPDF
 * 1.28.0 with `segment`), on A4 pages built to be denser than anything real:
 *
 * | page | lines | longest line |
 * |---|---|---|
 * | 6pt prose, 7pt leading, full page | 118 | 83 chars |
 * | a 12 × 70 table at 6pt | **840** | 6 chars |
 * | 2,000 separate one-glyph runs | 2,000 | 1 char |
 *
 * **A table cell is its own line**, which is what makes the second row the
 * interesting one: a spreadsheet page produces hundreds of lines where its prose
 * equivalent produces about a hundred, and `MAX_SEARCH_MATCHES` would have cut
 * it. 2,048 clears the densest page measured and the pathological one beside it.
 *
 * **Three synthetic pages are a shape, not a distribution.** The corpus reading
 * is owed — this is enough to catch a gross failure and not enough to tune a
 * constant against.
 *
 * **The trigger:** the first page that reports `truncated` for a reason other
 * than a hostile document is the evidence this is wrong, and the fix is a
 * measurement of that page rather than a larger round number.
 */
export const MAX_TEXT_LAYER_LINES = 2048;

/**
 * How many characters of one line may cross.
 *
 * A line's length is chosen by whoever made the document, so it is the second
 * unbounded axis and needs its own ceiling — {@link MAX_SEARCH_MATCHES}'s note
 * about a count being the only axis does not hold here, because this text is not
 * clipped to a window around anything.
 *
 * Measured in the same run: the densest prose page's longest line was **83**
 * characters, and a page built deliberately to carry one enormous run reported a
 * single line of **531**. 1,024 is about double the worst reading.
 *
 * Together with {@link MAX_TEXT_LAYER_LINES} this bounds one page's layer at
 * 2 MiB of text, which is a ceiling on a **page** rather than a figure that
 * grows with the document — invariant 11's actual requirement. The pages
 * measured above cross about 10 KB.
 */
export const MAX_TEXT_LAYER_LINE = 1024;

/** How many words one `document.pageWordBoxes` answer boxes (ADR-0137); the host's own bound is held equal to it. */
export const MAX_PAGE_WORD_BOXES = 16_384;

/**
 * The most structure elements `document.pageStructure` carries for one page.
 *
 * Measured 2026-09-14 over the corpus's tagged documents, first five pages each: the
 * densest page carries **129** elements (a page of two tables). This is about thirty
 * times that, so a real page is not cut, and a crafted one costs a bounded frame.
 */
export const MAX_STRUCTURE_NODES = 4096;

/**
 * The most characters of one element's role or raw name.
 *
 * A standard role is a short word; a raw name is the document's own string, so it
 * is the document's author who decides its length and this bound that caps it.
 */
export const MAX_STRUCTURE_NAME = 128;

/**
 * The most table cells `document.pageTables` carries for one page, and the most
 * edits one Excel export carries.
 *
 * Measured 2026-09-17 over the corpus under the table read: 13 tables, the densest
 * page **173** cells. About twenty-four times that.
 */
export const MAX_TABLE_CELLS = 4096;

/**
 * Who reads a document's tables for an Excel export (ADR-0086): MuPDF's table read of the page's
 * text, or a service reading each page's raster. Tesseract is not one — it answers words, and a
 * table from them is the grid over word boxes ADR-0034 refuses.
 */
export const TABLE_ENGINES = ['automatic', 'azure', 'claude'] as const;

/**
 * Why a network engine did not read a page, as one set for both services: each service's own
 * refusal kinds (`AzureRefusal`, `ClaudeRefusal` in the kernel), `no-key` where none is stored,
 * and `unplaceable` for a grid that contradicts itself. A kind the kernel adds that is not here
 * is a compile error where main maps it, which is what keeps the two lists one list.
 */
export const SERVICE_REFUSALS = [
  'no-key',
  'not-https',
  'not-the-service',
  'unauthorised',
  'out-of-credit',
  'rejected',
  'unavailable',
  'unreachable',
  'timed-out',
  'refused',
  'truncated',
  'too-large',
  'unreadable-answer',
  'not-deleted',
  'unplaceable',
] as const;

/**
 * How `document.execute` reports a network engine's refusal — the region tools' recognition,
 * which reaches the service from a command's pre-read (ADR-0051, ADR-0057).
 *
 * **Codes and no sentence**, because that channel carries no free text (`commandHandlers.ts`), so
 * the reason is folded into the few a reader acts on differently: enter a key, fix the key, fix the
 * address, add credit, try later — and everything else, which is *the service did not read it*.
 * Until this existed every one of them reached the renderer as `internal` with an incident id.
 */
export const SERVICE_PROBLEMS = [
  'service-no-key',
  'service-unauthorised',
  'service-address',
  'service-out-of-credit',
  'service-unavailable',
  'service-refused',
] as const;

/** Each refusal's code. A reason added above without a row here is a compile error. */
export const SERVICE_PROBLEM_OF = {
  'no-key': 'service-no-key',
  // THE ADDRESS IN SETTINGS, either way it is wrong: nothing was sent, and it is the person's to fix.
  'not-https': 'service-address',
  'not-the-service': 'service-address',
  unauthorised: 'service-unauthorised',
  'out-of-credit': 'service-out-of-credit',
  rejected: 'service-refused',
  unavailable: 'service-unavailable',
  unreachable: 'service-unavailable',
  'timed-out': 'service-unavailable',
  refused: 'service-refused',
  truncated: 'service-refused',
  'too-large': 'service-refused',
  'unreadable-answer': 'service-refused',
  'not-deleted': 'service-refused',
  unplaceable: 'service-refused',
} as const satisfies Record<(typeof SERVICE_REFUSALS)[number], (typeof SERVICE_PROBLEMS)[number]>;

/** How long a refusal's sentence may be: main's words plus the service's 300 of its own. */
export const MAX_SERVICE_DETAIL = 600;

/**
 * The most characters of one table cell's text, shown or typed.
 *
 * Measured 2026-09-17 on the same corpus: the longest cell holds **461**. A cell
 * longer than this is shown cut short and cannot be edited, since an edit would
 * replace text nobody saw.
 */
export const MAX_TABLE_CELL_TEXT = 2048;

/**
 * The most removal lines a PDF/A export answers, and the most characters of each. What
 * Ghostscript prints is decided by the document, so the answer is bounded here rather than
 * by trusting it. On the corpus, 2026-09-17, one document produced one distinct line.
 */
export const MAX_PDFA_REMOVALS = 64;
export const MAX_PDFA_REMOVAL_CHARS = 400;

/**
 * The spelling dictionaries this build ships, and the ONE place they are named.
 *
 * ## One language, and that is the founding record read whole
 *
 * `BUILD-PROMPT.md`:464 asks for *"spell check (nspell + **dictionary
 * management**)"*. It is silent on **which** dictionaries ship and it is not
 * silent on whether they are managed — so a fixed baked-in set with no
 * management path would contradict the row's own name, and a Store package
 * would carry every language's bytes for every user who never opens a second
 * one. Each language is its own npm package with its own licence notice;
 * `dictionary-en` alone is 551,762 bytes (measured 2026-09-08,
 * `node_modules/dictionary-en/index.dic`, 49,568 words).
 *
 * So: one language now, and the shape that admits the next one.
 *
 * ## Adding a language is an entry here and two compile errors
 *
 * The list is the writer of record (B3). Everything that must know about a
 * language is a record keyed by {@link SpellingLanguage} — main's package map
 * and the renderer's display titles — so adding an entry here turns both red
 * until they are filled in. That is B5 rather than a checklist: you cannot add
 * a language and forget a site.
 *
 * **What is NOT decided is how a language ARRIVES**, and it stays the owner's:
 * bundled as a dependency, as `en` is, or downloaded on demand — which is a
 * network path in an application whose engine hosts have none, and a
 * provisioning decision like gitleaks' and PDFium's. This channel's shape
 * admits either, because main answers with **bytes** and never says where it
 * got them. That is the reason it is a channel at all rather than a build-time
 * asset baked into the renderer's bundle: a bundled asset cannot express a
 * dictionary that was downloaded, so it would foreclose the decision.
 */
export const SPELLING_LANGUAGES = ['en'] as const;

/** One of {@link SPELLING_LANGUAGES}. */
export type SpellingLanguage = (typeof SPELLING_LANGUAGES)[number];

/**
 * How long a setting's id may be on the wire.
 *
 * A registered id is this build's own string — `ai.azure.key` — so the bound is
 * not protecting against a document. It is here because every field on this
 * boundary is bounded, and an unbounded id is an allocation a renderer chooses.
 */
export const MAX_SETTING_ID = 128;

/**
 * How long a secret setting's value may be.
 *
 * An API key, an endpoint, a token. Generous against every credential format
 * this build is likely to meet and far short of a payload: `safeStorage`
 * encrypts what it is given, and a megabyte of "key" is a caller doing
 * something else.
 */
export const MAX_SECRET_SETTING = 8 * 1024;

/**
 * The two channels a secret setting travels on, named so prose can cite them.
 *
 * Written as a value rather than left implicit because `settings.save`'s own
 * note points at it, and a citation that resolves to nothing is the shape
 * `check:docs` cannot see (UU-1's neighbour).
 */
export const SETTINGS_SECRET_CHANNELS = ['settings.loadSecrets', 'settings.saveSecret'] as const;

/**
 * What every write that put a file on disk answers beside its own fields: a handle for what it wrote — the file, or
 * for a write of many files the folder they went into — which `file.reveal` shows in the file manager.
 *
 * **ONE SHAPE, spread into each success** rather than a field written fourteen times: *how a write names what it
 * wrote* is one rule, and a channel that spelt it differently would be a second opinion the renderer's one
 * confirmation path would have to know about (B3a). A handle and never a path, for invariant 2's reason: the renderer
 * can ask for the file to be shown and cannot learn where it is.
 */
export const WRITTEN = { written: fileHandleSchema } as const;

/** The browser's own edit commands `window.edit` runs, named as `webContents` names its methods. */
export const WINDOW_EDIT_ACTIONS = ['cut', 'copy', 'paste', 'selectAll'] as const;
export type WindowEditAction = (typeof WINDOW_EDIT_ACTIONS)[number];

/**
 * The Store application's pages this build opens. `review` is reached by the rating prompt through `app.review`;
 * `updates` (*Help › Check for updates*) and `listing` (the update indicator, ADR-0110) by `app.openStore`. `main`
 * holds one table of their URIs, so the two routes share one opener.
 */
export const STORE_PAGES = ['review', 'updates', 'listing'] as const;
export type StorePage = (typeof STORE_PAGES)[number];

/**
 * Bounds on what the assistant's channels carry.
 *
 * **A model id is short and a conversation is not a document.** 128 characters is longer
 * than any id these providers answered when their lists were probed on 2026-09-17; 16 KiB
 * a turn and 64 turns is a long conversation about a document, and a renderer that wanted
 * to send the document would be doing something this channel is not for — what is sent is
 * named on the assistant's *Asking about* line, and the page text it refers to travels the
 * channels that already carry page text.
 */
export const MAX_MODEL_ID = 128;
export const MAX_MODELS = 512;
export const MAX_CHAT_TEXT = 16_384;
export const MAX_CHAT_TURNS = 64;

/**
 * Why asking a provider for its models did not answer a list — the one set a list and a key check both carry.
 * `not-the-service` is an address that is not the provider's own, and nothing was sent to it.
 */
export const AI_LIST_PROBLEMS = ['unauthorised', 'unreachable', 'rejected', 'unreadable', 'not-the-service'] as const;

/**
 * One provider's model list as it crosses: where it came from, what went wrong asking, and the models. The ONE
 * shape `ai.models` answers and the Settings dialog opens with (ADR-0117), so the two surfaces cannot disagree
 * about what a list is.
 */
export const aiModelListSchema = z.object({
  source: z.enum(['fetched', 'fallback', 'no-list']),
  problem: z.enum(AI_LIST_PROBLEMS).optional(),
  models: z
    .array(
      z.object({
        id: z.string().min(1).max(MAX_MODEL_ID),
        label: z.string().min(1).max(MAX_MODEL_ID),
        capabilities: z.object({
          vision: z.boolean().nullable(),
          streaming: z.boolean().nullable(),
        }),
      }),
    )
    .max(MAX_MODELS),
});

export type AiModelListAnswer = z.infer<typeof aiModelListSchema>;

/**
 * One turn of a SAVED conversation (ADR-0093): who said it, what, and what an asked turn sent —
 * never a reply target or a *posted* mark, which belong to one session's document version. Also
 * what `main` validates a decrypted conversation against, so one schema says what a saved turn is.
 * Text may be empty only for an answer that was stopped before its first word.
 */
/**
 * How long a document's name may be.
 *
 * NTFS bounds a single path component at 255 UTF-16 code units, so this is that
 * limit rather than a number chosen here — the name main sends is a file name,
 * and a bound looser than the filesystem's would be admitting a value no file
 * can have. **It bounds the string and does not shorten it**: truncating a name
 * on the way to the renderer would put a lie in the one place a reader checks
 * which document they are looking at.
 *
 * DECLARED ABOVE ITS FIRST READER, `savedTurnSchema`: a schema is built when the module loads, and a `const` read
 * before its declaration throws there.
 */
export const MAX_DOCUMENT_NAME_LENGTH = 255;

export const savedTurnSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string().max(MAX_CHAT_TEXT),
    sent: askSentSchema.optional(),
    /** The model an asked turn went to, as its picker named it — so a restored answer keeps its caption. */
    model: z.string().max(MAX_MODEL_ID).optional(),
    /** The names of the files an asked turn carried (ADR-0135) — never a handle, which means nothing after a restart. */
    attached: z.array(z.string().max(MAX_DOCUMENT_NAME_LENGTH)).max(MAX_ASK_ATTACHMENTS).optional(),
  })
  .strict();

export const savedTurnsSchema = z.array(savedTurnSchema).max(MAX_CHAT_TURNS);

export type SavedTurn = z.infer<typeof savedTurnSchema>;

/** {@link SPELLING_LANGUAGES} as a schema, derived rather than respelt. */
export const spellingLanguageSchema = z.enum(SPELLING_LANGUAGES);

/**
 * How large an affix file may be.
 *
 * Measured 2026-09-08: `dictionary-en`'s is **3,086 bytes**. An affix file is a
 * grammar rather than a word list, so it does not scale with vocabulary — no
 * language's is going to be near this.
 */
export const MAX_AFFIX_BYTES = 256 * 1024;

/**
 * How large a dictionary's word list may be.
 *
 * Measured 2026-09-08: `dictionary-en`'s is **551,762 bytes** for 49,568 words.
 *
 * **This bound is L11 and not tuning**, and the distinction matters because
 * only one language has ever been measured here. Its job is to refuse a payload
 * that grows without limit, not to be the smallest number that fits English —
 * a morphologically richer language's list is legitimately several times this
 * and nothing in this repository can say how much. **The trigger:** the first
 * dictionary that exceeds it is a measurement of that dictionary, never a
 * larger round number chosen to make a red check green.
 */
export const MAX_DICTIONARY_BYTES = 4 * 1024 * 1024;

/**
 * How many links one part of a page's links carries.
 *
 * A PART, not the page's links: as the whole page's bound it refused every link on a page past it (JOURNAL, *No
 * document-size refusals*, table A row 7). A longer list crosses in several ({@link listPartFromSchema}, ADR-0130).
 */
export const PAGE_LINKS_PART = 4096;

/**
 * How long a link's URI may be.
 *
 * The one string in that shape a DOCUMENT controls, so it is the one that needs a length. A real document crosses it —
 * a tracking link runs past 2,048 — so the host shows a longer URI shortened with an ellipsis rather than refusing the
 * page's links, and nothing follows the shown text (invariant 24).
 */
export const MAX_LINK_URI_LENGTH = 2048;

/**
 * Where one PART of a list that grows with the document begins, and where the next part does
 * ([ADR-0130](../../../docs/DECISIONS/0130-a-documents-size-never-refuses-an-action.md) Decision 2).
 *
 * A document-wide list — the annotations, the form fields, the outline — is answered a part at a time. The renderer
 * asks `from` an offset; `main` answers at most a part's worth of the list beginning there, and `next`, the offset the
 * following part begins at, or `null` when the list is complete. Each call is bounded, which is invariant 11's own
 * term (*per operation*), and the list is as long as the document's: a person is never told a panel shows only the
 * first few thousand.
 *
 * Every part carries the `version` it was cut from, so a renderer that sees the version move between two parts knows
 * it holds halves of two lists and starts again (`readWholeList`). `next` is POSITIVE where present, so a part can
 * never point back at the start of the list it is part of.
 */
export const listPartFromSchema = z.number().int().nonnegative();
export const listPartNextSchema = z.number().int().positive().nullable();

/**
 * How many outline entries one part carries, and how long a title may be.
 *
 * A PART, not the outline: an outline longer than this crosses in several ({@link listPartFromSchema}). The number is
 * the size of one call, set where a part is cheap to validate and render and far past a panel's first screen. A
 * 512-character heading is one a panel truncates rather than one it refuses.
 */
export const DESTINATIONS_PART = 4096;

/**
 * How many groups a person may write for one split.
 *
 * A **request** bound, and it bounds only the groups a person TYPED: *one file
 * per page* travels as `each`, one page set, so a document of any length splits
 * by page without reaching it (JOURNAL, *No document-size refusals*). Each group
 * is itself a page set, so the request stays small however many pages a group
 * spans, and what this refuses is a list of ranges no person wrote.
 */
export const MAX_SPLIT_PARTS = 4096;

export const MAX_DESTINATION_TITLE_LENGTH = 512;

/**
 * One entry in a document's outline, flattened.
 *
 * ## Named, because it now has TWO readers and one of them is not a channel
 *
 * It was inline in `document.destinations`' result while the renderer was the
 * only thing that saw it. ADR-0040's 2026-09-05 extension gives a command's
 * `apply` the outline as pre-read data, so the **kernel seam** names this shape
 * too — and a second inline copy there would be two declarations of one thing,
 * which is what B3 spends its time on. `@monstera/kernel`'s `Destination` is
 * this type, `Readonly`-wrapped, rather than a sibling: the kernel reads a
 * document and fills this shape, so the schema is the end that declares it.
 *
 * That sentence stated a relationship this file could not produce for a day —
 * `Destination` was a hand-written interface restating these three fields, and
 * the alias landed 2026-09-05 in its own commit. Recorded because the false
 * half was in the CONTRACT: a reader here believed there was one declaration
 * while the reader in `destinations.ts` was told there were two, which is the
 * cross-document shape NNN-4 names and no link check can see.
 */
export const outlineEntrySchema = z.object({
  title: z.string().max(MAX_DESTINATION_TITLE_LENGTH),
  /**
   * Zero-based, or `null` when the entry resolves to no page.
   *
   * **`null` is a real state**: an outline may point at an external URI or at a
   * destination the document does not define, and both should reach a reader
   * rather than be dropped — a gap in a table of contents is more confusing
   * than an entry that cannot be followed. Nullable rather than optional
   * because JSON cannot carry `undefined`, so one spelling travels end to end.
   */
  page: z.number().int().nonnegative().nullable(),
  /** How deep in the outline it sits. The top level is 0. */
  depth: z.number().int().nonnegative(),
});

/** One outline entry. See {@link outlineEntrySchema}. */
export type OutlineEntry = z.infer<typeof outlineEntrySchema>;

/**
 * How many layers one part carries.
 *
 * A PART, not the document's layers: a CAD export carries thousands, and as the whole list's bound this refused
 * every one of them (JOURNAL, *No document-size refusals*, table A row 6). A longer list crosses in several
 * ({@link listPartFromSchema}, ADR-0130), and the host's walk stops only at a derived hostile-host bound and says so.
 */
export const LAYERS_PART = 1024;

/**
 * How many duplicate pages may be reported in one answer.
 *
 * The report is a list of page indices and a document may be duplicates all the
 * way down — a scanned bundle of one blank page repeated ten thousand times is
 * the shape that produces the worst case, and it is not a hostile document, it
 * is a Tuesday. So the answer is bounded and says when the bound stopped it,
 * for `document.searchPage`'s reason: without that flag a caller cannot tell
 * *this document has five hundred duplicates* from *you asked for five
 * hundred*.
 */
export const MAX_DUPLICATE_PAGES = 4096;

/**
 * How many annotations one part carries, and how much of a note.
 *
 * A PART, not the document's annotations: a heavily reviewed document carries thousands of comments and is ordinary,
 * so a list longer than this crosses in several ({@link listPartFromSchema}, ADR-0130).
 *
 * The note is much smaller because it is one line in a panel, and it is a
 * SLICE rather than a refusal — a note longer than this is still a note, and
 * refusing the annotation would hide it from the list it belongs in.
 */
export const ANNOTATIONS_PART = 4096;
export const MAX_ANNOTATION_CONTENTS = 512;

/**
 * How many form fields one part carries, and how much of a value, name or option list.
 *
 * A PART, for {@link ANNOTATIONS_PART}' reason one noun along: a generated form pack carries thousands of fields and is
 * ordinary, so a form longer than this crosses in several ({@link listPartFromSchema}, ADR-0130).
 *
 * **The option bound is per FIELD, not per document**, which is the one place
 * this differs from the annotation shape: a dropdown of every country is around
 * two hundred entries and is ordinary, so the bound sits where a list a
 * document controls is built.
 *
 * **The value bound is per field too, and it is smaller than the option bound
 * on purpose**: a selection is a subset of what is offered, so a field naming
 * more values than half its options is a document doing something other than
 * recording a choice. It is a bound on an array a hostile document controls,
 * not a promise about what a form may hold.
 */
export const FORM_FIELDS_PART = 4096;
export const MAX_FORM_FIELD_TEXT = 512;
export const MAX_FORM_FIELD_OPTIONS = 512;
export const MAX_FORM_FIELD_VALUES = 256;

/**
 * How many field candidates one page may propose, and how long a label may be.
 *
 * `MAX_CREATED_FIELDS`' number, and deliberately so rather than by coincidence:
 * accepting a page of candidates becomes one `createFormField`, so a page that
 * proposed more than that command carries would offer an accept it cannot send.
 */
export const MAX_FLAT_FIELD_CANDIDATES = 256;

/**
 * The barcodes one page may report, and the longest text one may carry: the engine host's
 * bounds (`ENGINE_BARCODES_MAX`, `ENGINE_BARCODE_TEXT_MAX`) on this wire — 7,089 is the most any
 * symbology carries, a QR code of digits. `contractHandlers.test.ts` holds the two pairs equal.
 */
export const MAX_PAGE_BARCODES = 64;
export const MAX_BARCODE_TEXT = 7089;

/**
 * The symbologies a person may generate, in zxing-cpp's names.
 *
 * A COPY of `@monstera/kernel/barcode`'s `BARCODE_WRITE_FORMATS`, because this package cannot
 * import the kernel; `contractHandlers.test.ts` holds the two equal.
 */
export const BARCODE_FORMATS = ['QRCode', 'DataMatrix', 'Aztec', 'PDF417', 'Code128', 'EAN13'] as const;

/**
 * The accessibility checks only a person can make, by name (ADR-0078). A COPY of the kernel's
 * `HUMAN_CHECKS`, for {@link BARCODE_FORMATS}' reason; `contractHandlers.test.ts` holds them equal.
 */
export const ACCESSIBILITY_HUMAN_CHECKS = [
  'reading-order',
  'alternative-text-meaningful',
  'headings-reflect-structure',
  'table-headers-correct',
  'colour-not-sole-means',
  'language-of-passages',
  'link-text-meaningful',
] as const;

/**
 * How long one read run's text may be — the PDFium host's own bound on a run (`PDFIUM_PRIOR_TEXT_MAX`), so any run
 * the host answers can cross (ADR-0142 Decision 5).
 *
 * A read's lines and runs are bounded by `MAX_EDIT_RUNS`, the edit's: a surface offers what this read answered and
 * sends what the person accepted as one command, so the read must never offer more than the command can carry. That
 * relationship is **≤**, and here it is equality because both are a page's runs. It was the command's per-text 4,096
 * reused for the run, which two bounds that agree are not.
 */
export const MAX_RUN_TEXT = 65_536;

/**
 * How many text blocks, and how many page objects, one PART of a page's read carries
 * ([ADR-0130](../../../docs/DECISIONS/0130-a-documents-size-never-refuses-an-action.md) Decision 2).
 *
 * A PART, not the page: a dense table page is thousands of blocks, and a page drawn one glyph per object is thousands
 * of objects (8,400 measured, JOURNAL 2026-10-02, *No document-size refusals*). Both lists were bounded at
 * 512 and answered whole, while `main` forwarded every block and up to 45,800 objects — so such a
 * page was refused as `internal` by this contract, finding AAAAAAA-1. They now cross a part at a time, as the outline
 * does ({@link listPartFromSchema}). The figure is the old bound, so one part costs what the whole list used to.
 */
export const TEXT_BLOCKS_PART = 512;
export const PAGE_OBJECTS_PART = 512;

/**
 * A box in PDF user space — left, bottom, right, top — as `document.textBlocks`
 * answers one. `z.number()` is finite in zod 4, so a `NaN` from an engine is a
 * refusal at the boundary rather than an outline drawn nowhere.
 */
export const pdfBoxSchema = z
  .object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() })
  .strict()
  .refine((box) => box.x1 >= box.x0 && box.y1 >= box.y0, { message: 'a box is not inside out' });

/**
 * How a block's text is set, as far as an editor drawn over it can use.
 *
 * The page's own font program never travels — a renderer that loaded it would
 * be a second parser of the document's bytes — so what crosses here is its KIND
 * and the size it is drawn at. `colour` is the fill its glyphs are painted in.
 * A run whose embedded program the host can check and rebuild has that rebuilt
 * font on its own read, `document.runFonts` (ADR-0175), never in this answer.
 */
export const textBlockStyleSchema = z
  .object({
    /** The size the text is drawn at, in points. */
    size: z.number().nonnegative(),
    colour: z
      .object({
        r: z.number().int().min(0).max(255),
        g: z.number().int().min(0).max(255),
        b: z.number().int().min(0).max(255),
      })
      .strict(),
    serif: z.boolean(),
    mono: z.boolean(),
    italic: z.boolean(),
    bold: z.boolean(),
  })
  .strict();

export type TextBlockStyle = z.infer<typeof textBlockStyleSchema>;

/**
 * How many pixels one `document.renderPage` may be asked for.
 *
 * **A caller-stated maximum's ceiling**, which is what ADR-0031 permits a raster
 * to cross under. Sixteen million is 4096×4096 — larger than any single page on
 * any display this application runs on, and small enough that a caller cannot
 * ask the second engine to rasterise a wall.
 *
 * It bounds the WORK. `MAX_RASTER_BYTES` bounds the answer, and the two are not
 * redundant: a pixel cap alone leaves the payload unbounded, because a PNG's
 * size depends on what is on the page.
 */
export const MAX_RASTER_PIXELS = 16_777_216;

/**
 * How many bytes one rasterised page may carry back.
 *
 * **Bounds the ANSWER**, where the constant above bounds the work. Thirty-two
 * megabytes is well past a text page — measured at tens of kilobytes — and past
 * a photographic one at any size this permits; what it refuses is the case where
 * PNG cannot compress a full-size raster, which is a payload nobody should
 * receive whatever asked for it.
 *
 * A refusal rather than a crop, because half a page is a picture of a document
 * that does not exist.
 */
export const MAX_RASTER_BYTES = 32 * 1024 * 1024;
export const MAX_FLAT_FIELD_LABEL = 128;

/** The folders a recent file's location may be named by: the three a person keeps files in, and each cloud's. */
export const KNOWN_FOLDERS = ['documents', 'downloads', 'desktop', ...CLOUD_PROVIDER_IDS] as const;

/** One of {@link KNOWN_FOLDERS}. */
export type KnownFolder = (typeof KNOWN_FOLDERS)[number];

/**
 * Where a recent file is, as main describes it for display
 * ([ADR-0100](../../../docs/DECISIONS/0100-a-recent-file-shows-where-it-is-and-a-preview-both-from-main.md)).
 *
 * ## A structure, not text, so the page translates the part that is words
 *
 * `within` is the known folder the file is under, as a KEY — the page says *Documents* or *OneDrive* in
 * the reader's language — and `folder` is the name of the folder the file is in, which is the person's own
 * text and is shown as it is. Neither is ever a drive or a path: at most those two, and either may be
 * absent (a file directly in a known folder has no `folder`; a working copy's folder is an internal id and
 * is not shown).
 *
 * **Branded**, so the page cannot build one: it only ever holds what main's answer parsed into. No
 * channel's parameters take one, which `channels.test.ts` asserts by walking every parameter schema.
 */
export const displayLocationSchema = z
  .object({
    within: z.enum(KNOWN_FOLDERS).nullable(),
    folder: z.string().min(1).max(MAX_DOCUMENT_NAME_LENGTH).nullable(),
  })
  .strict()
  .brand<'DisplayLocation'>();

/** See {@link displayLocationSchema}. */
export type DisplayLocation = z.infer<typeof displayLocationSchema>;

/**
 * How many recent documents may cross.
 *
 * The store's own cap, restated as the boundary's bound — and restated rather
 * than imported because `apps/desktop` may import this package and not the
 * reverse. The two agreeing is asserted by a case rather than by the type,
 * which is the honest arrangement: a bound the sender could exceed is the one
 * worth having at a boundary.
 *
 * **That case did not exist until 2026-09-03**, and this comment was the whole
 * of what made it look covered — the constant was named in exactly two places,
 * both in this file. `recentFiles.test.ts` now holds it. A sentence describing
 * a mechanism reads exactly like one, which is why the audit that found this
 * looked for the case rather than for a disagreement.
 *
 * **TEN, AND NOT A CHOICE (the owner, 2026-10-02, item N3): *"Main keeps up to 10 recent files; the start screen
 * still shows 4."*** ([ADR-0143](../../../docs/DECISIONS/0143-file-recent-is-the-menu-rows-own-value-control-and-main-keeps-ten.md)).
 * From 2026-09-28 the cap was a person's choice of 5 to 30 (`viewing.recent-length`) while the start screen showed
 * four, and on 2026-10-01 the owner cut it to four (*"Keep only the latest 4"*): a remembered file no surface showed is
 * the display-only defect. That reason still holds and is what makes ten right now — File › Recent shows every entry
 * this bounds, and the start screen shows the first four of the same answer (`START_SCREEN_RECENT`, the start
 * screen's own number).
 */
export const MAX_RECENT_ENTRIES = 10;

/**
 * Whether a recent file is there now: found, not found, or still being looked for when the list was due. ONE ENUM, not
 * two booleans, so a file both found and still being looked for cannot be said (B5).
 */
export const RECENT_AVAILABILITY = ['available', 'unavailable', 'checking'] as const;

/** One of {@link RECENT_AVAILABILITY}. */
export type RecentAvailability = (typeof RECENT_AVAILABILITY)[number];

const recentAvailabilitySchema = z.enum(RECENT_AVAILABILITY);

/**
 * How long main waits for the recent files' checks before it answers the list, in milliseconds: the owner's *"the list
 * shows at once"*. Each check is a `stat` and a `realpath`, which answer in well under a millisecond on a local disk
 * and can wait the operating system's own timeout on a network drive that has gone; one past this answers `checking`.
 */
export const RECENT_CHECK_CAP_MS = 200;

/**
 * How many documents a recorded SESSION carries — what was open when a run ended, for the crash offer and
 * `viewing.restore-session`.
 *
 * NOT the recent cap, which bounded it until 2026-10-01: a session is the reader's open tabs, and a crash offer that
 * reopened four of six would drop two documents without a word ("preserve, never drop"). Thirty is the bound this
 * channel already carried — the widest recent length the withdrawn setting allowed — so no session a build has
 * written is refused by this one.
 */
export const MAX_SESSION_ENTRIES = 30;

/**
 * Part F's *"backup copies to keep"* (`BUILD-PROMPT.md`:617): how many earlier versions a save leaves beside the file —
 * `report.pdf.bak`, then `.bak2`, `.bak3` — the newest first. ONE TABLE, read by the renderer's setting and by `main`'s
 * save, so a choice a person can make is always one the save understands. One is the default: §4's one `.bak`, which
 * every save wrote before this was a choice.
 *
 * **No `none`, and the law is why**: `docs/ARCHITECTURE.md` §4 writes the pipeline as *temp, fsync, rename, `.bak`*,
 * so a choice that took the `.bak` away would drop a step the law names. Offering it would be a B4 amendment; more
 * copies than one extends the step and changes nothing it promises.
 */
export const BACKUP_COPIES = { one: 1, three: 3, five: 5, ten: 10 } as const;

/** One of {@link BACKUP_COPIES}' choices. */
export type BackupCopies = keyof typeof BACKUP_COPIES;

/** The id `main`'s save reads and the renderer's setting declares. */
export const BACKUP_COPIES_SETTING_ID = 'saving.backup-copies';

/** The most backups any choice keeps — how far a save looks for ones a shorter choice no longer keeps. */
export const MAX_BACKUP_COPIES: number = Math.max(...Object.values(BACKUP_COPIES));

/**
 * The largest recent-card picture that is kept or crosses (ADR-0100). A bound on the message, not a size
 * aimed at: measured 2026-09-25 over the 11-file corpus, page 1 at quality 60 is at most 73,186 bytes, and a
 * page larger than Letter grows with its area — A3 is about twice as many pixels. A picture over this is not
 * kept, and its card shows the placeholder.
 */
export const MAX_RECENT_PREVIEW_BYTES = 256 * 1024;

/**
 * Whether recent files keep a picture of their first page — a Privacy setting, on unless a person turns it
 * off (ADR-0100). Named here because main reads it before every capture and the renderer declares its
 * control: one id, two readers, as `CHAT_HISTORY_SETTING_ID` is.
 */
export const RECENT_PREVIEWS_SETTING_ID = 'privacy.recent-previews';

/**
 * Whether crash reports are kept on this computer (ADR-0109) — on unless turned off. `main` reads it at start, before
 * the first window, and the renderer declares its control: one id, two readers.
 */
export const CRASH_REPORTS_SETTING_ID = 'privacy.crash-reports';

/**
 * How much the diagnostics log records (ADR-0119): problems only, or also one line per request. `main` reads it and
 * the renderer declares its control — one id, two readers, as {@link CRASH_REPORTS_SETTING_ID} is.
 */
export const LOG_DETAIL_SETTING_ID = 'advanced.log-detail';

/**
 * The largest settings file `settings.import` reads: 1 MiB, checked against the file's size before a byte is read.
 * Chosen, not derived from a measured export: it bounds a file that is not one — a picture renamed `.json` — rather
 * than sizing a real one.
 */
export const MAX_SETTINGS_FILE_BYTES = 1_048_576;

/** {@link LOG_DETAIL_SETTING_ID}'s two values, the first the default. */
export const LOG_DETAILS = ['problems', 'detailed'] as const;

/** A crash report's id: its file's NAME, never a path (ADR-0109). */
export const crashReportIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/u);

/**
 * A release's version: `MAJOR.MINOR.PATCH`, digits only, no leading zeros and no pre-release tag
 * ([ADR-0110](../../../docs/DECISIONS/0110-the-update-check-is-built-dormant-and-reads-numbers-only.md)).
 * Six digits a part is far past any version this application will reach, and bounds the string.
 */
export const releaseVersionSchema = z
  .string()
  .max(20)
  .regex(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/u);

/**
 * Orders two versions the schema above accepts: negative, zero or positive, part by part. **Numbers compare as
 * numbers** — `1.2.10` is above `1.2.9`, which a string comparison gets wrong. The one comparison the manifest's
 * own rule and main's check both take (B3a).
 */
export function compareReleaseVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let part = 0; part < 3; part += 1) {
    const difference = (left[part] ?? 0) - (right[part] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The update manifest monsterapdf.com serves for the Store build (ADR-0018, ADR-0110).
 *
 * **Numbers only, and `.strict()`, on purpose.** The file carries no address and no text, so a manifest a stranger
 * swapped can at worst show a false *update available* that opens the real Microsoft Store; every sentence a person
 * reads is this application's own. A field added here would widen that — and an installed build reads this file for
 * years, so a new shape is published at a new path (`/v2/`) rather than added to this one.
 */
export const updateManifestSchema = z
  .object({
    /** The shape's own number, as the path's `/v1/` is. */
    schema: z.literal(1),
    /** Which build this file describes; a store build refuses any other. */
    channel: z.literal('store'),
    /** The newest version the Store offers. */
    version: releaseVersionSchema,
    /** Below this, an installed build is no longer supported. */
    minimumVersion: releaseVersionSchema,
    /** Whether `version` fixes a security problem — the notice that needs acknowledging. */
    security: z.boolean(),
  })
  .strict()
  .refine((manifest) => compareReleaseVersions(manifest.minimumVersion, manifest.version) <= 0, {
    message: 'the minimum supported version is above the newest',
  });

export type UpdateManifest = z.infer<typeof updateManifestSchema>;

/**
 * Where the Store build reads the manifest — a state, not an address (ADR-0110).
 *
 * **Dormant until the owner says monsterapdf.com serves the file.** While dormant, main's check answers `dormant`
 * and calls nothing, and the renderer registers no switch for it. Going live is {@link UPDATE_MANIFEST}'s one value:
 * `{ state: 'live', url: 'https://monsterapdf.com/updates/v1/store.json' }` — the proposed path, `/v1/` because an
 * installed build reads it for years. The type admits that host only, over HTTPS.
 */
export type UpdateManifestAddress =
  | { readonly state: 'dormant' }
  | { readonly state: 'live'; readonly url: `https://monsterapdf.com/${string}` };

/** This build's manifest address. Dormant: nothing hosts the file yet (the owner's work list, 2026-09-26). */
export const UPDATE_MANIFEST: UpdateManifestAddress = { state: 'dormant' };

/** Whether the Store build checks for a newer version. Main reads it when the check runs; the renderer declares it. */
export const UPDATE_CHECK_SETTING_ID = 'updates.check';

/**
 * What this start's update check found (ADR-0110).
 *
 * `none` — this build's channel has no check (a development or web build); `dormant` — the build has no address;
 * `off` — the person turned the check off; `unknown` — a request was made and no usable answer came back. The other
 * four are what the manifest said, and `security` carries whether this person acknowledged that release.
 */
export const updateStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('dormant') }).strict(),
  z.object({ kind: z.literal('off') }).strict(),
  z.object({ kind: z.literal('unknown') }).strict(),
  z.object({ kind: z.literal('current') }).strict(),
  z.object({ kind: z.literal('newer'), version: releaseVersionSchema }).strict(),
  z.object({ kind: z.literal('unsupported'), version: releaseVersionSchema }).strict(),
  z.object({ kind: z.literal('security'), version: releaseVersionSchema, acknowledged: z.boolean() }).strict(),
]);

export type UpdateStatus = z.infer<typeof updateStatusSchema>;

/**
 * Whether Monstera may ask for a Store rating (the founding record's E3: *"A Settings toggle surfaces
 * `optedOut` so the choice is reversible and visible"*). On unless a person turns it off — here, or with the
 * prompt's *Don't ask again*, which writes this same value. Main reads it before every prompt, so the
 * opt-out has one home and one writer rather than a copy in the engagement record.
 */
export const REVIEW_PROMPTS_SETTING_ID = 'advanced.review-prompts';

/**
 * Whether the first-run AI setup is offered at start; a Skip stores `false`. Named here because more than the
 * renderer spells it: every harness that drives the shipped shell starts past the first run by storing this, and the
 * first run is its own case — two spellings of one id is a harness that silently starts on the first run again.
 */
export const AI_SETUP_AT_START_SETTING_ID = 'ai.setup-at-start';

/**
 * A link's rectangle, in the page's own units.
 *
 * ## `z.number()` ALREADY refuses `Infinity` and `NaN` here, and that matters
 *
 * This was written `z.number().finite()` on the reasoning that a non-finite
 * corner travels through JSON as easily as a coordinate and arrives in the
 * renderer's layout arithmetic, where it produces an element of infinite size
 * rather than an error anybody can trace. The reasoning is right and the call
 * was a **no-op**: zod 4.4.3 rejects non-finite numbers by default, and
 * `.finite()` is deprecated for saying so.
 *
 * Recorded rather than silently dropped, because the property is load-bearing
 * and the next reader deserves to know it is the base schema that carries it —
 * not a modifier they might remove as noise.
 */
const linkBoundsSchema = z.object({
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number(),
});

/**
 * The longest query this boundary will carry.
 *
 * Not an L11 bound — a query is the *renderer's* string and does not scale with
 * the document — but a schema that accepted an unbounded one would let a
 * renderer hand main an arbitrarily large allocation, and every other payload
 * here is bounded. 512 is far above any search a person types and far below
 * anything worth worrying about.
 *
 * **A LITERAL AGAIN, and the round trip is finding W-1's.** It was derived from
 * `MAX_FIND_TEXT` on 2026-09-10 on the reading that both answer *how long a
 * string may a person type into a box* — which is true, and is not enough. A
 * query is a READ's parameter and a find string is a COMMAND's, and the two can
 * correctly differ: a search that a person cancels costs a page walk, where a
 * replacement rewrites a document. Nothing says they must move together, and a
 * derivation asserts that they must.
 *
 * The test the audit left behind is the one to apply here: **could the two
 * numbers ever correctly differ?** They could, so they are two numbers, and the
 * relationship — they are the same today, for the same reason — is prose.
 */
export const MAX_QUERY_LENGTH = 512;

/**
 * How many signatures one document may report.
 *
 * `ENGINE_SIGNATURES_MAX`'s twin on the renderer's side of the boundary, and a
 * literal here for `MAX_QUERY_LENGTH`'s own reason: the two could correctly
 * differ, because one bounds what a contained host may say and one bounds what
 * a panel will draw.
 */
export const MAX_SIGNATURES = 256;

/**
 * What opening a document answers, for the two channels that open one.
 *
 * Named once because `document.open` and `document.openRecent` differ in what
 * they are ASKED and not in what they answer — a renderer that handles one
 * handles the other, and two copies of a five-variant union would be two places
 * for the next variant to land in one of.
 *
 * See `document.open` for what each variant means and why `cancelled` is an
 * outcome rather than a failure.
 */
/** A cloud request that only succeeds or is refused by name (ADR-0091). */
const cloudDoneSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('done') }),
  z.object({ kind: z.literal('refused'), reason: z.enum(CLOUD_REFUSALS) }),
]);

/**
 * The most documents one launch may name on its command line and have opened — main's `documentPathsIn` takes no
 * more. A bound, not a measurement: Explorer launches a process per file for a larger selection.
 */
export const MAX_LAUNCH_DOCUMENTS = 32;

/**
 * The most undo copies of one document a save can report: each is a terminal entry's checkpoint, and the log sheds
 * them to a byte ceiling long before this — a bound so the answer has one, not a measurement.
 */
const MAX_UNDO_COPIES = 100_000;

/**
 * What a redaction's, Sanitize's or flatten's save deleted, permanently, because it may still have held what was removed
 * ([ADR-0139](../../../docs/DECISIONS/0139-a-removals-save-deletes-the-backups-monstera-made.md)): the backups beside
 * the file that Monstera made and the undo copies, by count; and BY NAME — the names a save gives backups,
 * `report.pdf.bak` and on — the files with such a name that Monstera did not make, which are kept. No path crosses
 * (invariant L2).
 */
const clearedCopiesSchema = z
  .object({
    backups: z.number().int().nonnegative().max(MAX_BACKUP_COPIES),
    undoCopies: z.number().int().nonnegative().max(MAX_UNDO_COPIES),
    kept: z.array(z.string().min(1).max(MAX_DOCUMENT_NAME_LENGTH)).max(MAX_BACKUP_COPIES),
  })
  .strict();

/** The names of a document's older copies that are owed a deletion and still held by another program (CR-DOC-10). */
const heldCopiesSchema = z.array(z.string().min(1).max(MAX_DOCUMENT_NAME_LENGTH)).max(MAX_BACKUP_COPIES);

/** A document that opened — `document.open`'s success, and the base of an import that opened with a note. */
const openedSchema = z.object({
    kind: z.literal('opened'),
    docId: docIdSchema,
    version: docVersionSchema,
    /**
     * The document's size in bytes — what a `PDFDataRangeTransport` is
     * constructed with. Bounded, so L11 is untouched: a number is the same size
     * for a 2 KB document and a 2 GB one.
     */
    byteLength: z.number().int().nonnegative(),
    /**
     * What to call this document on screen — its file name, and **only** its
     * file name.
     *
     * ## Stated by main rather than derived by the renderer
     *
     * There is no path here to derive it from, by invariant L2, and that is the
     * point rather than an inconvenience: a renderer that could produce a name
     * would be a renderer that had a path. So main answers the question it is
     * the only one able to answer, and the renderer displays a string.
     *
     * ## A NAME, not a path, and the difference is a leak
     *
     * `report.pdf`, never `C:\Users\someone\Documents\report.pdf`. A status bar
     * showing the second one puts a user's directory layout on screen — in a
     * screenshot, in a screen share, in a support ticket — and it is the same
     * thing L2 keeps out of the renderer's hands, arriving as text.
     * `documentService.ts` sends `basename` for that reason.
     */
    name: z.string().max(MAX_DOCUMENT_NAME_LENGTH),
  });

/** The file is not where it was named — gone between being chosen and being read. */
const openAbsentSchema = z.object({ kind: z.literal('absent') });

/**
 * There is no room on the disk for the document's image file. A document too large for memory is held in a file and
 * opens (ADR-0165), so the room that ran out is the disk's.
 */
const openAtCapacitySchema = z.object({
  kind: z.literal('at-capacity'),
  /** The bytes the image file needed. */
  wouldHold: z.number().int().nonnegative(),
  /** The bytes the disk reported free, or 0 where it could not be asked. */
  ceiling: z.number().int().nonnegative(),
});

/**
 * The file is there and reading it was refused: `busy`, another program holds it open and lets nobody else read it;
 * `denied`, this account may not read it. Each says what the person can do, so each is a kind of its own.
 */
const openReadRefusedSchema = z.object({ kind: z.enum(['busy', 'denied']) });

const openOutcomeSchema = z.discriminatedUnion('kind', [
  openedSchema,
  z.object({ kind: z.literal('already-open'), docId: docIdSchema }),
  openAbsentSchema,
  openAtCapacitySchema,
  openReadRefusedSchema,
  z.object({ kind: z.literal('cancelled') }),
]);

/**
 * What an import that composes a new document answers — one union for every source
 * format ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * The composed file is opened exactly as a picked one is, so this answers everything
 * `document.open` can. The rest are the file's: `too-large` and `unreadable` before
 * anything is composed, `composition-refused` with the reason and the source line —
 * its own name, because `refused` on `document.saveCopy` already means *another
 * document holds the destination* — and the destination's two outcomes a copy has.
 *
 * **Declared once** because the Markdown and CSV imports answer the same outcomes,
 * and two copies of this union would be two opinions about what an import can end in.
 */
/** Past the format's byte bound — refused before it is read into memory. */
const importTooLargeSchema = z.object({ kind: z.literal('too-large'), limitBytes: z.number().int().positive() });
/** The file could not be read. */
const importUnreadableSchema = z.object({ kind: z.literal('unreadable') });
/** Another open document reaches the chosen destination. Nothing was written. */
const importContestedSchema = z.object({
  kind: z.literal('destination-contested'),
  openElsewhere: z.number().int().positive(),
});
/** The filesystem refused. Nothing at the destination was replaced. */
const importWriteFailedSchema = z.object({ kind: z.literal('write-failed') });

const composedImportOutcomeSchema = z.discriminatedUnion('kind', [
  ...openOutcomeSchema.options,
  importTooLargeSchema,
  importUnreadableSchema,
  z.object({
    kind: z.literal('composition-refused'),
    reason: z.enum(COMPOSE_REFUSALS),
    /** The one-based source line the refusal is about, where there is one. */
    line: z.number().int().positive().nullable(),
    /**
     * The NAME of the picked file the refusal is about, where an import took several.
     *
     * Its own field and never `line`, because an image has no lines. A name and not a
     * position, because the person knows their files by name and not by the order a
     * dialog returned them in: the compose host answers a position, and main — which
     * holds the picked list — is the one place the two meet. A name is not a path.
     */
    file: z.string().min(1).max(MAX_DOCUMENT_NAME_LENGTH).nullable(),
  }),
  importContestedSchema,
  importWriteFailedSchema,
]);

/** How many blocks of a workbook an import NAMES as not converted; past it, `more` counts the rest. */
export const MAX_OFFICE_MISSING_BLOCKS = 64;

/**
 * What an import of TEXT answers — Markdown and CSV: {@link composedImportOutcomeSchema}'s members and the one only a
 * composition of text can have. An image import cannot box a character, so its answer cannot say it did.
 */
const textImportOutcomeSchema = z.discriminatedUnion('kind', [
  ...composedImportOutcomeSchema.options,
  /**
   * Opened, and some characters are drawn as the missing-character box because no face carries them — NAMED, never
   * left for the person to find (the owner's answer to Q4). Every other character is drawn, and a box copies as the
   * character it stands for.
   */
  openedSchema.extend({
    kind: z.literal('opened-with-boxes'),
    boxed: z.array(boxedCharacterSchema).min(1).max(MAX_BOXED_CHARACTERS),
    /** Places past the named ones, COUNTED, `opened-incomplete`'s rule. */
    more: z.number().int().min(0),
  }),
]);

/**
 * What an Office import answers
 * ([ADR-0120](../../../docs/DECISIONS/0120-office-import-is-onlyoffices-x2t-contained.md)).
 *
 * {@link composedImportOutcomeSchema}'s members from the same named schemas, with the one a
 * converter has in place of the compose host's: nothing is composed, so no reason or line can
 * be named — the converter produced no PDF, and its own words go to the shell log.
 */
const officeImportOutcomeSchema = z.discriminatedUnion('kind', [
  ...openOutcomeSchema.options,
  /**
   * Opened, and some of the workbook could not be converted — NAMED, never lost in silence (decision C). A block is a
   * sheet and its first and last row that the converter could not convert even in smaller parts: past its 1,500-page
   * cut-off in a print area this build cannot narrow, or failing at every size it was tried. Every other row of every
   * visible sheet is in the document.
   */
  openedSchema.extend({
    kind: z.literal('opened-incomplete'),
    missing: z
      .array(
        z
          .object({
            sheet: z.string().max(MAX_WORKBOOK_SHEET_NAME),
            from: z.number().int().min(1).max(MAX_WORKBOOK_ROW),
            to: z.number().int().min(1).max(MAX_WORKBOOK_ROW),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_OFFICE_MISSING_BLOCKS),
    /**
     * Blocks past the named ones, COUNTED: the document opened, so a workbook with more blocks missing than a dialog
     * names is told how many rather than refused (table A row 12). Each is in the shell log.
     */
    more: z.number().int().min(0),
  }),
  importTooLargeSchema,
  importUnreadableSchema,
  /** The converter produced no PDF from the file. Nothing was written. */
  z.object({ kind: z.literal('conversion-failed') }),
  importContestedSchema,
  importWriteFailedSchema,
]);

/**
 * Pictures taken with the camera, as they cross from the renderer.
 *
 * ## The one channel whose params carry picture bytes, and why that is lawful
 *
 * Every other image path keeps the picture out of the renderer, because `main` can pick
 * the file itself. A camera frame cannot be picked: it exists first in the renderer, where
 * the one permission this application is granted — `media` (§2) — is exercised. Invariant
 * 2 forbids a path and document bytes; a photograph just taken is neither.
 *
 * ## What a compromised renderer can do with it, and why that is bounded
 *
 * Each frame must begin with JPEG's `FF D8` signature and is never decoded in `main`:
 * `main` writes it into the compose host's area, where `embedJpg` reads its header in a
 * contained process (ADR-0060). The set is bounded exactly as a picked set of images is,
 * by count and by total bytes, so the payload scales with the camera, never the document.
 *
 * **Declared ONCE** and taken by the capture dialog's own result schema, so the dialog
 * cannot answer what the channel refuses.
 */
export const capturedFramesSchema = z
  .array(
    z.custom<Uint8Array>(
      (value) =>
        value instanceof Uint8Array &&
        value.byteLength >= 3 &&
        value.byteLength <= MAX_IMAGE_BYTES &&
        value[0] === 0xff &&
        value[1] === 0xd8,
      { message: `not a JPEG of at most ${String(MAX_IMAGE_BYTES)} bytes` },
    ),
  )
  .min(1)
  .max(MAX_IMPORT_IMAGES)
  .refine((frames) => frames.reduce((total, frame) => total + frame.byteLength, 0) <= MAX_IMPORT_IMAGE_BYTES, {
    message: `pictures totalling more than ${String(MAX_IMPORT_IMAGE_BYTES)} bytes`,
  });

/**
 * What an import of several images answers: every single-file import outcome, and the
 * two bounds only a set of files has.
 *
 * The per-file byte bound is `too-large` with {@link MAX_IMAGE_BYTES}, as inserting one
 * image answers. The set's own bounds are separate members, because *that file is
 * larger than 64 MB* and *those files together are larger than 256 MB* are different
 * sentences with different remedies.
 */
const imageImportOutcomeSchema = z.discriminatedUnion('kind', [
  ...composedImportOutcomeSchema.options,
  /** More files were picked than one import takes. Nothing was read. */
  z.object({ kind: z.literal('too-many-images'), limit: z.number().int().positive() }),
  /** The picked files together are past the import's byte bound. Nothing was read. */
  z.object({ kind: z.literal('images-too-large'), limitBytes: z.number().int().positive() }),
]);

/**
 * The native components a build runs, by the id the manifest, the shell's resolver and the Components dialog share
 * ([ADR-0122](../../../docs/DECISIONS/0122-native-components-one-resolver-a-pinned-manifest-status-and-verify.md)).
 */
export const NATIVE_COMPONENT_IDS = [
  'pdfium',
  'poppler',
  'ghostscript',
  'onlyoffice',
  'mupdf-shim',
  'ocr-models',
  'fonts',
] as const;
export type NativeComponentId = (typeof NATIVE_COMPONENT_IDS)[number];

export const channels = {
  'app.info': channel(
    'Version and install channel of the running application.',
    z.object({}),
    z.object({
      /**
       * The running application's version.
       *
       * Bounded because every string that crosses is: this one comes from
       * `package.json` rather than from a document, so it was never an L11
       * hazard — and *this particular string cannot be large* is an argument
       * about today's caller, which is the shape the sweep in
       * `payloadBounds.test.ts` exists to stop accepting. 64 is far above any
       * version this project can have and far below anything worth carrying.
       */
      version: z.string().min(1).max(64),
      /**
       * Baked at build time (E4). Exactly one update provider is active, and
       * the Store build must never self-update, so this is a property of the
       * artifact rather than something detected at runtime.
       */
      installChannel: z.enum(['store', 'web', 'development']),
      /**
       * The signed-in Windows user's name, which an empty *Your name for comments* stands for
       * (ADR-0103 Decision 2). `main` reads it from the operating system; the renderer has no other
       * route to it. Bounded by the author bound, since it is written into `/T` as it is.
       */
      userName: annotationAuthorSchema,
    }),
  ),

  /**
   * The native components this build runs, each with its version and state
   * ([ADR-0122](../../../docs/DECISIONS/0122-native-components-one-resolver-a-pinned-manifest-status-and-verify.md)).
   *
   * `verify: false` answers from what is present — cheap, and what the dialog opens with; `verify: true` re-hashes
   * every file against the manifest, which is what *Verify* asks. The counts say what was found, and the renderer
   * words them: `missing` files the manifest names and the folder lacks, `altered` ones whose bytes differ, and
   * `extra` files a packaged folder holds that nobody pinned (a DLL beside a program is one Windows loads).
   */
  'app.components': channel(
    'The native components this build runs, their versions and whether their files match the manifest.',
    z.object({ verify: z.boolean() }).strict(),
    z.object({
      components: z
        .array(
          z
            .object({
              id: z.enum(NATIVE_COMPONENT_IDS),
              /** From the manifest; bounded as every crossing string is. */
              name: z.string().min(1).max(80),
              version: z.string().min(1).max(64),
              state: z.enum(['present', 'verified', 'absent', 'changed']),
              missing: z.number().int().nonnegative(),
              altered: z.number().int().nonnegative(),
              extra: z.number().int().nonnegative(),
            })
            .strict(),
        )
        .max(NATIVE_COMPONENT_IDS.length),
    }),
  ),

  /**
   * Which OCR models this machine has provisioned.
   *
   * ## A PROPERTY OF THE INSTALLATION, which is why it sits beside `app.info`
   *
   * Not of a document and not of a session. `scripts/provision/tessdata.mjs`
   * downloads fourteen models and CI provisions **`eng` alone**, so *this build
   * declares fourteen languages* and *this machine can recognise in them* are
   * different facts — and a surface that offered all fourteen from the first
   * would let a reader choose a model the recognition then fails on, which is the
   * wired-tools defect wearing a dropdown.
   *
   * ## An empty list is a STATE, not an error
   *
   * `settings.loadSecrets`' `available: false` one feature along: a machine with
   * no models installed is the `no-binary` state §10.5 requires every surface to
   * design, and the OCR dialog is where it is said. Declaring a failure code for
   * it would make *nothing is installed* something the renderer handles as a
   * refusal rather than as the answer.
   *
   * ## The renderer cannot derive it
   *
   * There is no path here by invariant L2 and no directory to list, which is the
   * point rather than an inconvenience. Main answers the question it is the only
   * one able to answer, and the order is `OCR_LANGUAGES`' own so a surface does
   * not reorder itself because of the sequence a download finished in.
   */
  'app.ocrLanguages': channel(
    'Which OCR models this machine has provisioned.',
    z.object({}),
    z.object({
      // BOUNDED BY THE DECLARED SET, which is the one bound that cannot go stale:
      // the answer is a subset of a closed enum, so `max` is the enum's own size
      // rather than a number somebody picked.
      languages: z.array(ocrLanguageSchema).max(OCR_LANGUAGES.length),
    }),
  ),

  /**
   * Applies one command to an open document.
   *
   * **This is not a document-carrying channel**, and saying so is the L11 note
   * above being answered rather than skipped. What crosses is *intent*:
   * `{ pages, quarterTurns }` is the same size for a 2-page document and a
   * 20,000-page one, and the array scales with what the user selected, never
   * with the document. The gate the note owes is still owed, by the first
   * channel that carries bytes.
   *
   * **The result is two scalars, and never what the bus produced.** A log entry
   * holds an inverse or a checkpoint — a whole byte image of the document — so
   * returning it would put the document on the wire once per operation, which is
   * exactly what L11 forbids.
   *
   * This said *"the version and nothing else"* until 2026-08-30, and the first
   * real caller found the sentence too wide. The version tells the renderer its
   * view is stale; **rebuilding that view needs the byte length too**, because
   * the renderer drives PDF.js through a `PDFDataRangeTransport` bound to a
   * total size. Rebinding on the version alone binds to whatever length the
   * caller last knew — a range past the end is a `RangeError` the handler
   * reports as `internal`, and one short of it is a parse of a truncated
   * document.
   *
   * **The length does not move yet, and saying so is not a footnote** (finding
   * OOOOO-1). A command's effect lands in the engine session; main's canonical
   * image is `readonly` and stays what was opened, so this answers the same
   * number every time and `document.readRange` serves the pre-command document.
   * ADR-0031's staleness argument — *"answering a stale offset out of the new
   * bytes"* — describes a state this build does not reach. The field is here so
   * that the renderer is not written to rebind on a version alone, which would
   * be wrong the day the refresh lands and wrong invisibly.
   *
   * `document.open` already answers with a byte length for exactly this reason,
   * so **not** answering with one here was the inconsistency rather than the
   * discipline. Both are scalars: they are the same size for a two-page document
   * and a twenty-thousand-page one, which is the L11 test and the only one that
   * matters.
   *
   * All three failure codes are **outcomes, not defects**. A document closes
   * while a command is in flight (`document-not-open`), a runaway caller
   * saturates a lane (`document-busy`), and a document the supervisor has
   * stopped rebuilding an engine session for is refused engine work
   * (`document-poisoned`); the renderer's answer is to drop the result, to back
   * off, or to tell the user this document cannot be edited until it is closed
   * and reopened — none of which is an error report.
   *
   * Note the third is deliberately *the supervisor stopped rebuilding* and not
   * *this document killed the host twice*: the count is not attribution, and
   * ADR-0023's DDDD-17 correction records the case where a document busy at two
   * deaths caused by a third document's bytes reaches the bound having caused
   * neither. Everything else a command can do wrong — an out-of-range page
   * index, an unregistered writer, an engine throw — is a defect, and defects
   * are `internal` with the diagnostic recorded main-side.
   *
   * **Why `document-poisoned` is declared rather than `internal`**
   * ([ADR-0023](../../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
   * Decision 9a). The supervisor **decided** it, after bounding a rebuild loop
   * with a hostile input at the centre of it. Reporting a decision as `internal`
   * would file it as an inconsistency, and the renderer would show an
   * unexplained internal error for the one failure it can actually explain.
   *
   * It is also what stops the ordinary post-crash path arriving wearing an
   * inconsistency's clothes: without it a poisoned document has no session, and
   * a missing session is a defect by name (Decision 9c).
   */
  /**
   * Opens a document, through a picker main owns.
   *
   * ## IT TAKES NO PARAMETERS, AND THAT IS THE INVARIANT RATHER THAN A DEFAULT
   *
   * A string path in a renderer-facing type is a compile error (§2, invariant
   * 1). The obvious signature — the renderer passes a path, or a handle it got
   * from somewhere — reintroduces the thing the whole capability design exists
   * to forbid: a renderer that can name a location can name any location, and
   * the rejected alternative is a runtime allowlist that fails open at every
   * handler which forgets to call it.
   *
   * So the renderer **asks**, and main decides what was asked for. The picker,
   * the path, and the mint are all main's; what comes back is a `DocId` and a
   * `DocVersion`. The renderer cannot express which file it wants, which is why
   * it cannot express the wrong one.
   *
   * ## NOT A DOCUMENT-CARRYING CHANNEL, and the L11 gate above stays owed
   *
   * The note at the top of this file says the first channel that carries bytes
   * owes invariant L11's check. **This is not that channel** — opening a 2 GB
   * PDF and a 20 kB one put exactly the same two identifiers on the wire, and
   * the canonical image never leaves main. Said here rather than left to be
   * inferred, because *a document channel* and *a document-carrying channel*
   * are different things and the gate is owed by the second.
   *
   * ## The result mirrors the kernel's `OpenOutcome`, plus one
   *
   * `opened`, `already-open`, `absent` and `at-capacity` are the kernel's own
   * variants. Restating them as failure codes here would be a second taxonomy
   * for a question `DocumentService` already answers, and the two would drift
   * (B3a) — so the shape is mirrored and the kernel stays the writer of record
   * for what opening produces.
   *
   * `cancelled` is the one variant the kernel cannot have, because the picker
   * is main's and dismissing it never reaches the service. It is an **outcome**:
   * a user closing a dialog is not a failure, and reporting it as one would put
   * an error in front of somebody who changed their mind.
   *
   * `already-open` carries no version, matching ADR-0009 §2 — *render a second
   * copy of an already-open document* is a sentence that cannot be written down
   * rather than a bug to be caught, so the only thing a caller can do with this
   * variant is focus the document that is already there.
   *
   * There are **no declared failure codes**. Every way this can end that a user
   * can cause is above; everything else — a picker that throws, a registry
   * miss, a read fault — is a defect, and defects are `internal` with the
   * diagnostic recorded main-side.
   */
  'document.open': channel(
    'Opens a document chosen in a picker main owns, returning its id and version.',
    z.object({}),
    openOutcomeSchema,
  ),

  /**
   * Fetches a PDF from a web address the user gives, saves it where they choose, and
   * opens it ([ADR-0061](../../../docs/DECISIONS/0061-a-url-a-person-chose-is-fetched-through-one-guard-that-pins-every-resolution.md)).
   *
   * ## THE ASK IS THE ADDRESS, and nothing comes back but outcomes
   *
   * Bounded by `MAX_LINK_URI`, the contract's bound on a URI a person types. Main checks
   * it, runs the save dialog, fetches through the SSRF guard, streams the body into the
   * save pipeline and opens the file through the one open route. No byte of the
   * response crosses.
   *
   * ## A refusal carries its REASON
   *
   * `url-refused` names which of the guard's rules stopped it, from the one list the
   * guard refuses with, because *that address points inside your network* and *that
   * address did not return a PDF* are different sentences with different remedies.
   */
  /**
   * Opens the documents a launch named on its command line — a file association, *Open with*, a PDF dropped on the
   * application's icon — which main has been holding since that launch (`docs/ARCHITECTURE.md` §2: argv and file
   * association are paths main mints, never the page). **The page names nothing**: it asks when it starts, and when
   * `document.opens-waiting` says a later launch named more, and main opens each through the one `openPath` a drop
   * takes, answering an outcome per document in the order given. Asked again with nothing waiting, it answers none.
   */
  'document.openWaiting': channel(
    'Opens the documents a launch named on its command line.',
    z.object({}).strict(),
    z.object({ opened: z.array(openOutcomeSchema).max(MAX_LAUNCH_DOCUMENTS) }),
  ),

  'document.openFromUrl': channel(
    'Fetches a PDF from a web address the user gives, saves it where they choose, and opens it.',
    z.object({ url: z.string().trim().min(1).max(MAX_LINK_URI) }),
    z.discriminatedUnion('kind', [
      ...openOutcomeSchema.options,
      /** The guard refused the address, a redirect, or the answer. Nothing was written. */
      z.object({ kind: z.literal('url-refused'), reason: z.enum(URL_FETCH_REFUSALS) }),
      /** Another open document reaches the chosen destination. Nothing was fetched. */
      z.object({ kind: z.literal('destination-contested'), openElsewhere: z.number().int().positive() }),
      /** The filesystem refused. Nothing at the destination was replaced. */
      z.object({ kind: z.literal('write-failed') }),
    ]),
  ),

  /**
   * Where each cloud provider stands on this machine (ADR-0091): not configured in this build,
   * signed out, or signed in. Never a token, an account or a client value.
   */
  'cloud.status': channel(
    'Which cloud providers this build carries, and which are signed in.',
    z.object({}).strict(),
    z.object({
      providers: z
        .array(z.object({ provider: cloudProviderSchema, state: cloudStateSchema }).strict())
        .max(CLOUD_PROVIDER_IDS.length),
    }),
  ),

  /** Signs in to a provider in the person's own browser (ADR-0059's loopback route). */
  'cloud.signIn': channel(
    'Signs in to a cloud provider through the person’s browser.',
    z.object({ provider: cloudProviderSchema }).strict(),
    cloudDoneSchema,
  ),

  /** Forgets a provider's sign-in on this machine. Nothing in the cloud changes. */
  'cloud.signOut': channel(
    'Forgets a cloud provider’s sign-in on this machine.',
    z.object({ provider: cloudProviderSchema }).strict(),
    z.object({ state: cloudStateSchema }),
  ),

  /** A page of the person's PDFs in one provider, newest first. */
  'cloud.list': channel(
    'Lists the PDFs a cloud provider holds for the signed-in person.',
    z.object({ provider: cloudProviderSchema }).strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('listed'), files: z.array(cloudFileSchema).max(MAX_CLOUD_FILES) }),
      z.object({ kind: z.literal('refused'), reason: z.enum(CLOUD_REFUSALS) }),
    ]),
  ),

  /**
   * Opens a cloud file: downloads it into a working copy in this application's own data directory
   * and opens that through the one way a document opens (ADR-0091 Decision 6).
   */
  'cloud.open': channel(
    'Downloads a cloud PDF into a working copy and opens it.',
    z.object({ provider: cloudProviderSchema, fileId: z.string().min(1).max(MAX_CLOUD_FILE_ID) }).strict(),
    z.discriminatedUnion('kind', [
      ...openOutcomeSchema.options,
      z.object({ kind: z.literal('refused'), reason: z.enum(CLOUD_REFUSALS) }),
    ]),
  ),

  /**
   * Opens the file a person chooses in the provider's own Picker — Google's desktop Picker, which is the loopback
   * sign-in with two parameters more (ADR-0091, corrected 2026-09-29). The file's id comes back in the redirect and
   * never crosses this channel; the answer is `cloud.open`'s, and a Picker that returned nothing is `nothing-picked`.
   */
  'cloud.pick': channel(
    'Opens the file a person chooses in the provider’s Picker.',
    z.object({ provider: cloudPickerProviderSchema }).strict(),
    z.discriminatedUnion('kind', [
      ...openOutcomeSchema.options,
      z.object({ kind: z.literal('refused'), reason: z.enum(CLOUD_REFUSALS) }),
    ]),
  ),

  /**
   * Saves a document opened from the cloud and uploads it back to its file — refused by name when
   * the cloud file changed since it was opened, rather than overwriting it.
   *
   * ## Every answer that saved names the version it saved, as `document.save`'s does
   *
   * The working copy is saved FIRST, so two answers leave it saved: sent, and refused on the way
   * out. Both carry the version written, because that is what the renderer compares its own
   * version against to say whether the document has unsaved changes — an answer that saved and
   * named no version left the tab reading dirty while `document.unsaved` read clean. The two that
   * saved nothing carry none, so a renderer cannot mark those saved by construction.
   */
  'cloud.saveBack': channel(
    'Saves a document and uploads it back to the cloud file it was opened from.',
    z.object({ docId: docIdSchema }).strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('saved-back'), version: docVersionSchema }),
      /** The document did not come from the cloud, and was not put there this session. */
      z.object({ kind: z.literal('not-from-cloud') }),
      /** Saving to the working copy failed, so nothing was sent. */
      z.object({ kind: z.literal('save-failed') }),
      /** Saved to the working copy at `version`; sending it to the cloud was refused. */
      z.object({ kind: z.literal('refused'), reason: z.enum(CLOUD_REFUSALS), version: docVersionSchema }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Whether an open document came from the cloud and whether this person may change the file there, as the provider
   * said when it was opened. `canEdit` is `null` where the provider did not say — unknown, never yes — so a surface says
   * read-only only for `false`.
   */
  'cloud.access': channel(
    'Whether a document came from the cloud, and whether its file there may be changed.',
    z.object({ docId: docIdSchema }).strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('not-from-cloud') }),
      z.object({ kind: z.literal('from-cloud'), provider: cloudProviderSchema, canEdit: z.boolean().nullable() }),
    ]),
  ),

  /** Puts a copy of a document in a provider's storage, and links the document to it. */
  'cloud.uploadCopy': channel(
    'Uploads a copy of a document to a cloud provider.',
    z.object({ docId: docIdSchema, provider: cloudProviderSchema }).strict(),
    cloudDoneSchema,
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * The documents this user opened recently, and whether the last run finished.
   *
   * ## A HANDLE PER ENTRY, never a path
   *
   * A recent-files list is a list of paths, and the renderer holds none
   * (invariant L2). What crosses is a `FileHandle` — the capability the
   * registry already mints for an open document, which a renderer may name and
   * cannot read — with the file's name beside it for the label. So this list is
   * exactly as much as a renderer needs to offer a document and no more.
   *
   * The handle is what `document.openRecent` takes, which is what makes the
   * pair honest: nothing here lets a renderer name a file main did not already
   * record.
   *
   * ## `lastExitClean` rides along, and that is not two channels squashed
   *
   * The crash-recovery offer is *this list* plus *did the last run finish*, and
   * neither half is useful alone: a marker saying the last run died tells the
   * renderer nothing to do about it, and a list says nothing about whether to
   * offer one. A surface asking one question gets one answer.
   */
  'document.recent': channel(
    'The documents opened recently, and whether the previous run exited cleanly.',
    z.object({}),
    z.object({
      entries: z
        .array(
          z.object({
            handle: fileHandleSchema,
            name: z.string().max(MAX_DOCUMENT_NAME_LENGTH),
            /** Where it is, for display only (ADR-0100). */
            location: displayLocationSchema,
            /**
             * When it was last opened HERE — not the file's modification time — or `null` for an entry an
             * older build recorded without one.
             */
            openedAt: annotationInstantSchema.nullable(),
            /**
             * Whether the file is there NOW, read by main as the list is asked for — by `readFileIdentity`, the rule
             * an open answers `absent` by, so the list and the open agree (ADR-0143). `unavailable` is listed and
             * drawn disabled, never dropped: a file on a drive that is not connected is back when the drive is.
             * `checking` is a file whose check had not answered when the list was due (`RECENT_CHECK_CAP_MS`), so the
             * list shows at once and a view asks again until it resolves.
             */
            availability: recentAvailabilitySchema,
          }),
        )
        .max(MAX_RECENT_ENTRIES)
        .readonly(),
      /**
       * `false` when the previous run did not reach its shutdown.
       *
       * **True on a first launch**, which is the honest reading: there is no
       * previous run that failed to finish, and a first launch offering to
       * recover from a crash that never happened is worse than one that says
       * nothing.
       */
      lastExitClean: z.boolean(),
      /**
       * What was open when the previous run ended, newest last.
       *
       * ## It is RECORDED, not inferred, and tabs are why
       *
       * With one document on screen the newest recent entry *was* what was
       * open, and the offer named it. Multi-document tabs ended that
       * correspondence: a reader with three documents open who loses the
       * application would be offered the last file they touched and told
       * nothing about the other two.
       *
       * Kept after a clean exit too (since 2026-09-28): after a clean one it is
       * what `viewing.restore-session` reopens, and after an unclean one it is
       * *the offer*. `lastExitClean` says which — so a renderer never reads this
       * alone. The two are separate because an unclean exit with nothing
       * recorded is a real state: a run that died before opening anything.
       */
      lastSession: z
        .array(
          z.object({
            handle: fileHandleSchema,
            name: z.string().max(MAX_DOCUMENT_NAME_LENGTH),
            /** The list's own reading, so the offer after a crash names no file that has gone. */
            availability: recentAvailabilitySchema,
          }),
        )
        .max(MAX_SESSION_ENTRIES)
        .readonly(),
    }),
  ),

  /**
   * Opens a document from the recent list, by the handle that list carried.
   *
   * ## Why not a parameter on `document.open`
   *
   * `document.open` takes NO parameters, and that is its invariant: main picks,
   * main mints, the kernel opens, so *"opened the wrong file"* is not a state a
   * renderer can steer into. Adding an optional handle to it would end that
   * sentence for every caller in order to serve one.
   *
   * Here the renderer does name a file, and what makes that safe is where the
   * name came from: a handle main minted for a document main recorded. The
   * registry resolves it or refuses; a renderer cannot construct one, because
   * the value is a minted token rather than a path in a coat.
   *
   * The outcomes are `document.open`'s, including `cancelled` — which this can
   * never answer, and which is present because the two channels share a result
   * type on purpose. A renderer handling one handles the other.
   */
  /**
   * One password attempt against an open document that is encrypted
   * ([ADR-0055](../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)).
   *
   * ## IT TAKES A `DocId`, and the document is ALREADY OPEN
   *
   * That reads backwards until the sequence is on the page. `document.open`
   * answers before any engine session exists — `onDocumentOpened` queues the
   * session into the document's lane and nothing awaits it, because *a document
   * opens whether or not an engine is available* — so at the moment opening
   * answers, nothing here has parsed the file and nothing can know it is
   * encrypted. An outcome on `document.open` would be an answer to a question
   * asked one step too early, and ADR-0055's Decision 4 said exactly that
   * before its own correction.
   *
   * So the document opens, the supervisor records it as **locked** rather than
   * poisoning it — an encrypted file is neither evidence about the host nor a
   * document that will never parse — and this channel is how a person's answer
   * gets to the engine.
   *
   * ## The RENDERER may hold the password, and that is not a widening
   *
   * The user types it there, and PDF.js needs it to draw a page. What the
   * renderer must never do is put it anywhere a version bump would carry it —
   * not in a store, not in a recent-files entry, not in a setting. Main holds
   * it for the length of one call and nothing records it, which is why
   * `recycle` refuses on an unlocked document rather than rebuilding a session
   * that cannot read it.
   *
   * ## `wrong-password` is an OUTCOME
   *
   * A person mistyping is not a defect and must not arrive wearing an incident
   * id. The document stays locked and stays open, so the next attempt is
   * another call rather than a reopen.
   *
   * `not-locked` covers both a document that never needed a password and one an
   * earlier call already unlocked — the two are the same fact from here, which
   * is *there is nothing for this password to do*.
   */
  'document.unlock': channel(
    'Tries one password against an open encrypted document.',
    z.object({
      docId: docIdSchema,
      password: z.string().max(DOCUMENT_PASSWORD_MAX_CHARS),
    }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('unlocked'),
        /**
         * What the password bought — `1` unencrypted, `2` user, `4` owner, `6`
         * both.
         *
         * The engine answers this precisely and Stage 7's permission rows turn
         * on it, so it is carried rather than collapsed to a boolean here and
         * re-derived there (B3a). A renderer that only wants *did it work* reads
         * the variant.
         */
        // DERIVED from the one declaration rather than respelt. `z.literal`
        // takes the whole set in zod 4, so there is no tuple to cast and no
        // second list to fall behind: a value the seam gains is a value this
        // channel accepts, in the same edit.
        access: z.literal(DOCUMENT_ACCESS_VALUES),
      }),
      z.object({ kind: z.literal('wrong-password') }),
      z.object({ kind: z.literal('not-locked') }),
    ]),
    ['document-not-open'],
  ),

  /**
   * A recent file's picture of its first page, by the handle the list carried (ADR-0100).
   *
   * **It never parses a file.** The picture was made when the document was last open here, and this reads
   * it back or answers `none` — for an entry that never had one, one whose capture failed, or when the
   * Privacy setting is off. A handle the list did not mint answers `none` too: this channel has nothing to
   * say about a file that is not on the list.
   */
  'document.recentPreview': channel(
    'The picture of a recent file’s first page, kept from when it was last open.',
    z.object({ handle: fileHandleSchema }).strict(),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('picture'),
        jpeg: z.instanceof(Uint8Array).refine((bytes) => bytes.length <= MAX_RECENT_PREVIEW_BYTES),
      }),
      z.object({ kind: z.literal('none') }),
    ]),
  ),

  /**
   * Empties the recent list, and deletes every picture with it (ADR-0100). Answers how many entries went.
   */
  'document.clearRecent': channel(
    'Empties the recent list and deletes the pictures kept for it.',
    z.object({}).strict(),
    z.object({ cleared: z.number().int().nonnegative().max(MAX_RECENT_ENTRIES) }),
  ),

  'document.openRecent': channel(
    'Opens a document the recent list named, by its handle.',
    z.object({ handle: fileHandleSchema }),
    openOutcomeSchema,
    // `unknown-handle` rather than `internal`: a handle can be stale — the
    // registry is per-run and a renderer may hold a list from before a restart —
    // and that is an outcome a surface acts on by refreshing the list, not a
    // defect with an incident id.
    ['unknown-handle'],
  ),

  /**
   * Closes an open document, releasing its bytes, its session and its handle.
   *
   * ## Why this channel did not exist until multi-document tabs
   *
   * With one document on screen, opening the next one is what ended the last,
   * and `DocumentService` was doing the closing. Tabs make *close* something a
   * reader does on purpose to one of several — and without it a session's tab
   * could vanish from the strip while main went on holding its bytes against
   * the capacity ceiling that `at-capacity` reports.
   *
   * ## It answers a BOOLEAN rather than refusing an unopened document
   *
   * `closed: false` means *there was nothing here*, which is the honest answer
   * to a close that raced a close: two tabs' worth of teardown for one document
   * is a thing a surface can produce and not a defect it should report. A code
   * would make the second caller show an error for having been second.
   *
   * ## It declares NO codes, and `document-busy` was written here and removed
   *
   * `DocumentService.close` removes the record synchronously and then **awaits
   * the lane**, so work in flight delays the teardown rather than refusing it.
   * There is no busy refusal to report. Declaring one would have put a code in
   * the result union that nothing can ever produce — the shape of a bound a
   * reader had already clamped to, a branch that reads as coverage and cannot
   * fire — and a renderer would carry a handler for it forever.
   */
  'document.close': channel(
    'Closes an open document and releases what main held for it.',
    z.object({ docId: docIdSchema }),
    z.object({
      /** Whether a document was there to close. */
      closed: z.boolean(),
    }),
  ),

  /**
   * Whether an open document holds changes its file does not — asked before every close.
   *
   * ## A query in the document's LANE, which is why it is a channel and not a field
   *
   * `DocumentContext.isDirty` explains why there is no service-level answer: read outside the
   * lane it can race a command that bumps, and the stale answer is **clean**, which closes
   * without asking and loses work. So the renderer's one close path asks here, per document,
   * immediately before it decides, rather than tracking a flag of its own that would be a
   * second opinion about what main holds (B3a).
   *
   * **Conservative, `isDirty`'s trade**: an undo back to the saved content still answers
   * `true`. It fails towards a question nobody needed, never towards a lost edit.
   *
   * `document-not-open` is declared because a tab can outlive its document by a moment — a
   * second close of the same tab — and that is an answer (nothing to lose), not a defect.
   */
  'document.unsaved': channel(
    'Answers whether an open document has changes its file does not.',
    z.object({ docId: docIdSchema }),
    z.object({ unsaved: z.boolean() }),
    ['document-not-open', 'document-busy'],
  ),

  'document.execute': channel(
    'Applies one command to an open document, returning the version it produced.',
    // THE RENDERABLE SUBSET, not the whole union. `insertImagePage` carries an
    // image main reads from a picked file, so the one channel a renderer could
    // put a command on refuses it at the boundary — the capability is
    // unrepresentable rather than merely unused. See `commands.ts`.
    z.object({
      docId: docIdSchema,
      command: renderableCommandSchema,
      /**
       * That the person agreed this edit may break the document's signatures
       * ([ADR-0149](../../../docs/DECISIONS/0149-a-signature-is-appended-and-an-edit-that-breaks-one-is-asked-first.md)).
       *
       * **Optional, and absent is the direction that asks.** Elsewhere this contract makes a field required so a
       * caller cannot satisfy it by not reading it; here not sending it gets the question, never a broken signature,
       * so forgetting it is safe and only the answer to that question sends `true`.
       */
      breakSignatures: z.boolean().optional(),
    }),
    z.object({
      version: docVersionSchema,
      byteLength: z.number().int().nonnegative(),
      /**
       * Undo steps the command cost, because the checkpoint budget was reached
       * (§4, invariant 18).
       *
       * **Required, and `0` rather than an absent field.** A silently shortened
       * history is work quietly becoming unrecoverable, which is the thing
       * invariant 18 exists to forbid — and an optional field is one a renderer
       * satisfies by not reading it. Making the ordinary answer a number the
       * caller must still handle is B5 over a rule nobody would enforce.
       *
       * A COUNT and not the bytes: what the user lost is undo steps, and a
       * figure in megabytes answers a question they did not ask.
       */
      historyDropped: z.number().int().nonnegative(),
      /**
       * The characters the command drew as the missing-character box, each with its page, and how many more past
       * the named ones ([ADR-0174](../../../docs/DECISIONS/0174-a-pdfium-apply-answers-the-characters-it-drew-as-boxes.md)).
       * REQUIRED and empty when there is none, `historyDropped`'s reason: the person is owed them.
       */
      ...drawnBoxesShape,
    }),
    // `stale-target` IS ON THIS CHANNEL ALONE, because a command is the only
    // thing that names existing state (ADR-0041 Decision 2). A read answers with
    // whatever is there now and cannot be stale; the version it carries is what
    // lets a caller notice, not something it can get wrong.
    // `engine-unavailable` IS A PROPERTY OF THE MACHINE rather than of the
    // document: PDFium backs the editing commands, it is provisioned separately,
    // and a user whose installation has none deserves that sentence rather than
    // `internal` and an incident id for a build working exactly as assembled.
    //
    // This comment said *on this channel alone* when the code arrived, reasoning
    // that a command is routed to a writer of record and a read is not. That
    // clause lasted one commit: `document.textLines` is a read answered by the
    // same engine, so it declares the code too. The reason above is the half
    // that was load-bearing; the exclusivity was an observation about which
    // channels existed that day.
    // THE SERVICE CODES are a region recognition's, the one command whose pre-read crosses the
    // internet; `SERVICE_PROBLEMS` says why they are codes rather than a sentence.
    // `text-not-writable` IS AN IN-PLACE EDIT'S (ADR-0096): the page's font cannot carry what
    // was typed. It is the PERSON's to act on — type something else, or edit another way — so
    // it is a sentence and never `internal` with an incident id for a document working as made.
    // `breaks-signatures` IS A QUESTION, NOT A FAULT (ADR-0149): the edit would rewrite a signed document whole, and
    // nothing has changed. The dispatcher asks the person and sends the command again, agreed, or works on a copy.
    // `text-not-in-place` IS `replaceTextAt`'s (ADR-0156): no single text object holds the word at that point, so it
    // was not replaced there. The person's to act on, by editing the line, for `text-not-writable`'s reason.
    // `edit-refused` IS A PDFIUM REWRITE'S (ADR-0169): a native step refused, or the saved page read back without text
    // the edit did not touch, and nothing was saved. It carries the step and the number PDFium answered.
    // `nothing-to-replace` IS A REPLACEMENT'S (ADR-0169 Decision 6): it matched nothing a text object holds, or changed
    // nothing, so there is no new version. The person's to read, for `text-not-in-place`'s reason.
    // `replace-moves-line` IS A REPLACEMENT'S TOO: it would change its text's width with more text after it on the line,
    // which only an edit that knows the line can move, so nothing was written. The person's, for the same reason.
    [
      'document-not-open',
      'document-busy',
      'document-poisoned',
      'stale-target',
      'engine-unavailable',
      'text-not-writable',
      'text-not-in-place',
      'nothing-to-replace',
      'replace-moves-line',
      'edit-refused',
      'breaks-signatures',
      ...SERVICE_PROBLEMS,
    ],
  ),

  /**
   * Steps one entry back in a document's command log.
   *
   * ## The request carries a `DocId` AND NOTHING ELSE, which is the invariant
   *
   * [ADR-0009](../../../docs/DECISIONS/0009-document-identity-and-the-command-log.md)
   * §3a: *"inverses stay kernel-only: they carry structural prior state the
   * renderer must not see, and a renderer-supplied inverse would let the UI
   * dictate undo."* Both halves of that sentence are load-bearing here. The
   * prior state is structural — a page's `/Rotate` may have been **absent**,
   * and restoring it means deleting the key rather than rotating back — so an
   * inverse is not something a renderer could compute even if it were allowed
   * to. Folding undo into {@link commandSchema} would put one on the wire.
   *
   * So the renderer says *undo this document* and the kernel decides what that
   * means. The same shape `document.open` has, for the same reason: a request
   * that carries no choice is one the caller cannot get wrong.
   *
   * ## `nothing-to-undo` is an OUTCOME, and that is not politeness
   *
   * An empty log is a state a user reaches by undoing to the start, and it is
   * the state every document is in at open. A failure code would make the
   * ordinary end of undoing indistinguishable from a defect, and the renderer's
   * answer to it — leave the button alone — is not the answer to a defect.
   *
   * A **terminal** entry used to be a declared failure here,
   * `checkpoint-restore-not-built`, and is now an ordinary `undone`: the bus
   * restores that entry's own checkpoint through the session supervisor
   * ([ADR-0037](../../../docs/DECISIONS/0037-checkpoint-restore-and-the-replay-that-is-not-needed.md)).
   * The code is **removed rather than left declared**, because a code nothing
   * can mint is a branch the renderer must handle, a message a translator must
   * translate, and a dialog case a reader takes as evidence the state is
   * reachable.
   */
  'document.undo': channel(
    'Steps one entry back in an open document’s command log.',
    z.object({ docId: docIdSchema }),
    z.discriminatedUnion('kind', [
      // Carries the byte length for the same reason `document.execute` does:
      // an undo is an applied mutation, it rewrites the canonical image, and a
      // renderer rebinding its transport on the version alone binds to the
      // image the undo replaced.
      z.object({
        kind: z.literal('undone'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
      }),
      // `nothing-to-undo` carries neither, and that is not an omission: nothing
      // moved, so the renderer's view is not stale and there is nothing to
      // rebind. A version here would invite a caller to reopen for no reason.
      z.object({ kind: z.literal('nothing-to-undo') }),
    ]),
    // `edit-refused` AND `text-not-writable` because an undo of a PDFium edit runs the same rewrite, read back the
    // same way (ADR-0169), so it is refused the same way and says the same sentence.
    ['document-not-open', 'document-busy', 'document-poisoned', 'edit-refused', 'text-not-writable'],
  ),
  /**
   * Steps one entry forward over what undo stepped back — {@link 'document.undo'}'s other half.
   *
   * **A `DocId` and nothing else, for undo's reason**: the kernel decides what to re-apply from the
   * log, by the entry's own §3a declaration — re-running its intent, or re-installing the effect it
   * kept — and a renderer that named what to redo could dictate it.
   *
   * The kernel had `CommandBus.redo` from Stage 0 and nothing reached it until 2026-09-24: no channel,
   * no control, no chord. The placement audit found it as Home › History holding Undo alone, which the
   * owner's design draws beside Redo.
   *
   * `nothing-to-redo` is an outcome for undo's reason too: it is where every document starts, and
   * where a new command leaves one, since a command truncates the redo tail.
   */
  'document.redo': channel(
    'Steps one entry forward in an open document’s command log.',
    z.object({ docId: docIdSchema }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('redone'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
      }),
      z.object({ kind: z.literal('nothing-to-redo') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned', 'edit-refused', 'text-not-writable'],
  ),
  /**
   * Save, and every part of its shape is invariant 18 or ADR-0009 §9.
   *
   * ## The request carries a `DocId` and nothing else
   *
   * Same reason as {@link 'document.undo'} and `document.open`: the destination
   * is the file the document was opened from, which main already holds as a
   * `FileHandle`. A renderer-supplied path would be a path in a renderer-facing
   * type, which is a compile error here by design — and *Save As* is a
   * different question with its own check, not a parameter on this one.
   *
   * ## THREE RESULTS RATHER THAN ONE SUCCESS AND TWO FAILURE CODES
   *
   * `refused` and `write-failed` are **outcomes**, not defects, and the
   * distinction is the whole of invariant 18: *"never by a dialog whose only
   * option discards their edits"*. In both, the document is intact, still
   * dirty, and its command log is untouched — so the renderer's response is to
   * say what happened and leave the work alone. A failure code would put them
   * in the same bucket as an inconsistency the user cannot act on.
   *
   * ## `reason` is the verdict's kind and NOT its contents
   *
   * `WriteTargetVerdict` carries more than this — `contested` names the other
   * open documents, `unverifiable` names which of three reads was missing. None
   * of it crosses, because nothing consumes it: a field shipped with no reader
   * is a declared state nobody can produce a use for, which is the shape that
   * accumulates. It widens when a renderer has something to do with it.
   *
   * `sole-writer` is absent from the enum on purpose — it is the verdict that
   * PERMITS the write, so it cannot be a refusal reason. That is a state made
   * unrepresentable rather than a case nobody writes.
   */
  /**
   * Tries again to delete the older copies of this document that still hold what a removal took out (CR-DOC-10, the
   * owner's decision of 2026-10-03): the ones a save could not delete because another program held them. Main deletes
   * only the copies it recorded as owed, and only while each is still the file it made (ADR-0139), so nothing the
   * renderer names is deleted: the request carries the document and nothing else.
   */
  'document.deleteHeldCopies': channel(
    'Deletes the older copies of a document that a save could not delete, if nothing holds them now.',
    z.object({ docId: docIdSchema }).strict(),
    z.object({ held: heldCopiesSchema }),
    ['document-not-open', 'document-busy'],
  ),

  'document.save': channel(
    'Writes an open document’s current content to the file it was opened from.',
    z.object({
      docId: docIdSchema,
      /**
       * Whether this save may break the document's signatures (Part F's warning, `BUILD-PROMPT.md`:618). REQUIRED,
       * so every caller decides: `false` asks main to answer `breaks-signatures` instead of writing, `true` is a person
       * who has been told and agreed — or who turned the warning off.
       */
      breakSignatures: z.boolean(),
    }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('saved'),
        version: docVersionSchema,
        /**
         * Where the save was a removal's — it wrote no backup — what it deleted that may still have held what was
         * removed, and the files with a backup's name it kept because Monstera did not make them (ADR-0139). `null`
         * for every other save.
         */
        cleared: clearedCopiesSchema.nullable(),
        /**
         * The older copies of this document that still hold what a removal took out, by name, because another program
         * held them when they were to be deleted (CR-DOC-10). Owed, kept in main across a restart, and tried again by
         * every save of the document and by `document.deleteHeldCopies`. Empty when there is none. No path crosses.
         */
        held: heldCopiesSchema,
      }),
      /**
       * NOTHING WAS WRITTEN: the save would rewrite the file and so break this many signatures — a removal or a change
       * of protection is pending, or the file cannot be appended to. Asked with `breakSignatures: false` only.
       */
      // A COUNT, for the warning's sentence: bounded at MAX_SIGNATURES, the panel's list, a save of a document with more
      // signatures than a panel draws failed instead of warning (table A row 14).
      z.object({ kind: z.literal('breaks-signatures'), signatures: z.number().int().positive() }),
      z.object({
        kind: z.literal('refused'),
        reason: z.enum(['contested', 'replaced', 'target-absent', 'unverifiable']),
      }),
      /** The filesystem refused, and why, so the person is told the remedy that fits (cloud-4 7b). */
      z.object({ kind: z.literal('write-failed'), cause: z.enum(SAVE_WRITE_CAUSES) }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Whether an open document's own file could be written over NOW (cloud-4 7b): asked when a person has opened it, so
   * a file that is read-only, or held by another program, is said before any edit rather than at the first Save.
   *
   * Asked of the file at each call and never kept, because the answer changes under the document. It is something to
   * tell a person and never a reason to refuse a save, which tries the file itself. No path crosses.
   */
  /**
   * Which of two open documents' files was written later (cloud-4 8a): what Compare asks so the newer file goes on the
   * right, where the summary's *inserted* and *removed* read as what changed since the older. An answer, never a time.
   */
  'document.newerOf': channel(
    'Answers which of two open documents’ files was written later.',
    z.object({ first: docIdSchema, second: docIdSchema }).strict(),
    z.object({ newer: z.enum(['first', 'second', 'neither']) }),
    ['document-not-open'],
  ),

  'document.fileAccess': channel(
    'Answers whether an open document’s own file could be written over now.',
    z.object({ docId: docIdSchema }).strict(),
    z.object({ access: z.enum(FILE_ACCESS) }),
    ['document-not-open'],
  ),

  /**
   * Writes a copy of an open document to a destination the **user** picks.
   *
   * ## The request carries a `DocId` and nothing else, for `document.open`'s reason
   *
   * A destination is a path, and a path in a renderer-facing type is a compile
   * error here by design (invariant L2). So this channel does what `open` does
   * in the other direction: **main picks.** The renderer asks for a copy, main
   * runs the save dialog, mints nothing the renderer can see, and answers with
   * a byte count.
   *
   * That also settles where the picker's cancel goes. A user dismissing the
   * dialog is not an error and not a failure — it is `cancelled`, the same
   * ordinary outcome `document.open` already declares, and for the same reason:
   * changing your mind is a thing people do.
   *
   * ## This is a COPY and not *Save As*, and the name is the difference
   *
   * The document does not move. It is still open at its own file, still dirty
   * if it was dirty, and closing it still prompts. *Save As* — the document now
   * lives at the new path — moves `openedIdentity`, which is what the
   * replacement half of the write-target check compares against, so it is a
   * separate decision with its own reasoning rather than a rename of this one.
   *
   * ## `refused` names the other documents, where `document.save` names none
   *
   * `document.save`'s refusal carries a reason and not its contents, because
   * nothing consumed them. Here there is something to say: the user chose this
   * destination, and *another tab is that file* is a sentence they can act on —
   * they close it, or pick elsewhere. The count crosses rather than the ids: a
   * `DocId` is meaningless to a person, and a renderer holding other documents'
   * ids for a message it renders once is a capability it did not need.
   */
  /**
   * Writes the named pages to a new document at a destination the user picks.
   *
   * ## The SECOND CALLER of the destination path, and it carries no bytes
   *
   * `document.saveCopy`'s shape and its argument, on a subset of the pages: the
   * renderer sends which document and which pages, and main picks the
   * destination, builds the extract in the engine host and writes it. So the
   * extracted document exists in exactly one process and crosses nothing — the
   * same property `document.insertImage` has in the other direction.
   *
   * ## The outcomes are `saveCopy`'s, because it is the same write
   *
   * A dismissed picker is a declared outcome rather than an error; `refused`
   * carries how many other documents reach the chosen path; `write-failed` is
   * the atomic write's. They are identical because the destination half is
   * literally the same function — `writeDocumentCopy`, handed a different
   * flush.
   */
  'document.extract': channel(
    'Writes the named pages to a new document at a destination the user picks.',
    z.object({
      docId: docIdSchema,
      /**
       * Zero-based pages, in the order they should appear, as a PAGE SET (`pageSet.ts`): *every page* of a document of
       * any length is one run. It was a list bounded at 4,096 indices, so extracting all of a document past
       * 4,096 pages failed as `internal` (JOURNAL, *No document-size refusals*). A page this document does not have is
       * refused where the count is known, before any page is listed.
       */
      pages: pageSetSchema,
    }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative(), ...WRITTEN }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Writes one page to a file the user names, opens it in the operating system's PDF
   * handler, and starts watching it for saves
   * ([ADR-0062](../../../docs/DECISIONS/0062-a-page-edited-in-another-application-leaves-as-a-named-file-and-returns-by-the-one-open-route.md)).
   *
   * ## `document.extract`'s route, for one page, and the file is the person's
   *
   * Main runs the save dialog and writes the page through the copy path; this build never
   * deletes the file. `version` is the one `page` was read at, and main records it: the
   * reimport's `replacePage` carries it, so the bus refuses a document that moved since
   * (the 2026-09-14 correction).
   *
   * ## Only a `.pdf` is handed to the operating system
   *
   * An extension chooses the program the operating system runs, and a save dialog lets a
   * person type `page.exe`. A destination not ending `.pdf` is refused BEFORE anything is
   * written, so no page's bytes are left under a name that says they are a program.
   */
  'document.editPageExternally': channel(
    'Writes one page to a file the user names and opens it in their PDF editor, watching it for saves.',
    z.object({ docId: docIdSchema, page: z.number().int().nonnegative(), version: docVersionSchema }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('sent') }),
      z.object({ kind: z.literal('cancelled') }),
      /** The chosen destination does not end `.pdf`; nothing was written or opened. */
      z.object({ kind: z.literal('not-pdf') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
      /** The page was written, and the operating system could not open it. Not watched. */
      z.object({ kind: z.literal('launch-failed') }),
      /** The page was written, and its folder is one the platform will not watch. Not opened. */
      z.object({ kind: z.literal('not-watchable') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Waits up to thirty seconds for the page this document sent out to be saved.
   *
   * ## Bounded, on the one bridge function
   *
   * No push exists, and no `invoke` is left pending past the bound: `unchanged` after
   * thirty seconds, and the renderer asks again. An edit is a changed SHA-256 digest after
   * a quiet second, never an event (ADR-0062 Decisions 3 and 4).
   */
  'document.awaitExternalEdit': channel(
    'Waits a bounded time for the page sent to another application to be saved there.',
    z.object({ docId: docIdSchema }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('changed') }),
      z.object({ kind: z.literal('unchanged') }),
      /** The document closed, the watch ended, or no page is out for it. */
      z.object({ kind: z.literal('ended') }),
    ]),
    ['document-not-open'],
  ),

  /**
   * Opens the edited page as a visible tab and puts it back in place of the page sent out.
   *
   * The open is the one open route's (ADR-0040 Decision 2); the replace is `replacePage`
   * carrying the version recorded when the page left, so a document that moved is refused
   * by the bus inside its lane and answered as `document-changed`. The tab stays open.
   */
  'document.reimportExternalEdit': channel(
    'Opens the edited page as a tab and puts it back in place of the page that was sent out.',
    z.object({ docId: docIdSchema }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('reimported'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
        historyDropped: z.number().int().nonnegative(),
        /** The edited page, open as its own tab. */
        opened: z.object({
          docId: docIdSchema,
          version: docVersionSchema,
          byteLength: z.number().int().nonnegative(),
          name: z.string().max(MAX_DOCUMENT_NAME_LENGTH),
        }),
      }),
      /** The document moved since the page left; nothing was replaced. */
      z.object({ kind: z.literal('document-changed') }),
      /** No page is out for this document, or no edit of it is pending. */
      z.object({ kind: z.literal('no-edit') }),
      /**
       * The edited file is already open as a tab. That tab holds the bytes from when it was
       * opened rather than the save, so nothing is replaced; closing the tab lets the edit
       * come back.
       */
      z.object({ kind: z.literal('open-elsewhere') }),
      /** The edited file could not be opened: no room on the disk for its image file, as `openAtCapacitySchema`. */
      z.object({
        kind: z.literal('at-capacity'),
        wouldHold: z.number().int().nonnegative(),
        ceiling: z.number().int().nonnegative(),
      }),
      /** The edited file was gone before it could be opened. */
      z.object({ kind: z.literal('absent') }),
      /**
       * The edited file could not be read: the editor still holds it (`busy`), or this account may not read it
       * (`denied`). Nothing was replaced; saving and closing it in the editor lets the edit come back.
       */
      openReadRefusedSchema,
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned', 'engine-unavailable'],
  ),

  /**
   * Writes a region of one page to a PNG at a destination the user picks.
   *
   * ## NO RASTER CROSSES, which is the gate this channel had to satisfy
   *
   * §9.17's payload gate says the only bytes that cross are a snapshot of the
   * canonical image, once per version. A PNG of a region a person dragged
   * scales with the drag, so it does not cross: main picks the destination, the
   * engine host builds the image and writes it into the granted directory, and
   * main copies the file out. What travels on this channel is a rectangle and a
   * count.
   *
   * ## The rectangle is PDF USER SPACE, as every annotation payload is
   *
   * The tool's drag goes through the one adapter, so a snapshot and a rectangle
   * annotation drawn over the same region carry the same numbers — and the
   * kernel maps both out with `placedRect`. A viewport rectangle here would be
   * a second opinion about where on the page the pointer was.
   *
   * ## It answers `copied`, which is what a caller can act on
   *
   * The same four outcomes an extract has, for the same reasons and through the
   * same write path: a snapshot written over a document somebody has open would
   * destroy it exactly as a PDF copy would.
   */
  'document.snapshotRegion': channel(
    'Writes a region of one page to a PNG at a destination the user picks.',
    z.object({
      docId: docIdSchema,
      page: z.number().int().nonnegative(),
      /** The region in PDF user space; need not be ordered. */
      rect: annotationRectSchema,
      /** Device pixels per PDF point. The kernel holds and enforces the bounds. */
      scale: z.number().positive(),
    }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative(), ...WRITTEN }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Writes each group of pages to its own document in a folder the user picks.
   *
   * ## A FOLDER, and that is the row's decision rather than an implementation
   * detail
   *
   * A split writes several documents, and there is no save dialog for several
   * files. The alternative — the save dialog once per output — is unusable the
   * moment a reader splits a hundred-page document one page per file, which is
   * the case the feature exists for. So the user picks the place and main
   * derives the names, and every derived name goes through the same contested
   * check a copy does, **before anything is written**, because the platform's
   * own overwrite confirmation cannot fire for a name nobody typed.
   *
   * ## ONE mode on the wire, two on the surface
   *
   * *One file per page* and *these ranges* are the same request with different
   * groups — `[[0],[1],[2]]` against `[[0,1,2],[3,4]]` — so the kernel does one
   * thing and the renderer builds the grouping. A `mode` discriminant would be
   * a second way to say what the groups already say.
   *
   * ## The answer counts FILES, not bytes
   *
   * A split's byte total is the sum of documents the user cannot see
   * individually; *how many files* is what they will look for in the folder.
   */
  'document.split': channel(
    'Writes each group of pages to its own document in a folder the user picks.',
    z.object({
      docId: docIdSchema,
      /**
       * The outputs: `groups`, each a page set of its own file — the ranges a person typed, bounded at
       * {@link MAX_SPLIT_PARTS} files since each is a range they wrote — or `each`, ONE FILE PER PAGE of a page set.
       *
       * `each` is the document-shaped form. Splitting every page of a long document is the ordinary case, and as one
       * group per page it met {@link MAX_SPLIT_PARTS} at 4,096 pages and failed as `internal` (JOURNAL, *No
       * document-size refusals*); as a page set it is one run at any length, and `main` makes the groups.
       */
      split: z.union([
        z.object({ groups: z.array(pageSetSchema).min(1).max(MAX_SPLIT_PARTS) }).strict(),
        z.object({ each: pageSetSchema }).strict(),
      ]),
    }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('split'), files: z.number().int().positive(), ...WRITTEN }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Writes each named page as a PNG or JPEG in a folder the user picks —
   * D10's *Pages → PNG / JPEG*.
   *
   * ## `document.split`'s shape, one image per page
   *
   * A folder, for the split's reason: an export of every page is the ordinary
   * case and there is no save dialog for several files. Main derives the names
   * and every one is checked before anything is written. The answer is split's
   * four outcomes, and `files` is what a person will look for in the folder.
   *
   * ## The ask is pages and three numbers; the images never cross
   *
   * The pages are bounded by {@link MAX_SPLIT_PARTS}, since one page is one
   * file. DPI and quality are bounded here as well as in the host, so a
   * renderer asking for a scale the host would refuse is refused at the
   * boundary it crossed rather than one page into the write.
   */
  'document.exportPageImages': channel(
    'Writes each named page as a PNG or JPEG in a folder the user picks.',
    z
      .object({
        docId: docIdSchema,
        /**
         * Zero-based pages, one file each, as a page set: *every page* is one run at any length. A list bounded at
         * {@link MAX_SPLIT_PARTS} failed for a document past 4,096 pages (JOURNAL, *No document-size refusals*).
         */
        pages: pageSetSchema,
        format: z.enum(PAGE_IMAGE_FORMATS),
        dpi: z.number().int().min(MIN_PAGE_IMAGE_DPI).max(MAX_PAGE_IMAGE_DPI),
        quality: z.number().int().min(MIN_IMAGE_QUALITY).max(MAX_IMAGE_QUALITY),
      })
      .strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('split'), files: z.number().int().positive(), ...WRITTEN }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Writes the form's data to a file the user picks, in the format they chose.
   *
   * ## `snapshotRegion`'s FOUR OUTCOMES with one more, and the extra one is the
   * row
   *
   * The destination path is the same code on the same terms — the contested
   * check, the temporary and backup naming, the atomic write — because a form
   * data file written over a document somebody has open destroys it exactly as
   * a PDF copy would.
   *
   * `unrepresentable` is the fifth, and it exists because the three formats are
   * not equivalent. XML 1.0 admits tab, newline and carriage return out of the
   * C0 range and has no escape for the rest, so a field value carrying a
   * control character cannot be written as XFDF at all — while FDF and JSON
   * carry it unharmed. The alternatives were a file no parser accepts and a
   * file silently missing a character; both are the failure this row is about,
   * which is an export that looks like it worked. A refusal naming the format
   * is the only one of the three a person can act on.
   *
   * ## The format is the USER'S choice and reaches four readers
   *
   * It picks the encoder, the dialog's filter and the suggested extension, and
   * it is `formDataFormatSchema` in all of them — one closed set rather than
   * four agreeing lists.
   */
  'document.exportFormData': channel(
    'Writes the document’s form data to a file the user picks.',
    z.object({ docId: docIdSchema, format: formDataFormatSchema }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative(), ...WRITTEN }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
      /** A value this format cannot carry. The other two can — see above. */
      z.object({ kind: z.literal('unrepresentable') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Writes the document's text to a plain-text file the user picks — D10's
   * *text extraction*, its plain half.
   *
   * ## The ask is a `DocId`, and the text never crosses
   *
   * Main picks the file, reads each page's text from the host, and streams it to
   * disk one page at a time, so neither the renderer nor `main` holds the
   * document's text (ADR-0035). The answer counts BYTES, as a copy's does,
   * because the file is one file.
   *
   * ## Two modes, two writers
   *
   * `plain` is MuPDF's structured text through the one substrate. `layout` is
   * Poppler's `pdftotext -layout`, run as a contained separate process (ADR-0071),
   * because MuPDF's text output has no layout mode — measured 2026-09-14. The
   * mode is REQUIRED: a default would decide which engine reads the document at
   * a call site that did not say.
   *
   * `unavailable` is a layout export on a machine with no `pdftotext`, answered
   * before any dialog. `failed` is a converter that ran and wrote nothing usable;
   * its reason stays in `main`'s log.
   */
  'document.exportText': channel(
    'Writes the document’s text to a plain-text file the user picks.',
    // THE PAGES, REQUIRED here and on every export to another format and on Print (ADR-0161): a caller that forgot
    // them would convert the whole document with nothing to say it did. *Every page* is the whole set.
    z.object({ docId: docIdSchema, mode: z.enum(['plain', 'layout']), pages: pageSetSchema }).strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative(), ...WRITTEN }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
      z.object({ kind: z.literal('unavailable') }),
      z.object({ kind: z.literal('failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Writes the document as a Word file the user picks — D10's *Word (rich /
   * layout / text)*, written by this build (ADR-0072).
   *
   * `document.exportText`'s shape: a `DocId` and the mode, the file picked and
   * written by main a page at a time, a copy's outcomes. The mode is REQUIRED,
   * for `exportText`'s reason — a default would decide what a person gets at a
   * call site that did not say.
   */
  'document.exportWord': channel(
    'Writes the document as a Word file the user picks.',
    z.object({ docId: docIdSchema, mode: z.enum(WORD_MODES), pages: pageSetSchema }).strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative(), ...WRITTEN }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Writes the document as a PowerPoint deck the user picks — D10's *PowerPoint*,
   * one slide per page, each the page as MuPDF draws it (ADR-0072). No options:
   * a copy's ask and a copy's outcomes.
   */
  'document.exportPowerPoint': channel(
    'Writes the document as a PowerPoint deck the user picks.',
    z.object({ docId: docIdSchema, pages: pageSetSchema }).strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative(), ...WRITTEN }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Writes the tables MuPDF finds as an Excel workbook the user picks — D10's
   * *Excel*, the automatic engine (ADR-0072, ADR-0073).
   *
   * The layout is REQUIRED, for `exportWord`'s reason. `no-tables` arrives before
   * any picker opens, carrying how many pages are a picture with no text — the
   * pages recognising would give words to.
   *
   * ## The review's edits, against the version they were made on
   *
   * D10's *editable review grid*: `edits` replace cells' text, addressed as
   * `document.pageTables` showed them. They are corrections of THOSE tables, so the
   * request names the version the grid was read at, and a document that has moved
   * since — or an edit naming a cell the page does not have — answers `changed`
   * before any picker opens rather than writing text into the wrong cell. Both
   * fields are required; an export nobody reviewed sends no edits.
   */
  'document.exportExcel': channel(
    'Writes the tables found in the document as an Excel workbook the user picks.',
    z
      .object({
        docId: docIdSchema,
        layout: z.enum(['sheet-per-page', 'one-sheet']),
        /**
         * Which reader finds the tables (ADR-0086): MuPDF's table read of the page's text, or a
         * service reading each page's raster. The review grid shows MuPDF's tables, so its edits
         * belong to `automatic` alone — refused below with any other engine rather than applied
         * to a table they were not made on.
         */
        engine: z.enum(TABLE_ENGINES),
        version: docVersionSchema,
        /** The pages whose tables are written (ADR-0161). The review still shows any page. */
        pages: pageSetSchema,
        edits: z
          .array(
            z
              .object({
                page: z.number().int().nonnegative(),
                table: z.number().int().nonnegative(),
                row: z.number().int().nonnegative(),
                column: z.number().int().nonnegative(),
                text: z.string().max(MAX_TABLE_CELL_TEXT),
              })
              .strict(),
          )
          .max(MAX_TABLE_CELLS)
          .readonly(),
      })
      .strict()
      .refine((request) => request.engine === 'automatic' || request.edits.length === 0, {
        message: 'the review grid’s edits are MuPDF’s tables’, so only the automatic engine takes them',
      }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative(), ...WRITTEN }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
      z.object({ kind: z.literal('no-tables'), picturePages: z.number().int().nonnegative() }),
      /** The document moved since the review, or an edit names no cell it has. Nothing was written. */
      z.object({ kind: z.literal('changed') }),
      /**
       * A network engine did not read a page (ADR-0086). Declared rather than left to the
       * incident log, because most of these are the reader's to act on — a key, a service's
       * limit, an account's credit — and `detail` is the sentence main built, carrying the
       * service's own words where it gave any. Nothing was written.
       */
      z.object({
        kind: z.literal('service-refused'),
        engine: z.enum(['azure', 'claude']),
        page: z.number().int().nonnegative(),
        reason: z.enum(SERVICE_REFUSALS),
        detail: z.string().max(MAX_SERVICE_DETAIL),
      }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Writes the document as PDF/A-2b to a file the user picks — D10's *PDF/A-2b export*,
   * Ghostscript's `pdfwrite` in a contained process (ADR-0075).
   *
   * `copied` carries what the conversion removed, in Ghostscript's own words, because its
   * exit code does not say; `unavailable` where no converter is provisioned; `failed`
   * where it produced no PDF/A file, which is then not written.
   */
  'document.exportPdfa': channel(
    'Writes the document as PDF/A-2b to a file the user picks, saying what the conversion removed.',
    z.object({ docId: docIdSchema }).strict(),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('copied'),
        bytes: z.number().int().nonnegative(),
        removed: z.array(z.string().max(MAX_PDFA_REMOVAL_CHARS)).max(MAX_PDFA_REMOVALS).readonly(),
        /** The document was tagged and the file carries no structure tree — which Ghostscript does not print. */
        tagsDropped: z.boolean(),
        ...WRITTEN,
      }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
      z.object({ kind: z.literal('unavailable') }),
      z.object({ kind: z.literal('failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Measures what Optimize would make of the document at one setting — D10's *Optimize*,
   * MuPDF's own image rewriter in the compose host
   * ([ADR-0087](../../../docs/DECISIONS/0087-optimize-is-mupdfs-native-image-rewriter-in-the-compose-host.md)).
   *
   * ## A measurement, and nothing is kept
   *
   * The copy is written in the host's area, its size read, and the copy removed: the answer is
   * the two sizes and the version they were measured at. `document.optimize` then writes the
   * copy by rewriting again, carrying that version — so no rewritten document is held in `main`
   * between the two calls, and a document that moved in between answers `changed` rather than
   * saving sizes nobody was shown. The rewrite is deterministic, and slower than holding a file
   * by one rewrite: at most 2.5 s on the corpus (2026-09-19).
   */
  'document.optimizeMeasure': channel(
    'Measures the size of an optimized copy of the document at one setting, keeping nothing.',
    z.object({ docId: docIdSchema, setting: z.enum(OPTIMIZE_SETTING_NAMES) }).strict(),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('measured'),
        version: docVersionSchema,
        before: z.number().int().nonnegative(),
        after: z.number().int().nonnegative(),
      }),
      /** MuPDF could not open the document to rewrite it — its encryption, for one. */
      z.object({ kind: z.literal('unreadable') }),
      /** No native library was provisioned for this run. */
      z.object({ kind: z.literal('unavailable') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Writes an optimized copy of the document to a file the user picks, at the setting and the
   * version `document.optimizeMeasure` answered (ADR-0087 Decision 1).
   *
   * **A result that is not smaller is never written**: `not-smaller` carries both sizes, and no
   * picker opens when the version has moved (`changed`). The open document is not changed.
   */
  'document.optimize': channel(
    'Writes an optimized copy of the document to a file the user picks, only if it is smaller.',
    z
      .object({ docId: docIdSchema, setting: z.enum(OPTIMIZE_SETTING_NAMES), version: docVersionSchema })
      .strict(),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('copied'),
        bytes: z.number().int().nonnegative(),
        before: z.number().int().nonnegative(),
        ...WRITTEN,
      }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
      z.object({
        kind: z.literal('not-smaller'),
        before: z.number().int().nonnegative(),
        after: z.number().int().nonnegative(),
      }),
      z.object({ kind: z.literal('changed') }),
      z.object({ kind: z.literal('unreadable') }),
      z.object({ kind: z.literal('unavailable') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Prints the document — D10's *print*: MuPDF's raster of each page chosen in the
   * system print dialog, at the resolution asked, drawn onto the printer chosen there
   * (ADR-0074). Never the DOM. The dialog is main's, so the ask is a `DocId` and a
   * resolution; `unavailable` where this platform has no print dialog, `failed` where
   * the printer refused a step and the document was abandoned.
   */
  'document.print': channel(
    'Prints the document through the system print dialog, each page rasterised by MuPDF.',
    z
      .object({
        docId: docIdSchema,
        dpi: z.union([z.literal(150), z.literal(300), z.literal(600)]),
        // WHERE THE SYSTEM DIALOG'S OWN *PAGES* STARTS (ADR-0161 Decision 3): its answer is what prints.
        pages: pageSetSchema,
      })
      .strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('printed'), pages: z.number().int().nonnegative() }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('unavailable') }),
      z.object({ kind: z.literal('failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Emails the document — D10's *email document*: its current bytes offered to the
   * Windows Share sheet as a file, where the person picks the mail application
   * (ADR-0080). The sheet is main's, so the ask is a `DocId`. `offered` says the sheet
   * opened and nothing about a send; `unavailable` where this platform has no sheet,
   * `failed` where a step before it refused.
   */
  'document.email': channel(
    'Offers the document to the Windows Share sheet as a file, to be emailed.',
    z.object({ docId: docIdSchema }).strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('offered') }),
      z.object({ kind: z.literal('unavailable') }),
      z.object({ kind: z.literal('failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  'document.saveCopy': channel(
    'Writes a copy of an open document to a destination the user picks.',
    z.object({ docId: docIdSchema }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative(), ...WRITTEN }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Makes an edit on a COPY of a signed document, so the original keeps its signatures
   * ([ADR-0149](../../../docs/DECISIONS/0149-a-signature-is-appended-and-an-edit-that-breaks-one-is-asked-first.md)
   * Decision 5).
   *
   * `document.saveCopy`'s picker and write, then the open route a picked file takes, then the command applied to the
   * copy with the version it names re-bound to the copy's. Asked for when an edit answered `breaks-signatures` and the
   * person chose to work on a copy.
   *
   * ## The copy is opened whatever the edit does there
   *
   * Once the file is written it is a document the person chose to make, so it opens, and the answer says whether the
   * edit applied: `edited`, or `edit-refused` with a reason the person can act on, beside the copy that is open either
   * way. Any other failure is a defect: main closes the copy, whose file stays where it was put, and the boundary
   * records it — an answer carrying no document must leave none open that no tab shows.
   */
  'document.editCopy': channel(
    'Writes a copy of an open document where the user picks, opens it, and applies one command to the copy.',
    z.object({ docId: docIdSchema, command: renderableCommandSchema }),
    z.discriminatedUnion('kind', [
      // AND THE BOXES THE EDIT DREW ON THE COPY, `document.execute`'s list on the copy route (ADR-0174).
      openedSchema.extend({ kind: z.literal('edited'), historyDropped: z.number().int().nonnegative(), ...drawnBoxesShape }),
      openedSchema.extend({
        kind: z.literal('edit-refused'),
        // A FAILURE'S OWN SHAPE, so a refusal that carries a detail carries it here as on `document.execute`
        // (ADR-0169): the copy route names the characters a font cannot show as the direct route does.
        problem: z.union([
          z
            .object({
              code: z.enum(['engine-unavailable', 'text-not-in-place', 'nothing-to-replace', 'replace-moves-line', 'document-poisoned']),
            })
            .strict(),
          z.object({ code: z.literal('text-not-writable'), detail: FAILURE_DETAIL_SCHEMAS['text-not-writable'] }).strict(),
          z.object({ code: z.literal('edit-refused'), detail: FAILURE_DETAIL_SCHEMAS['edit-refused'] }).strict(),
        ]),
      }),
      z.object({ kind: z.literal('cancelled') }),
      importContestedSchema,
      importWriteFailedSchema,
      openAbsentSchema,
      openAtCapacitySchema,
      openReadRefusedSchema,
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned', 'stale-target'],
  ),

  /**
   * Writes a copy of an open document where the person picks, and opens the copy to work on (cloud-4 7b): what a file
   * that cannot be written over is offered, so the changes made from here on have a file they can be saved to.
   *
   * `document.editCopy`'s picker, write and open route, with no edit. The original stays open as it was; closing it
   * is the person's.
   */
  'document.workOnCopy': channel(
    'Writes a copy of an open document where the user picks, and opens the copy.',
    z.object({ docId: docIdSchema }).strict(),
    z.discriminatedUnion('kind', [
      openedSchema,
      z.object({ kind: z.literal('cancelled') }),
      importContestedSchema,
      importWriteFailedSchema,
      openAbsentSchema,
      openAtCapacitySchema,
      openReadRefusedSchema,
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Inserts an image as a new page, from a file the user picks.
   *
   * ## THE ASK CARRIES NO BYTES, and that is the whole reason this is a channel
   *
   * A renderer that could send an image would be a renderer holding one, and a
   * multi-megabyte IPC message per insert. It sends **two numbers**: which
   * document, and where the page goes. Main opens the picker, reads the file,
   * and mints `insertImagePage` straight into the bus — so the bytes exist in
   * exactly one process and cross nothing.
   *
   * `document.execute` cannot carry that command either: its params take
   * `renderableCommandSchema`, which is the command union with this one member
   * removed, so the capability is unrepresentable rather than merely unused.
   *
   * ## The outcomes are `saveCopy`'s, for the same reason
   *
   * A picker a user dismisses is not a failure, so `cancelled` is a declared
   * outcome rather than an error — the same shape and the same argument as the
   * destination picker beside it. `unreadable` is separate from `cancelled`
   * because a file that cannot be decoded is something the user must be told
   * about, where a dismissal is something they did.
   */
  'document.insertImage': channel(
    'Inserts an image as a new page, from a file the user picks.',
    z.object({ docId: docIdSchema, at: z.number().int().nonnegative() }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('inserted'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
        historyDropped: z.number().int().nonnegative(),
      }),
      z.object({ kind: z.literal('cancelled') }),
      /** The file was picked and is not an image this build can decode. */
      z.object({ kind: z.literal('unreadable') }),
      /** Past {@link MAX_IMAGE_BYTES} — refused before it is read into memory. */
      z.object({ kind: z.literal('too-large'), limitBytes: z.number().int().positive() }),
      /** A PNG whose header states more pixels than may be decoded — refused before the decode. */
      z.object({ kind: z.literal('too-many-pixels'), limitPixels: z.number().int().positive() }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Composes a Markdown file the user picks as a new PDF, saves it where they choose,
   * and opens it
   * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
   *
   * ## THE ASK CARRIES NOTHING, `document.open`'s shape
   *
   * Main opens both pickers, reads the source, composes it in the compose host,
   * writes the result and opens it through the one route a document is opened by.
   * What crosses is the outcome.
   *
   * ## Every open outcome, and the import's own beside them
   *
   * {@link textImportOutcomeSchema}, shared with `document.newFromCsv`.
   */
  'document.newFromMarkdown': channel(
    'Composes a Markdown file the user picks as a new PDF, saves it where they choose, and opens it.',
    z.object({}),
    textImportOutcomeSchema,
    ['engine-unavailable'],
  ),

  /**
   * Sets a CSV file the user picks as a table on new PDF pages, saves it where they
   * choose, and opens it ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
   *
   * `document.newFromMarkdown`'s shape and outcomes exactly: the ask carries nothing,
   * main runs both pickers, the compose host reads the file with a strict RFC 4180
   * reader, and what crosses is the open's outcome or the import's own.
   */
  'document.newFromCsv': channel(
    'Sets a CSV file the user picks as a table in a new PDF, saves it where they choose, and opens it.',
    z.object({}),
    textImportOutcomeSchema,
    ['engine-unavailable'],
  ),

  /**
   * Converts a Word, Excel or PowerPoint file the user picks to a new PDF, saves it where they
   * choose, and opens it ([ADR-0120](../../../docs/DECISIONS/0120-office-import-is-onlyoffices-x2t-contained.md)).
   *
   * `document.newFromCsv`'s shape: the ask carries nothing, main runs both pickers, and ONLYOFFICE's
   * `x2t` converts the file in its own contained process. `engine-unavailable` where no converter
   * was provisioned.
   */
  'document.newFromOffice': channel(
    'Converts a Word, Excel or PowerPoint file the user picks to a new PDF, saves it where they choose, and opens it.',
    z.object({}),
    officeImportOutcomeSchema,
    ['engine-unavailable'],
  ),

  /**
   * Makes a new PDF with one page per image the user picks, saves it where they
   * choose, and opens it ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
   *
   * `document.newFromCsv`'s shape: the ask carries nothing, main runs both pickers and
   * the compose host decodes the images. {@link imageImportOutcomeSchema} adds the two
   * bounds a set of files has.
   */
  'document.newFromImages': channel(
    'Makes a new PDF with one page per image the user picks, saves it where they choose, and opens it.',
    z.object({}),
    imageImportOutcomeSchema,
    ['engine-unavailable'],
  ),

  /**
   * Makes a new PDF with one page per picture taken with the camera, saves it where the
   * user chooses, and opens it.
   *
   * The frames are {@link capturedFramesSchema}'s, composed in the compose host exactly as
   * picked JPEGs are. The set's bounds are the schema's, so the two outcomes only a picked
   * set can meet are not members here; the shared import union is the answer.
   */
  'document.newFromCapture': channel(
    'Makes a new PDF from pictures taken with the camera, saves it where the user chooses, and opens it.',
    z.object({ frames: capturedFramesSchema }),
    composedImportOutcomeSchema,
    ['engine-unavailable'],
  ),

  /**
   * Composes a Markdown file into a new PDF, opens it, and merges it into this
   * document at `at`.
   *
   * ## A VISIBLE TAB, never a hidden open
   *
   * ADR-0040 Decision 2 refuses a hidden transient open, and ADR-0060's correction
   * applies it: the composed document is saved where the user chooses and opened
   * as a tab by the same route as `document.newFromMarkdown`, then merged with the
   * existing `mergeDocument`. So `appended` carries both the target's new state and
   * the tab that opened.
   *
   * ## US Letter, stated
   *
   * The composition is set at US Letter whatever size this document's pages are:
   * the geometry main reads carries rotations and a page count, not sizes, and a
   * reader for them is a row of its own.
   */
  'document.appendMarkdown': channel(
    'Composes a Markdown file into a new PDF, opens it, and merges it into this document.',
    z.object({ docId: docIdSchema, at: z.number().int().nonnegative() }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('appended'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
        historyDropped: z.number().int().nonnegative(),
        /** The composed document, open as its own tab. */
        opened: z.object({
          docId: docIdSchema,
          version: docVersionSchema,
          byteLength: z.number().int().nonnegative(),
          name: z.string().max(MAX_DOCUMENT_NAME_LENGTH),
        }),
        /** Every character drawn as the box, `opened-with-boxes`' list, EMPTY where none is. */
        boxed: z.array(boxedCharacterSchema).max(MAX_BOXED_CHARACTERS),
        more: z.number().int().min(0),
      }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('too-large'), limitBytes: z.number().int().positive() }),
      z.object({ kind: z.literal('unreadable') }),
      z.object({
        kind: z.literal('composition-refused'),
        reason: z.enum(COMPOSE_REFUSALS),
        line: z.number().int().positive().nullable(),
        file: z.string().min(1).max(MAX_DOCUMENT_NAME_LENGTH).nullable(),
      }),
      z.object({ kind: z.literal('destination-contested'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
      /** The composed file was written and could not be opened: no room on the disk, as `openAtCapacitySchema`. */
      z.object({
        kind: z.literal('at-capacity'),
        wouldHold: z.number().int().nonnegative(),
        ceiling: z.number().int().nonnegative(),
      }),
      /** The composed file was written and was gone before it could be opened. */
      z.object({ kind: z.literal('absent') }),
      /** The composed file was written and its read was refused: another program holds it, or no permission. */
      openReadRefusedSchema,
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned', 'engine-unavailable'],
  ),

  /**
   * Places an image on pages, from a file the user picks.
   *
   * `document.insertImage`'s shape and every one of its arguments — the ask
   * carries no bytes, main opens the picker, reads the file and mints
   * `placeImage` straight into the bus, and `document.execute` cannot carry
   * that command because `renderableCommandSchema` has it removed.
   *
   * What it adds is a **rectangle and a page list**, which are the two things
   * the renderer does know: the tool drew the box on the page in view, and
   * *every page* is one click in a surface. Both are numbers.
   */
  /**
   * Every signature the document carries, with what each one covers.
   *
   * ## A READ, and the answer is BOUNDED
   *
   * Eight short strings per signature and at most 256 of them, so the payload
   * is the same size for a two-page document and a two-thousand-page one —
   * invariant L11's test, which a channel answering *the signatures* rather
   * than *the certificates* passes by construction.
   *
   * ## `coversDocument` and `coversWholeFile` are TWO answers
   *
   * They fail differently and a surface must say which: a digest mismatch is
   * *these bytes changed since it was signed*, and a range that stops short is
   * *something was appended that the signature says nothing about*. A reader
   * that folded them into one green tick would report an intact signature over
   * half a document — which is the specific way signature indicators lie.
   *
   * ## What it does NOT answer
   *
   * Whether the certificate is TRUSTED. Chain building, revocation and trust
   * anchors are a different question, and ADR-0054 says so in its own words.
   * The channel's members are the ones this build can answer, and a `trusted`
   * field would be the green check that verifies nothing.
   */
  'document.signatures': channel(
    'Reads and verifies the signatures an open document carries.',
    z.object({ docId: docIdSchema }),
    z.object({
      signatures: z
        .array(
          z.object({
            signer: z.string().max(MAX_SIGNATURE_FIELD),
            organisation: z.string().max(MAX_SIGNATURE_FIELD),
            reason: z.string().max(MAX_SIGNATURE_FIELD),
            location: z.string().max(MAX_SIGNATURE_FIELD),
            notBefore: z.string().max(MAX_SIGNATURE_FIELD),
            notAfter: z.string().max(MAX_SIGNATURE_FIELD),
            coversDocument: z.boolean(),
            coversWholeFile: z.boolean(),
          }),
        )
        .max(MAX_SIGNATURES)
        .readonly(),
      /** A signature this build could not parse at all. */
      unreadable: z.boolean(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned', 'engine-unavailable'],
  ),

  /**
   * Signs the document with a certificate the user picks.
   *
   * ## `document.placeImage`'s shape, and every one of its arguments
   *
   * The ask carries **no bytes**: main opens the picker, reads the PKCS#12 file
   * and mints `signDocument` straight into the bus, and
   * `renderableCommandSchema` has that command removed so the capability is
   * unrepresentable rather than merely unused. A private key travelling
   * renderer → main is the one payload here that would be worse than a large
   * one.
   *
   * ## The PASSPHRASE does travel, and it is used rather than kept
   *
   * A person types it, so the renderer is where it is composed — the same rule
   * `document.unlock` follows
   * ([ADR-0055](../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)):
   * main holds it for the length of one call, nothing records it, and no
   * diagnostic names it. An **empty** passphrase is real and common, which is
   * why the field has no minimum.
   *
   * ## `wrong-passphrase` is an OUTCOME, and `unreadable` is its sibling
   *
   * A person mistyping is not a defect. A file that is not a PKCS#12 at all is
   * not one either — they picked the wrong file — and the two are separate
   * because the sentence a person needs differs: *try the password again*
   * against *that is not a certificate*.
   *
   * **They are not always distinguishable**, and that is stated rather than
   * hidden: a PKCS#12's MAC check fails the same way for a wrong passphrase and
   * for a truncated file, so the kernel reports `wrong-passphrase` when a
   * passphrase was supplied and `unreadable` when the parse failed before any
   * key material was reached.
   */
  'document.sign': channel(
    'Signs an open document with a PKCS#12 certificate the user picks.',
    z.object({
      docId: docIdSchema,
      passphrase: z.string().max(DOCUMENT_PASSWORD_MAX_CHARS),
      name: z.string().min(1).max(MAX_SIGNATURE_FIELD).optional(),
      reason: z.string().min(1).max(MAX_SIGNATURE_FIELD).optional(),
      location: z.string().min(1).max(MAX_SIGNATURE_FIELD).optional(),
      contactInfo: z.string().min(1).max(MAX_SIGNATURE_FIELD).optional(),
      /**
       * What a reader may still change, for a CERTIFYING signature.
       *
       * Absent is an ordinary approval signature. Present writes a `/DocMDP`
       * transform, which is a claim about authorship rather than about having
       * signed — and the words rather than the numbers, because the mapping to
       * `/P` is the format's and the kernel owns it.
       */
      certify: z.enum(['no-changes', 'form-fill', 'form-fill-and-annotate']).optional(),
      /**
       * Where the signature is seen and how it looks, for a VISIBLE one.
       *
       * The mark's `image` member carries no picture: main picks and reads it,
       * before the certificate, so a person choosing a picture meets that dialog
       * first and a cancelled one asks for no credential.
       */
      appearance: signaturePlacementSchema
        .extend({ mark: requestedSignatureMarkSchema })
        .strict()
        .optional(),
      /**
       * The timestamp authority, by id. Absent signs without a timestamp;
       * present, a signature is never written without one (ADR-0058).
       */
      timestamp: z.enum(TIMESTAMP_AUTHORITY_IDS).optional(),
    }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('signed'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
        historyDropped: z.number().int().nonnegative(),
      }),
      z.object({ kind: z.literal('cancelled') }),
      /**
       * Every refusal, as ONE member over the contract's list — never five
       * literals beside it. A refusal carries no fields, so its kind is the whole
       * answer, and the renderer's problem dialog takes its reasons from the same
       * list. What each means is written beside it in `SIGN_REFUSALS`.
       */
      z.object({ kind: z.enum(SIGN_REFUSALS) }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Sends an open document to DocuSign for signature, signing in first if needed
   * ([ADR-0059](../../../docs/DECISIONS/0059-a-sign-in-redirect-returns-on-loopback-for-one-request.md)).
   *
   * ## What crosses, and what does not
   *
   * The renderer names the document, the subject and the signers — words a person
   * typed, each bounded by DocuSign's own published limits. The document's bytes,
   * the integration key and every token stay in `main`, which flushes the document,
   * signs in through the person's own browser when no valid sign-in is held, and
   * sends. What comes back is the envelope's id, or why not.
   */
  'docusign.send': channel(
    'Sends an open document to DocuSign for signature, signing in first if needed.',
    z.object({
      docId: docIdSchema,
      emailSubject: z.string().trim().min(1).max(MAX_DOCUSIGN_SUBJECT),
      signers: z
        .array(
          z
            .object({
              name: z.string().trim().min(1).max(MAX_DOCUSIGN_RECIPIENT_FIELD),
              email: z.email().max(MAX_DOCUSIGN_RECIPIENT_FIELD),
            })
            .strict(),
        )
        .min(1)
        .max(MAX_DOCUSIGN_SIGNERS),
    }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('sent'), envelopeId: z.string().min(1).max(128) }),
      /** One member over the contract's list, for `document.sign`'s reason. */
      z.object({ kind: z.enum(DOCUSIGN_REFUSALS) }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Saves the signed copy of the envelope this document was last sent as, to a
   * destination the person picks.
   *
   * ## The destination half is `document.extract`'s write
   *
   * The same picker, the same contested-destination check and the same atomic write
   * — handed a flush that answers DocuSign's combined document rather than this
   * document's bytes. So its outcomes are that write's, plus the two that belong to
   * DocuSign: an envelope not yet completed, which names DocuSign's own status, and a
   * document this session has sent nothing for.
   */
  'docusign.retrieve': channel(
    'Saves the signed copy of the envelope this document was last sent as.',
    z.object({ docId: docIdSchema }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative(), ...WRITTEN }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
      /** DocuSign's status for the envelope, which is not yet `completed`. */
      z.object({ kind: z.literal('not-completed'), status: z.string().min(1).max(64) }),
      /** No envelope has been sent from this document in this session. */
      z.object({ kind: z.literal('nothing-sent') }),
      z.object({ kind: z.enum(DOCUSIGN_REFUSALS) }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Places a barcode a person typed, on the page where they dragged a box (ADR-0076).
   *
   * `document.placeImage`'s route with the picker replaced by text: the renderer cannot express
   * `placeImage`, so it sends the words and the box and main writes the symbol and mints the
   * command. A text the symbology cannot carry — letters for EAN-13 — is `refused`.
   */
  'document.placeBarcode': channel(
    'Places a barcode of the given text on pages of an open document.',
    z.object({
      docId: docIdSchema,
      /** A page set, `placeImage`'s reason: *every page* is one click and one run, at any length. */
      pages: pageSetSchema,
      rect: annotationRectSchema,
      text: z.string().min(1).max(MAX_BARCODE_TEXT),
      format: z.enum(BARCODE_FORMATS),
      /** Who placed it and when — the renderer's to say, main's to write (ADR-0103). */
      stamp: annotationStampSchema,
    }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('placed'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
        historyDropped: z.number().int().nonnegative(),
      }),
      z.object({ kind: z.literal('refused') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * The barcodes on one page, read in the engine host (ADR-0076).
   *
   * `document.flatFieldCandidates`' shape: per page, stamped with a version, and no
   * `document-busy`, because it mutates nothing.
   */
  /**
   * The document's accessibility check (ADR-0078): the PDF/UA-1 rules its objects decide, and
   * the checks only a person can make. No `document-busy`, for `document.flatFieldCandidates`'
   * reason; the engine host's bounds on this wire.
   */
  'document.accessibilityCheck': channel(
    'Checks an open document against the PDF/UA-1 rules its objects decide.',
    z.object({ docId: docIdSchema }),
    z.object({
      version: docVersionSchema,
      rules: z
        .array(
          z.object({
            clause: z.string().max(16).regex(/^\d+(?:\.\d+){0,3}$/u),
            test: z.number().int().positive().max(99),
            verdict: z.enum(['passed', 'failed', 'not-applicable', 'not-determined']),
            count: z.number().int().nonnegative(),
            pages: z.array(z.number().int().nonnegative()).max(16).readonly(),
          }),
        )
        .max(32)
        .readonly(),
      humanChecks: z.array(z.enum(ACCESSIBILITY_HUMAN_CHECKS)).max(ACCESSIBILITY_HUMAN_CHECKS.length).readonly(),
    }),
    ['document-not-open', 'document-poisoned'],
  ),

  'document.pageBarcodes': channel(
    'Reads the barcodes on one page of an open document.',
    z.object({ docId: docIdSchema, page: z.number().int().nonnegative() }),
    z.object({
      version: docVersionSchema,
      barcodes: z
        .array(
          z.object({
            /** zxing-cpp's name for the symbology, shown as data. */
            format: z.string().min(1).max(32),
            text: z.string().max(MAX_BARCODE_TEXT),
          }),
        )
        .max(MAX_PAGE_BARCODES)
        .readonly(),
      /** Whether the bound stopped the list. `document.annotations`' flag. */
      truncated: z.boolean(),
    }),
    ['document-not-open', 'document-poisoned'],
  ),

  'document.placeImage': channel(
    'Places an image on pages of an open document, from a file the user picks or a picture in their stamp library.',
    z.object({
      docId: docIdSchema,
      /**
       * A page set: stamping *every page* is one click, and as a list bounded at 4,096 indices it failed for a
       * document past 4,096 pages (JOURNAL, *No document-size refusals*).
       */
      pages: pageSetSchema,
      rect: annotationRectSchema,
      /** Who placed it and when — the renderer's to say, main's to write (ADR-0103). */
      stamp: annotationStampSchema,
      /**
       * A picture from the person's stamp library, by id — then no picker opens and main reads the kept file. Absent
       * is the file picker, as before. An id, never bytes: the picture is main's, like any picked file.
       */
      picture: libraryIdSchema.optional(),
    }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('placed'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
        historyDropped: z.number().int().nonnegative(),
      }),
      z.object({ kind: z.literal('cancelled') }),
      /** The file was picked and the engine could not decode it. */
      z.object({ kind: z.literal('unreadable') }),
      /** Past {@link MAX_IMAGE_BYTES} — refused before it is read into memory. */
      z.object({ kind: z.literal('too-large'), limitBytes: z.number().int().positive() }),
      /** The library picture named is no longer kept — removed since the chooser opened. */
      z.object({ kind: z.literal('absent') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * A plain signature placed on a page with no certificate
   * ([ADR-0133](../../../docs/DECISIONS/0133-a-signatures-mark-is-drawn-once-for-both-writers.md)).
   *
   * The look is asked for as *Sign with certificate* asks for it — typed, drawn, a kept one by id, or a picture main
   * picks now — and main resolves it through the same function, so a kept picture's bytes never cross and a picked one's
   * never reach the renderer. **`keep` is main's to act on, after the mark is placed**, for every look: a typed or drawn
   * one is kept as it was made, a picked picture as a signature picture. A full library still places the mark and says
   * so in `kept`, rather than refusing the placement.
   */
  'document.placeSignature': channel(
    'Places a signature with no certificate on a page of an open document, and keeps it when asked.',
    z
      .object({
        docId: docIdSchema,
        page: z.number().int().nonnegative(),
        rect: annotationRectSchema,
        mark: requestedSignatureMarkSchema,
        keep: z.boolean(),
        /** Who placed it and when — the renderer's to say, main's to write (ADR-0103). */
        stamp: annotationStampSchema,
      })
      .strict(),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('placed'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
        historyDropped: z.number().int().nonnegative(),
        /**
         * Whether it went into the library: kept; not asked for, or already kept; the library was full; or a picture
         * the library cannot keep — past its own bound, or not a PNG or a JPEG by its bytes — though it was placed.
         */
        kept: z.enum(['kept', 'not-asked', 'library-full', 'not-keepable']),
      }),
      /** The picture picker was closed. */
      z.object({ kind: z.literal('cancelled') }),
      /** The picked file is not a PNG or a JPEG this build can decode, nor a PDF it can read. */
      z.object({ kind: z.literal('unreadable') }),
      z.object({ kind: z.literal('too-large'), limitBytes: z.number().int().positive() }),
      /** The kept signature named is no longer kept — removed since the dialog opened. */
      z.object({ kind: z.literal('absent') }),
      /** A scanned signature PDF picked at the click, whose first page carries no ink. */
      z.object({ kind: z.literal('scan-blank') }),
      /** A scanned signature PDF picked at the click, which needs a password to be read. */
      z.object({ kind: z.literal('scan-locked') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * THE PERSON'S LIBRARY (`libraryEntrySchema`): what it holds of one kind, oldest first. Read from main's own folder
   * each time, so two windows never disagree about it.
   */
  'library.list': channel(
    'Lists the stamps or signatures the person has kept.',
    z.object({ kind: libraryKindSchema }).strict(),
    z.object({ entries: z.array(libraryEntrySchema).max(MAX_LIBRARY_ENTRIES).readonly() }),
  ),

  /** A kept picture's bytes, to show it in a chooser — bounded by what the library keeps. */
  'library.picture': channel(
    'Answers the picture of one kept stamp or signature.',
    z.object({ id: libraryIdSchema }).strict(),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('found'),
        mediaType: z.enum(['image/jpeg', 'image/png']),
        bytes: z.custom<Uint8Array>(
          (value) => value instanceof Uint8Array && value.byteLength <= MAX_LIBRARY_PICTURE_BYTES,
          { message: `not a picture of at most ${String(MAX_LIBRARY_PICTURE_BYTES)} bytes` },
        ),
      }),
      z.object({ kind: z.literal('absent') }),
    ]),
  ),

  /**
   * Keeps a picture the person picks, as a stamp or a signature. Main runs the picker, reads the file and checks it
   * is a PNG or a JPEG by its own bytes — the extension is a hint to the picker, not a check.
   */
  'library.addPicture': channel(
    'Keeps a picture the user picks in their stamp or signature library.',
    z.object({ kind: libraryKindSchema }).strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('added'), entry: libraryEntrySchema }),
      z.object({ kind: z.literal('cancelled') }),
      /** Not a PNG or a JPEG by its bytes. */
      z.object({ kind: z.literal('unreadable') }),
      z.object({ kind: z.literal('too-large'), limitBytes: z.number().int().positive() }),
      /** The library holds {@link MAX_LIBRARY_ENTRIES} of this kind already. */
      z.object({ kind: z.literal('full'), limit: z.number().int().positive() }),
    ]),
  ),

  /**
   * Picks a picture for the plain Signature, to preview before it is placed (ADR-0133's second correction). Main refuses
   * a file past {@link MAX_IMAGE_BYTES} before reading it, types it by its own bytes, and HOLDS what it read under the
   * handle it answers, so the picture placed is the one previewed. One is held at a time; a new pick replaces it.
   */
  'signature.pickPicture': channel(
    'Picks a picture to sign with, held by main and answered for a preview.',
    z.object({}).strict(),
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('picked'),
          handle: fileHandleSchema,
          name: z.string().min(1).max(MAX_DOCUMENT_NAME_LENGTH),
          mediaType: z.enum(['image/jpeg', 'image/png']),
          bytes: z.custom<Uint8Array>(
            (value) => value instanceof Uint8Array && value.byteLength <= MAX_IMAGE_BYTES,
            { message: `not a picture of at most ${String(MAX_IMAGE_BYTES)} bytes` },
          ),
        })
        .strict(),
      z.object({ kind: z.literal('cancelled') }).strict(),
      /** Not a PNG or a JPEG by its bytes, nor a PDF this build can read, or it could not be read. */
      z.object({ kind: z.literal('unreadable') }).strict(),
      z.object({ kind: z.literal('too-large'), limitBytes: z.number().int().positive() }).strict(),
      /** A scanned signature PDF whose first page carries no ink. */
      z.object({ kind: z.literal('scan-blank') }).strict(),
      /** A scanned signature PDF that needs a password to be read. */
      z.object({ kind: z.literal('scan-locked') }).strict(),
    ]),
  ),

  /** Keeps a typed or drawn signature as the person made it, so it need not be made again. */
  'library.keepSignature': channel(
    'Keeps a typed or drawn signature in the signature library.',
    z.object({ mark: keepableSignatureSchema }).strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('added'), entry: libraryEntrySchema }),
      z.object({ kind: z.literal('full'), limit: z.number().int().positive() }),
    ]),
  ),

  /** Removes one kept entry, and its picture file with it. Answers whether there was one to remove. */
  'library.remove': channel(
    'Removes a kept stamp or signature.',
    z.object({ id: libraryIdSchema }).strict(),
    z.object({ removed: z.boolean() }),
  ),

  /**
   * Fills the form from a data file the user picks.
   *
   * `document.placeImage`'s shape and every one of its arguments: the ask
   * carries no bytes, main opens the picker, reads the file and mints
   * `importFormData` straight into the bus, and `renderableCommandSchema` has
   * that command removed so the capability is unrepresentable rather than
   * merely unused.
   *
   * ## The format is the USER'S, and the set is smaller than the export's
   *
   * `formDataImportFormatSchema` admits JSON and FDF. XFDF needs an XML reader
   * this repository does not have, and a channel admitting a format whose apply
   * refuses is a control that does nothing wearing a working one's clothes.
   *
   * ## `unreadable` COVERS THREE CAUSES, and that is a limit rather than a
   * choice
   *
   * The file may not be form data; it may name no field this document has; or
   * it may hold a value the field's type rules reject. All three are refusals
   * the **apply** makes, and an apply's refusal reason does not cross the
   * engine host's boundary — a throw there becomes `internal` with its
   * diagnostic withheld, by design (§5). So this answers one outcome for the
   * three, and the message names all three as the things to check, rather than
   * claiming a certainty this build does not have. The same limit governs every
   * shipped command that refuses on document state, including `fillFormField`.
   */
  /**
   * Writes the document's annotations to a file the user picks (ADR-0077). `document.exportFormData`'s
   * outcomes and their reasons: the file goes by the copy route, and `unrepresentable` is XFDF
   * meeting a character XML cannot carry.
   */
  'document.exportAnnotations': channel(
    'Writes the document’s annotations to a file the user picks.',
    z.object({ docId: docIdSchema, format: annotationDataFormatSchema }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative(), ...WRITTEN }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
      z.object({ kind: z.literal('unrepresentable') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Adds the annotations a file the user picks carries (ADR-0077). `document.importFormData`'s
   * outcomes: `unreadable` covers a file that is not annotation data, carries nothing exchanged,
   * or names a page this document lacks — the host's reason does not cross, so it is not guessed.
   */
  'document.importAnnotations': channel(
    'Adds the annotations from a file the user picks.',
    z.object({ docId: docIdSchema, format: annotationDataFormatSchema }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('imported'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
        historyDropped: z.number().int().nonnegative(),
      }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('unreadable') }),
      z.object({ kind: z.literal('too-large'), limitBytes: z.number().int().positive() }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Copies named marks into the annotation clipboard, which MAIN holds (2026-09-21).
   *
   * The renderer is answered with counts and never with the marks: a paste is an
   * `importAnnotations`, which carries bytes and is withheld from the renderer, so the records
   * stay with the process allowed to mint one. `version` is the one the selection was read at —
   * the handles are positions in that walk, and a document that has moved answers `stale`.
   */
  'document.copyAnnotations': channel(
    'Copies the selected annotations so they can be pasted.',
    z.object({
      docId: docIdSchema,
      page: z.number().int().nonnegative(),
      indices: z.array(z.number().int().nonnegative()).min(1).max(MAX_REMOVED_ANNOTATIONS),
      version: docVersionSchema,
    }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('copied'),
        copied: z.number().int().positive(),
        skipped: z.number().int().nonnegative(),
      }),
      z.object({ kind: z.literal('nothing-copyable') }),
      z.object({ kind: z.literal('stale') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * ONE mark's own words, whole, for an editor whose listing was cut (`cut` on `document.annotations`' entry).
   *
   * The walk lists a note sliced, as one line in a panel, and an editor that started from that slice would save it
   * over the whole. Named by the walk's handle at the version it was read at, `document.copyAnnotations`' rule: a
   * document that has moved, or a handle past its walk, answers `stale`. `whole: false` is a note past
   * `MAX_ANNOTATION_TEXT`, the most an edit can write back, which the editor says it cannot start from rather than
   * editing a slice.
   */
  'document.annotationWords': channel(
    'Reads one annotation’s own words whole, for editing.',
    z.object({
      docId: docIdSchema,
      page: z.number().int().nonnegative(),
      index: z.number().int().nonnegative(),
      version: docVersionSchema,
    }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('words'), text: z.string().max(MAX_ANNOTATION_TEXT), whole: z.boolean() }),
      z.object({ kind: z.literal('stale') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Opens one of a document's web links in the person's browser, once they have asked for it (ADR-0167).
   *
   * **The link is named, never its address**: by its place among `document.pageLinks`' answer for the page, at the
   * version that answer carried. `main` reads the address from the document in full and opens it only when
   * `isFollowable` allows its scheme, so the renderer can choose only among links the document already holds. The
   * answers that are not `opened` are each a sentence the renderer says: the document moved, no web link is there,
   * the address is too long to open as written, its scheme is not opened, or the system did not open it.
   */
  'document.openLink': channel(
    'Opens one of a document’s web links in the person’s browser, read by main from the document.',
    z
      .object({
        docId: docIdSchema,
        version: docVersionSchema,
        page: z.number().int().nonnegative(),
        index: z.number().int().nonnegative(),
      })
      .strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('opened') }),
      z.object({ kind: z.literal('stale') }),
      z.object({ kind: z.literal('no-such-link') }),
      z.object({ kind: z.literal('too-long') }),
      /** The scheme as `shownSchemeOf` says it, or `null` for an address that begins with none. */
      z.object({ kind: z.literal('scheme-refused'), scheme: z.string().max(SHOWN_SCHEME_MAX).nullable() }),
      z.object({ kind: z.literal('not-opened') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Pastes the annotation clipboard onto one page — main mints the `importAnnotations`.
   *
   * `empty` is an answer rather than an error: nothing copied yet is a state a person is in, and
   * the paste item hides itself on it anyway. `refused` is the importer refusing — the page gone.
   */
  'document.pasteAnnotations': channel(
    'Pastes the copied annotations onto a page.',
    z.object({ docId: docIdSchema, page: z.number().int().nonnegative() }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('pasted'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
        historyDropped: z.number().int().nonnegative(),
      }),
      z.object({ kind: z.literal('empty') }),
      z.object({ kind: z.literal('refused') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  'document.importFormData': channel(
    'Fills the form from a data file the user picks.',
    z.object({ docId: docIdSchema, format: formDataImportFormatSchema }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('imported'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
        historyDropped: z.number().int().nonnegative(),
      }),
      z.object({ kind: z.literal('cancelled') }),
      /** Not form data, or naming nothing here, or holding a refused value. */
      z.object({ kind: z.literal('unreadable') }),
      /** Past {@link MAX_FORM_DATA_BYTES} — refused before it is read. */
      z.object({ kind: z.literal('too-large'), limitBytes: z.number().int().positive() }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Reads one byte range of an open document, at a version the caller names.
   *
   * **This is the first document-carrying channel, so it is the one that owes
   * the L11 gate the note at the top of this file names — and the gate is
   * {@link MAX_RANGE_BYTES}, in the params schema, not a scan.**
   *
   * A range read's payload is whatever the caller asked for, so the question
   * L11 asks — *does this scale with document size?* — is decided entirely by
   * whether the ask can. Bounding it in the schema means a request for the whole
   * document is refused at the boundary, before any handler runs, by the same
   * validation that refuses a malformed one. A scan over these definitions was
   * the alternative and it is the weaker mechanism twice over: it would have to
   * decide by inspection which schemas *could* carry bytes, and it would leave
   * the unbounded request expressible and merely disapproved of (B5).
   *
   * ## The stale outcome is an OUTCOME
   *
   * A transport is bound to one `DocVersion`, and a command may bump between its
   * construction and its next ask. Byte offsets mean nothing outside the version
   * that produced them, so answering a stale offset from new bytes would build a
   * document out of two of them — a corruption with no symptom where it happens.
   * The renderer's answer is to rebuild the transport, which is ordinary, so this
   * is a variant rather than a failure code, and it carries the new version
   * **and** the new length so rebuilding costs no second round trip.
   *
   * ## No `document-busy`
   *
   * The read does not enter the lane. It mutates nothing, a page costs tens of
   * these, and queueing them behind a running command would serialise a reader
   * against itself — §2's *mutations are commands, reads are queries*. So the
   * one thing a lane can refuse is not a thing this can be refused for.
   */
  'document.readRange': channel(
    'Reads one bounded byte range of an open document at a named version.',
    z
      .object({
        docId: docIdSchema,
        /** The version the caller's transport is bound to. */
        version: docVersionSchema,
        /** First byte, inclusive. */
        begin: z.number().int().nonnegative(),
        /** Last byte, exclusive. */
        end: z.number().int().positive(),
      })
      .refine((range) => range.end > range.begin, {
        message: 'end must be greater than begin',
      })
      .refine((range) => range.end - range.begin <= MAX_RANGE_BYTES, {
        message: `a range may not exceed ${String(MAX_RANGE_BYTES)} bytes (invariant L11)`,
      }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('bytes'), bytes: z.instanceof(Uint8Array) }),
      z.object({
        kind: z.literal('stale'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
      }),
    ]),
    ['document-not-open'],
  ),

  /**
   * The view model `docs/ARCHITECTURE.md` §2 names beside the bytes.
   *
   * ## Why the renderer cannot derive this from what it already reads
   *
   * Finding OOOOO-1, measured 2026-08-30: a command's effect lands in the engine
   * session and main's canonical image is never replaced, so
   * {@link 'document.readRange'} serves the **pre-command** document for the
   * whole life of an open file. PDF.js parsing those bytes sees the rotation the
   * document was opened with, and no amount of rebinding a transport changes it.
   * §3.2 already says why that is the right way round — *PDF.js is never a
   * source of truth. It renders* — and this is the channel that makes the
   * sentence true rather than aspirational.
   *
   * ## What it carries, and why not more
   *
   * A page count and one absolute rotation per page **named in the request**.
   * **Not page sizes**: a page's box comes from `/MediaBox`, `/CropBox` and
   * their intersection rules, which PDF.js already implements in
   * `page.getViewport` — restating them here would be a second opinion that
   * agrees most of the time (B3a). Rotation is the one piece of geometry the
   * parser reads from bytes that have moved on.
   *
   * §2's other members — annotations, form fields, outline — are absent for
   * §10.4's reason rather than because the list is unfinished: a field nothing
   * reads is the display-only sin one layer down.
   *
   * ## The REQUEST names the pages, and that is invariant L11
   *
   * One rotation per page scales with the document. A channel that answered the
   * whole vector would be correct once — at open — and would become the
   * payload-scales-with-document defect the moment anything re-read it, which is
   * exactly what a renderer must do after every command. So a caller names the
   * pages it is about to draw, the same shape `document.readRange` has, and the
   * bound is {@link MAX_VIEW_MODEL_PAGES}.
   *
   * §2 describes a command *"returning a view-model delta"*. This is the same
   * property reached from the other side: the renderer asks about the window it
   * displays rather than being sent the difference. `document.execute` answers
   * with a version and a byte length, which is what tells the renderer the
   * window it is holding is stale.
   *
   * The page **count** is a scalar and always crosses. A viewer that cannot say
   * how many pages a document has cannot show a scrollbar, and one number is not
   * a payload.
   *
   * ## The version is on the ANSWER, not on the request
   *
   * `readRange` takes a version because a byte offset is only meaningful inside
   * the one that produced it, and answering a stale offset from new bytes builds
   * a document out of two. A geometry read has no offset to be wrong about: the
   * caller wants *the model as it is now*, and asking for a named version would
   * only let it ask for one that no longer exists. What it does need is to
   * recognise a **late** answer — a command can bump while this is in flight —
   * so the version the lane read it at travels back with it.
   */
  'document.viewModel': channel(
    'The geometry of the pages a renderer names, as it must draw them.',
    z.object({
      docId: docIdSchema,
      /**
       * Zero-based page indices, as {@link commandSchema} declares them.
       *
       * **Zero-based, and this is the one place both numbering schemes meet.**
       * PDF.js numbers pages from 1 and the document model indexes from 0, and
       * a renderer holding both had already sent `pages: [1]` for the first page
       * in a rotate command — a control that rotated the page after the one on
       * screen, on a build with no page navigation, where nothing could see it.
       */
      pages: z.array(z.number().int().nonnegative()).min(1).max(MAX_VIEW_MODEL_PAGES),
    }),
    z.object({
      version: docVersionSchema,
      pageCount: z.number().int().nonnegative(),
      /**
       * Degrees, snapped to a quarter turn, positionally aligned with `pages`.
       *
       * Absolute rather than relative, because `page.getViewport({ rotation })`
       * **replaces** the page's own rotation rather than adding to it —
       * measured by `proof:viewportrotation` rather than read off the
       * declaration. A model carrying the turns a command applied would draw
       * correctly on every document whose pages started at zero, which is every
       * fixture anyone reaches for first.
       */
      /**
       * BOUNDED HERE TOO, and not only by the request that produced it.
       *
       * The params already cap `pages` at `MAX_VIEW_MODEL_PAGES`, so a correct
       * handler cannot answer with more — which is an argument about the
       * handler and not a property of the boundary. L11 is about what may
       * cross, and a result schema that accepts an array of any length accepts
       * a document-sized one from a handler that got it wrong. Found by the
       * L11 sweep in `payloadBounds.test.ts`, 2026-09-03.
       */
      rotations: z.array(z.number().int().nonnegative()).max(MAX_VIEW_MODEL_PAGES).readonly(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Matches for one page, in the reading order the text substrate produced.
   *
   * ## ONE PAGE PER OPERATION, and that is L11 and §9.17 together
   *
   * A document-wide search is this channel called once per page, by the
   * renderer, which is the design rather than a cost to reduce later
   * ([ADR-0035](../../../docs/DECISIONS/0035-extracted-text-is-never-resident-in-main.md)).
   * Measured 2026-09-02: a text-heavy document's extracted text is **3.59× the
   * file size**, so `main` holding it — even transiently, since the budget is a
   * peak — is over twice its whole multiple before the canonical bytes it
   * already holds. Reading a page at a time bounds what is resident by the
   * largest page rather than by the document.
   *
   * The row's *cancellable background indexing* needs a per-page grain to cancel
   * at, so the shape the invariants force is also the shape the feature wants.
   *
   * ## `page` is ZERO-BASED, like every other page index that crosses here
   *
   * PDF.js numbers from 1. A renderer holds both and has already sent the wrong
   * one once — see `document.viewModel`'s note, which is the same trap and the
   * reason `SHOWN_PAGE` exists. A match's `page` comes back in the frame it went
   * out in, so nothing here changes numbering scheme mid-channel.
   */
  'document.searchPage': channel(
    'Matches for a query on one page, in reading order, bounded by the caller.',
    z.object({
      docId: docIdSchema,
      page: z.number().int().nonnegative(),
      /**
       * Refused when empty, at the boundary rather than in the kernel.
       *
       * Every position matches an empty query, so the honest answers are a
       * page-sized result list and a silent zero, and both are wrong. A renderer
       * with an empty search box has not asked a question yet.
       */
      query: z.string().min(1).max(MAX_QUERY_LENGTH),
      limit: z.number().int().positive().max(MAX_SEARCH_MATCHES),
      /**
       * How the query is compared — the same four the find bar offers.
       *
       * **Optional with defaults on the far side, rather than required here.**
       * The matching rule lives in one module (`@monstera/shared`'s
       * `textMatch.ts`) and its defaults are stated there; restating them in the
       * schema would be a second opinion about what an omitted flag means, and
       * the two would agree until one of them changed.
       *
       * **The pattern is NOT compiled here**, though it could be. A schema that
       * rejected an unparseable regex would answer with `internal` plus an
       * incident id — the shape reserved for a defect — for a person who has
       * typed `(` on the way to `(a)`. It is a declared failure instead.
       */
      caseSensitive: z.boolean().optional(),
      wholeWord: z.boolean().optional(),
      regex: z.boolean().optional(),
      normalise: z.enum(['nfc', 'nfkc', 'none']).optional(),
    }),
    z.object({
      version: docVersionSchema,
      matches: z
        .array(
          z.object({
            /** Index within this page's reading order, not a visual row. */
            line: z.number().int().nonnegative(),
            /** Offset within the line, in UTF-16 code units. */
            offset: z.number().int().nonnegative(),
            /**
             * The line the match ENDS in, and one past its last character there.
             *
             * A match may span a wrap — `hello` ending one line and `world`
             * beginning the next is one occurrence of `hello world`, because a
             * reader does not know where the page was broken. So the end is its
             * own pair rather than `offset + length`: a length would be an
             * offset into a string nobody holds, since the two ends index
             * different lines.
             *
             * Equal to `line` and `offset + length` for a match that did not
             * cross, which is nearly all of them — and a caller that ignores
             * these two fields is exactly as correct as it was before they
             * existed, for every match that fits on one line.
             */
            endLine: z.number().int().nonnegative(),
            endOffset: z.number().int().nonnegative(),
            /**
             * The line the match starts in, so a result needs no second call.
             *
             * **BOUNDED, and this was the L11 gap the sweep found** (2026-09-03).
             * A line's length is chosen by whoever made the PDF, so an unclipped
             * one is a payload a hostile document sets — up to
             * `MAX_SEARCH_MATCHES` times per call. `findInLines` clips to a
             * window around the match and moves `offset` with it, so the pair
             * still indexes what crossed.
             */
            text: z.string().max(MATCH_TEXT_WINDOW),
          }),
        )
        .max(MAX_SEARCH_MATCHES)
        .readonly(),
      /**
       * Whether the limit stopped the search rather than the page running out.
       *
       * **The whole reason the limit is a parameter.** Without this a caller
       * cannot tell *this page holds four matches* from *you asked for four*,
       * and a results surface would silently stop paging.
       */
      truncated: z.boolean(),
    }),
    // `search-pattern-invalid` is DECLARED rather than left to `internal`, and
    // the difference is who it is about: the other three describe the document,
    // this one describes what the user typed. An incident id and "something
    // went wrong" is the wrong answer to a regex with an unclosed bracket, and
    // a renderer that could not tell the two apart would have to show one of
    // them for both.
    ['document-not-open', 'document-busy', 'document-poisoned', 'search-pattern-invalid'],
  ),

  /**
   * One page's text as a selectable layer: every line, in reading order, boxed.
   *
   * ## Why this exists beside `document.searchPage` rather than inside it
   *
   * They answer different questions. A search answers *where is this query*, and
   * its result is a handful of matches with a window of surrounding text. A text
   * layer answers *what is on this page and where*, and a caller that got it by
   * searching for the empty string would receive the page-sized result this
   * contract already refuses.
   *
   * ## THE TEXT COMES FROM THE KERNEL'S SUBSTRATE, not from PDF.js
   *
   * PDF.js draws the page and has its own `getTextContent`, which needs no
   * channel at all — and taking it would put **two extraction paths** in one
   * application: one deciding what the user finds, one deciding what the user
   * copies. §3 says PDF.js renders and is never a source of truth, and ADR-0034's
   * K.0 bans a second extraction path.
   *
   * **Measured 2026-09-08 rather than left as a rule**
   * (`scripts/research/textLayerAgreement.mjs`), because if the two agreed the
   * rule would be cheap to obey and worth little. On five fixtures they agree on
   * three and disagree on the two that matter: a two-column page drawn row-major
   * shares **0 of 6 lines** — the substrate reads column-major, PDF.js reads
   * straight across the gutter — and a label separated from its value by a wide
   * intra-line gap shares **0 of 2**. So a PDF.js text layer would let a user
   * search for a phrase, be told it is there, select it, and copy something else.
   *
   * ## The boxes are DISPLAY space, and the renderer converts
   *
   * Not PDF user space, which is what every other geometry crossing here uses.
   * Converting main-side would mean deriving the page's box from `/MediaBox`,
   * `/CropBox` and their intersection rules — which PDF.js owns (B3a), and which
   * is exactly why `document.viewModel` carries rotations and not sizes. The
   * renderer already holds that box from the page it drew.
   *
   * These are `ViewportPoint`s at scale 1 with `/Rotate` already applied —
   * measured at all four turns, `textStructure.ts`'s `DisplayedRect`. The
   * conversion is `toPdf`, and `fromFitz` misses on every turned page.
   *
   * ## `page` is ZERO-BASED, like every other page index that crosses here
   */
  'document.pageTextLayer': channel(
    'One page’s text, in reading order, with each line’s box, bounded by the caller.',
    z.object({
      docId: docIdSchema,
      page: z.number().int().nonnegative(),
      limit: z.number().int().positive().max(MAX_TEXT_LAYER_LINES),
    }),
    z.object({
      version: docVersionSchema,
      lines: z
        .array(
          z.object({
            text: z.string().max(MAX_TEXT_LAYER_LINE),
            /** The line's box in the page's display space, at scale 1. */
            box: z.object({
              x0: z.number(),
              y0: z.number(),
              x1: z.number(),
              y1: z.number(),
            }),
          }),
        )
        .max(MAX_TEXT_LAYER_LINES)
        .readonly(),
      /**
       * Whether anything was left out — by EITHER bound.
       *
       * One flag for two limits. A caller's question is *is this the whole
       * page*, and separate flags would let a consumer handle the line count and
       * silently ship a clipped line. A copy that succeeds and is missing
       * characters nobody can see is the export-escaping defect one layer over.
       */
      truncated: z.boolean(),
      /**
       * What the page is made of, so an empty layer can say why it is empty.
       *
       * ## Three values, and the third is why this is not a boolean
       *
       * A page with no text is either a picture of text — which OCR can read —
       * or blank, which it cannot. Both answer with no lines, and a renderer
       * that offered recognition on the second would be mounting a control for
       * something that cannot happen.
       *
       * `'image-only'` rather than `'scanned'`: nothing in this build can know
       * a page came from a scanner. What is observable is a raster and no text,
       * which is what a scan looks like and also what a full-page diagram looks
       * like. The name is the observation, so a message built from it cannot
       * tell a reader something the kernel did not see.
       *
       * ## It rides here rather than on a channel of its own
       *
       * *What text is on this page* and *why is there none* are one walk of one
       * structured-text reading. A second channel would parse the page again to
       * answer the second half, and the two could then disagree across a
       * version boundary — which is the identity join §3 bans, in miniature.
       */
      kind: z.enum(['text', 'image-only', 'empty']),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * One page's word and character counts.
   *
   * ## PER PAGE, and the caller adds up — which is L11 rather than a preference
   *
   * A whole-document count is one small answer, and getting it means reading
   * every page's text. The question is where that reading happens and what
   * crosses: a channel answering *the whole document* would hold every page's
   * text somewhere while it worked, and
   * [ADR-0035](DECISIONS/0035-extracted-text-is-never-resident-in-main.md)
   * measured extracted text at **3.59× a document's bytes**.
   *
   * So a page's text is read inside the document's lane, counted, and dropped —
   * three numbers cross and the text never does. A caller walks the pages and
   * adds up, exactly as `document.searchPage`'s caller walks them, and gets
   * cancellation and progress from the same shape rather than from a second
   * mechanism inside this one.
   *
   * ## The counts themselves are the kernel's, and *what a word is* is the
   * platform's
   *
   * `Intl.Segmenter`, not a whitespace split: Chinese, Japanese and Thai are
   * written without spaces, so the naive rule reports a paragraph of them as one
   * word — and reports the document as nearly empty rather than as wrong, which
   * is the reassuring direction. Counting here rather than in the renderer also
   * keeps one answer to a question two surfaces could otherwise ask differently.
   *
   * ## `page` is ZERO-BASED, like every other page index that crosses here
   */
  'document.pageWordCount': channel(
    'One page’s word and character counts, the text never leaving the lane.',
    z.object({
      docId: docIdSchema,
      page: z.number().int().nonnegative(),
    }),
    z.object({
      version: docVersionSchema,
      /** Word-like segments, as `Intl.Segmenter` identifies them. */
      words: z.number().int().nonnegative(),
      /** Characters as Unicode code points, so a surrogate pair counts once. */
      characters: z.number().int().nonnegative(),
      /** Characters excluding whitespace — the figure most editors show. */
      charactersNoSpaces: z.number().int().nonnegative(),
      /** Lines that show something; a line holding only whitespace is not one. */
      lines: z.number().int().nonnegative(),
      /** Characters of Chinese, Japanese and Korean writing, by Unicode script (`countWords`). */
      cjkCharacters: z.number().int().nonnegative(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * One page's tagged structure: the elements, in tree order, and nothing of the
   * page's text.
   *
   * ## The structure is the engine's, read on its own request
   *
   * [ADR-0065](DECISIONS/0065-a-tagged-documents-structure-is-the-engines-read-on-its-own-request.md).
   * MuPDF's `structured` option follows the document's structure tree; the shared
   * read never asks for it, because it reorders and re-breaks the lines search and
   * the text layer read. So this is a second named read of the same page through
   * the same host channel, parsed by the same walk.
   *
   * ## Roles, nesting and counts cross; words do not
   *
   * A node is a role, the document's own name for the element, a depth and a line
   * count, so the answer is bounded by the page's tagging rather than its text — and
   * the renderer that shows it never holds the page's words
   * ([ADR-0035](DECISIONS/0035-extracted-text-is-never-resident-in-main.md)).
   *
   * ## FLAT WITH A DEPTH, which is the tree's order already
   *
   * Preorder is the structure tree's reading order, and a depth is all an indented
   * list needs, so no recursive schema has to be bounded twice.
   *
   * ## `page` is ZERO-BASED, like every other page index that crosses here
   */
  'document.pageTables': channel(
    'One page’s tables as MuPDF finds them — each cell’s text, bounded — for the Excel review grid.',
    z.object({
      docId: docIdSchema,
      page: z.number().int().nonnegative(),
    }),
    z.object({
      version: docVersionSchema,
      pageCount: z.number().int().nonnegative(),
      tables: z
        .array(
          z.object({
            rows: z
              .array(
                z
                  .array(
                    z.object({
                      text: z.string().max(MAX_TABLE_CELL_TEXT),
                      /** Longer than the bound, so shown cut short and not editable. */
                      clipped: z.boolean(),
                    }),
                  )
                  .max(MAX_TABLE_CELLS)
                  .readonly(),
              )
              .max(MAX_TABLE_CELLS)
              .readonly(),
          }),
        )
        .max(MAX_TABLE_CELLS)
        .readonly()
        .refine(
          (tables) => tables.reduce((sum, table) => sum + table.rows.reduce((cells, row) => cells + row.length, 0), 0) <= MAX_TABLE_CELLS,
          { message: `a page's tables may carry at most ${String(MAX_TABLE_CELLS)} cells` },
        ),
      /** Whether cells were left out past the bound. */
      truncated: z.boolean(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  'document.pageStructure': channel(
    'One page’s tagged structure — roles, nesting and line counts, never its text.',
    z.object({
      docId: docIdSchema,
      page: z.number().int().nonnegative(),
    }),
    z.object({
      version: docVersionSchema,
      nodes: z
        .array(
          z.object({
            /** The standard role, `P` or `H1`; empty where the engine resolved none. */
            role: z.string().max(MAX_STRUCTURE_NAME),
            /** The document's own name for the element. */
            raw: z.string().max(MAX_STRUCTURE_NAME),
            depth: z.number().int().nonnegative().max(MAX_STRUCTURE_NODES),
            /** Text lines directly inside this element. */
            lines: z.number().int().nonnegative(),
          }),
        )
        .max(MAX_STRUCTURE_NODES)
        .readonly(),
      /** Whether elements were left out or a name clipped, for `pageTextLayer`'s reason. */
      truncated: z.boolean(),
      /** Lines on the page inside no tagged element. */
      untaggedLines: z.number().int().nonnegative(),
      /** Image blocks on the page, so a page tagged only as a figure is not read as empty. */
      images: z.number().int().nonnegative(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * The document's optional-content groups.
   *
   * ## A READ, and the toggle is `document.execute`
   *
   * There is no `document.setLayerVisibility` channel and there must not be: a
   * layer's visibility lives in the document, so changing it is a **command**,
   * and commands go through the one channel that routes them with a capture and
   * an inverse. A second mutating channel would be the second wiring place — and
   * it would be one whose changes no undo could reach.
   *
   * Whole-document for `document.destinations`' reason: layers are structure,
   * read once when a document opens. And in PARTS for its reason too (ADR-0130): the renderer reads them whole.
   */
  'document.layers': channel(
    'One part of the document’s optional-content groups, with each one’s current visibility.',
    z.object({ docId: docIdSchema, from: listPartFromSchema }),
    z.object({
      version: docVersionSchema,
      layers: z
        .array(
          z.object({
            /** The layer's address, as a `setLayerVisibility` command names it. */
            index: z.number().int().nonnegative(),
            /** Shortened with an ellipsis where the document's name is longer (`shownName.ts`). */
            name: z.string().max(MAX_LAYER_NAME_LENGTH),
            visible: z.boolean(),
          }),
        )
        .max(LAYERS_PART)
        .readonly(),
      /** Where the next part begins, or `null` for the last. {@link listPartNextSchema}. */
      next: listPartNextSchema,
      /** Whether the walk stopped at its bound, on the last part only. `document.annotations`' flag. */
      truncated: z.boolean(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Pages that are the same page.
   *
   * ## A READ, and removing them is `document.execute`
   *
   * `document.layers`' rule one channel along: what a person does with this
   * list is delete pages, and deleting is a command with a checkpoint and an
   * undo. A channel that both found and removed them would be a mutating
   * second wiring place whose changes no undo could reach.
   *
   * ## The list ERRS TOWARDS MISSING duplicates, and the surface must say so
   *
   * Two pages are reported only when their content bytes are equal **and** they
   * resolve the same `/Resources` object, so pages that render identically from
   * independently built resources are absent. That is a false negative by
   * design: the action this list leads to is deletion, and the two ways of
   * being wrong are not equal.
   *
   * It also compares **content**, not annotations — two pages differing only by
   * a comment are reported as duplicates. The kernel is where that rule is
   * stated; this channel carries the result and the surface says what was
   * compared, because a list headed *duplicates* with no such sentence is one a
   * person acts on without asking.
   */
  'document.annotations': channel(
    'One part of every annotation in the document, in page order, with what kind each is.',
    z.object({ docId: docIdSchema, from: listPartFromSchema }),
    z.object({
      version: docVersionSchema,
      annotations: z
        .array(
          z.object({
            /** Zero-based, so a panel can hand it straight to a jump. */
            page: z.number().int().nonnegative(),
            /**
             * Its position among the annotations on that page, in the walk that
             * produced this answer — the half of a handle that says which one
             * ([ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)).
             *
             * **Not an index into the page's `/Annots` array.** MuPDF filters
             * widgets out of the walk, so on a page carrying form fields the
             * two differ by the number of fields above the annotation, and both
             * are in range. Nothing outside the kernel's reader derives either.
             *
             * Valid only against the `version` beside it. A command naming an
             * annotation carries that version and is refused if the document
             * has moved, because across versions this is not an identity.
             */
            index: z.number().int().nonnegative(),
            /**
             * Where it is, in **PDF user space** — the frame a draft names, so
             * a surface converts it with the `PageTransform` it already holds
             * rather than being handed a second coordinate space.
             *
             * **The bounding box, not the shape.** A line's rectangle is the
             * box its ends span; a point inside it is near the annotation
             * rather than on it. That is what the eraser hit-tests against.
             *
             * **`null` when the page displays no region**, which is a real
             * state a hostile document can produce. The annotation is still
             * listed — it is still there — and a surface that needs a place
             * skips it rather than acting on an invented one.
             */
            rect: annotationRectSchema.nullable(),
            /**
             * What it is drawn in — `/C`, `/CA` and `/BS`'s width.
             *
             * Carried so a styles panel can show what an annotation IS rather
             * than only what it is about to become. **`borderWidth` is `null`
             * where the subtype has none**: measured 2026-09-07, six of the
             * thirteen refuse `setBorderWidth` outright, and a zero here would
             * be a width a control then offers to change.
             *
             * The colour is a bare number list rather than
             * `annotationColourSchema` because a document may carry one, three
             * or four components — grey, RGB or CMYK — where this build writes
             * three. A reader is being told what is there.
             */
            style: z
              .object({
                colour: z.array(z.number().min(0).max(1)).max(4).readonly(),
                opacity: z.number().min(0).max(1),
                borderWidth: z.number().min(0).max(MAX_ANNOTATION_BORDER).nullable(),
              })
              .strict(),
            /**
             * **A closed union, not the document's `/Subtype`.**
             *
             * A subtype is a `/Name` a hostile document chooses, and a renderer
             * receiving one would have to label a string nobody anticipated —
             * which B9 forbids, since there is no message key for it. The
             * members are the kinds this build writes; everything else is
             * `other`, which is honest and which a panel has a key for.
             *
             * A member is added on the day a tool writes that kind, not before:
             * a label for something no document here produces is a string in
             * the catalogue that nothing can reach.
             *
             * **IMPORTED RATHER THAN SPELT OUT**, which it was until the sticky
             * note arrived and made the two lists disagree. `commands.ts` owns
             * *what this build writes* — the draft union is that question's
             * answer — so a second enum here was a second opinion about it
             * (B3a), and the direction that stayed quiet was a name listed here
             * that no tool produces.
             */
            kind: annotationKindNameSchema,
            /**
             * The annotation's own note, or empty.
             *
             * Almost always a FOREIGN annotation's: nothing this build writes
             * sets one, because no control collects it. That arrives with the
             * comment field, and until then a row of this build's own is
             * identified by its kind and its page.
             */
            contents: z.string().max(MAX_ANNOTATION_CONTENTS),
            /**
             * Whether **this build wrote it** — the `srcRef` mark, which is a
             * private key on the annotation's own dictionary
             * ([ADR-0043](../../../docs/DECISIONS/0043-an-annotation-this-build-wrote-carries-a-private-mark.md)).
             *
             * `false` means it came with the document, or was written by a
             * version of this build older than the scheme. The scheme is
             * one-sided by construction: we may not write onto an annotation we
             * did not author, so nothing is ever marked foreign and absence is
             * what foreign means.
             *
             * **Provenance, not permission.** A person may erase or move
             * either; this is what lets the surface say which one is about to
             * change, and what makes *annotations this build did not author* a
             * computable set rather than a sentence in an invariant.
             */
            authored: z.boolean(),
            /**
             * The walk index of the annotation this one ANSWERS, or `null`.
             *
             * PDF 32000-1 §12.5.6.2's `/IRT` with `/RT /R` — a reply, in the
             * format's own terms. Carried so a surface can show a thread rather
             * than two marks stacked on one spot: without it a reply is
             * indistinguishable from a loose note sitting on the comment it
             * answers, which is what every panel here would have drawn.
             *
             * **Resolved to a walk index on this side of the boundary**, never
             * handed over as an object number. The walk is the only identity
             * this contract has for an annotation
             * ([ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)),
             * and a raw object number would be a second one — valid against the
             * file rather than against this answer's `version`, and meaningless
             * to everything that already speaks in indices.
             *
             * **`null` also covers a reference the walk does not contain**, and
             * that is a real state rather than a defect: `/IRT` may point at a
             * widget, at an annotation on another page, or at an object that is
             * not an annotation at all. A reply to something this answer cannot
             * name is listed as an ordinary mark, which is honest — the
             * alternative is an index into a list the target is not in.
             *
             * Always on the SAME page, when it is present: `/IRT` naming a mark
             * on another page is answered as `null` for that reason, since the
             * index would be read against this entry's own page.
             */
            inReplyTo: z.number().int().nonnegative().nullable(),
            /**
             * Who made it — `/T`, or empty where the document names nobody (ADR-0103). Sliced to
             * the bound rather than refused, for `contents`' reason: a long name is still a name.
             */
            author: annotationAuthorSchema,
            /**
             * When it was made — `/CreationDate` as a UTC instant, or `null` where the document
             * carries none or one that does not parse. Never invented: a mark with no date says so.
             */
            created: annotationInstantSchema.nullable(),
            /**
             * The blend its appearance is DRAWN in — what a viewer shows, read from the appearance
             * stream rather than from the dictionary's `/BM` claim (ADR-0103).
             */
            blend: annotationBlendSchema,
            /**
             * Present and true on a STAMP WHOSE APPEARANCE DRAWS A PICTURE — what *Comment › Image* places. A picture
             * a person put on a page is this, not page content, so `document.pageObjects` never lists it; Edit
             * object's *Images* reads this to find it (the owner's item 14g). Absent on everything else, so a walk
             * that predates it reads as it did.
             */
            pictured: z.literal(true).exactOptional(),
            /**
             * Present and true where `contents` is a SLICE of longer words. A panel shows the slice; an editor reads
             * the mark's whole words through `document.annotationWords` before it starts, so no edit saves a slice
             * over a long comment.
             */
            cut: z.literal(true).exactOptional(),
            /**
             * How a TEXT MARK'S WORDS are drawn — a text box's, a typewriter's or a callout's `/DA` and `/Q` — so a
             * double-click edits them in their own box, in their own size and colour (ADR-0154 Decision 3). Absent on
             * every other kind, and on a text mark whose `/DA` says something the bounds cannot hold (an auto size,
             * for one): that one is edited on a card beside it instead, never refused.
             */
            typed: annotationWordsStyleSchema.exactOptional(),
          }),
        )
        .max(ANNOTATIONS_PART)
        .readonly(),
      /** Where the next part begins, or `null` for the last. {@link listPartNextSchema}. */
      next: listPartNextSchema,
      /**
       * Whether the walk stopped at its bound — set on the LAST part only.
       *
       * The bound is the engine host's, derived from the answer ceiling over the smallest annotation
       * (ADR-0130 Decision 3), and no real document reaches it. The flag stays for
       * `document.duplicatePages`' reason: without it a caller cannot tell *this document has that many*
       * from *the walk stopped*, and a panel claiming to list a document's comments would be listing
       * some of them.
       */
      truncated: z.boolean(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Every AcroForm field in the document, in page order.
   *
   * `document.annotations`' shape, and **a separate channel rather than a
   * member of it**, because the two walks share no entries: measured
   * 2026-09-07, a page carrying seven widgets and nothing else answers **0**
   * annotations and **7** widgets, which is
   * [ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)'s
   * filtering read from the other side. One list carrying both would need a
   * discriminator and two index spaces under one `index`, which is the shape
   * that produces a handle pointing at the wrong object.
   *
   * A READ, for `document.annotations`' reason: what a person does with a field
   * is fill it, and filling is a command.
   */
  'document.formFields': channel(
    'One part of every AcroForm field in the document, in page order, with what kind each is.',
    z.object({ docId: docIdSchema, from: listPartFromSchema }),
    z.object({
      version: docVersionSchema,
      fields: z
        .array(
          z.object({
            /** Zero-based, so a panel can hand it straight to a jump. */
            page: z.number().int().nonnegative(),
            /**
             * Its position in the WIDGET walk on that page — the half of a
             * handle that says which one, and **not** an index into `/Annots`
             * nor into the annotation walk beside it.
             *
             * Valid only against the `version` beside it, for the annotation
             * handle's reason: across versions this is not an identity.
             */
            index: z.number().int().nonnegative(),
            kind: formFieldKindSchema,
            /**
             * The fully-qualified field name.
             *
             * **Not unique, and that is the format rather than this reader.** A
             * radio group is one field with several widgets, and measured on
             * the fixture both of its widgets answer `applicant.post`. So this
             * is what a person reads, and `index` is what points — a surface
             * that keyed on the name would fill both halves of a group.
             */
            name: z.string().max(MAX_FORM_FIELD_TEXT),
            /**
             * The text of a field that has text — a text field's contents, a
             * choice field's selected options.
             *
             * **Empty for every button kind, by construction.** MuPDF's
             * `getValue()` answers a checkbox's on-state name here and a
             * radio's export value, which read like states and are not: the
             * export value is `"0"` where the options are labels. A surface
             * that matched one against the other would never match, so there is
             * no string here to mistake for a tick (B5 over a comment).
             *
             * **A LIST, and the third case is why.** A multi-select choice
             * field's `/V` is an array, and measured 2026-09-08 `getValue()`
             * answers `""` for one — so a field holding two options crossed as
             * a field holding none. Zero or one entry is what nearly every
             * field has; the array is what makes *several* sayable instead of
             * being rounded down to *empty*.
             */
            values: z
              .array(z.string().max(MAX_FORM_FIELD_TEXT))
              .max(MAX_FORM_FIELD_VALUES)
              .readonly(),
            /**
             * Whether THIS widget is the one that is on, or `null` for a field
             * that has no on-state.
             *
             * **Not `/AS`, which is what a viewer paints.** Measured
             * 2026-09-07: `@cantoo/pdf-lib`'s `check()` writes the field's `/V`
             * and leaves the widget's `/AS` at `/Off`, so a reader keyed on the
             * painted state reports a filled form as empty — on documents this
             * build itself produces. The kernel compares the field's value with
             * this widget's own on-state key, which answers a checkbox and a
             * radio group alike.
             */
            on: z.boolean().nullable(),
            /** A choice field's options, in the document's order. Empty for the rest. */
            options: z
              .array(z.string().max(MAX_FORM_FIELD_TEXT))
              .max(MAX_FORM_FIELD_OPTIONS)
              .readonly(),
            /** Whether the document forbids filling it. */
            readOnly: z.boolean(),
            /**
             * Whether a TEXT field takes line breaks (`/Ff` bit 13); false for every other kind. A surface edits one
             * in a control that keeps them, because a one-line input strips them from what it shows.
             */
            multiline: z.boolean(),
            /**
             * Where it is, in **PDF user space** — the annotation list's frame,
             * so a surface converts it with the `PageTransform` it holds.
             *
             * **`null` when the page displays no region**, and the field is
             * still listed: it is still there, and a surface that needs a place
             * skips it rather than acting on an invented one.
             */
            rect: annotationRectSchema.nullable(),
            /**
             * Present and true where a value in `values` is a SLICE of a longer one. A fill writes its whole text over
             * the field, so no surface may start an edit from a slice: it would save the slice over the rest.
             */
            cut: z.literal(true).exactOptional(),
          }),
        )
        .max(FORM_FIELDS_PART)
        .readonly(),
      /** Where the next part begins, or `null` for the last. {@link listPartNextSchema}. */
      next: listPartNextSchema,
      /** Whether the walk stopped at its bound, on the last part only. `document.annotations`' flag. */
      truncated: z.boolean(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Where one page's form fields probably are, on a page that has none.
   *
   * ## It answers CANDIDATES, and the distinction is the row's finding
   *
   * Measured 2026-09-08: **a field and an empty table cell are the same
   * rectangle.** A filled cell is not a field because it holds a value already;
   * an empty ruled box beside a label is a place to write, which is what a field
   * is — so on a blank timesheet the two are indistinguishable, and the label
   * *cell* is an assumption rather than a fact about the page.
   *
   * So this proposes and a person accepts. Accepting is one `createFormField`
   * carrying the list they ticked — one decision, one log entry, one undo.
   *
   * ## Per PAGE, unlike `document.formFields`
   *
   * The field list describes the whole form because a panel asks about all of
   * it. This feeds a review of the page in front of the reader, and walking a
   * hundred pages to offer a thousand candidates is a question nobody asked.
   *
   * ## No `document-busy`
   *
   * It mutates nothing, which is `document.searchPage`'s argument: queueing a
   * read behind a running command serialises a reader against themselves.
   */
  'document.flatFieldCandidates': channel(
    'Proposes where a flat page’s form fields probably are.',
    z.object({ docId: docIdSchema, page: z.number().int().nonnegative() }),
    z.object({
      version: docVersionSchema,
      candidates: z
        .array(
          z.object({
            /** Where it would go, in PDF user space. */
            rect: annotationRectSchema,
            /** The text beside it, as a person reads it. */
            label: z.string().max(MAX_FLAT_FIELD_LABEL),
            /** A name derived from the label, unique within this answer. */
            name: z.string().max(MAX_FLAT_FIELD_LABEL),
          }),
        )
        .max(MAX_FLAT_FIELD_CANDIDATES)
        .readonly(),
      /** Whether the bound stopped the walk. `document.annotations`' flag. */
      truncated: z.boolean(),
    }),
    ['document-not-open', 'document-poisoned'],
  ),

  /**
   * A page's editable text, as the **blocks** a person edits in place, carrying
   * the editing engine's own object numbering.
   *
   * ## The index is PDFium's and is never joined to anything
   *
   * `editTextBlock` names objects by their index in the page's object list, and
   * that list is the engine's own. This channel is the ONLY source of such an
   * index for text a renderer may use: a number derived from
   * `document.pageTextLayer` — MuPDF's structured text — would be two engines'
   * numbering of one page silently swapped, which is `pageNumbering.ts`' lesson
   * one frame worse. The two indices are not convertible and nothing here
   * converts them.
   *
   * ## BLOCKS, because that is what a person edits
   *
   * This answered visual lines for a dialog a person picked one from until
   * 2026-09-23, when the owner rejected the dialog: text is edited where it is
   * on the page ([ADR-0096](../../../docs/DECISIONS/0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md)).
   * Converted rather than joined by a sibling — its only consumer was that
   * dialog, and two channels answering a page's editable text in two shapes
   * would be two opinions about it.
   *
   * The grouping is the editor's own, measured into being: PDFium answers one
   * rect per run, so no engine here has an opinion about lines
   * ([ADR-0049](../../../docs/DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)),
   * and it is permitted **only while its output reaches the in-place editor a
   * person answers**. This channel is that path: a second consumer is the moment
   * the grouping has become the second extraction path Part E2 bans.
   *
   * ## Boxes, to PLACE the editor and for nothing else
   *
   * A block's box and each line's box cross in PDF user space and the renderer
   * converts them through `PageTransform`, as every overlay does. A style is
   * what the editor draws in: the page's font cannot be loaded by a renderer,
   * so a family of the same kind at the size the page draws at, in the fill.
   *
   * ## Each line carries its RUNS, not one string — and each run its STYLE
   *
   * A run is a text object with its own font, and an edit names objects. The
   * runs travel and the surface joins them with `lineText` for display — the
   * same function the kernel diffs with, so the words shown and the words
   * diffed are one opinion. Each run carries how it is set and the editor
   * draws it so ([ADR-0145](../../../docs/DECISIONS/0145-the-text-editor-shows-each-run-in-its-own-style.md));
   * the block's own style is one of its runs', the base for text that belongs
   * to no run.
   *
   * ## `engine-unavailable` is declared here for `document.execute`'s reason
   *
   * The engine that answers this is the one that applies the edit, so an
   * installation without it cannot answer either — and the read is where a
   * surface finds out first, before offering anything.
   */
  'document.textBlocks': channel(
    'One part of a page’s editable text as blocks, in the editing engine’s own object numbering.',
    z.object({ docId: docIdSchema, page: z.number().int().nonnegative(), from: listPartFromSchema }),
    z.object({
      version: docVersionSchema,
      /** Where the next part begins, or `null` for the last. {@link listPartNextSchema}. */
      next: listPartNextSchema,
      blocks: z
        .array(
          z
            .object({
              box: pdfBoxSchema,
              lines: z
                .array(
                  z
                    .object({
                      /**
                       * The runs this line is made of, in reading order. At least one:
                       * a line with no runs is not a line.
                       */
                      runs: z
                        .array(
                          z
                            .object({
                              /** The object's index in the engine's own page-object order. */
                              index: z.number().int().min(0).max(MAX_OBJECT_INDEX),
                              /** What that run says, with the spaces PDFium infers between words. */
                              text: z.string().max(MAX_RUN_TEXT),
                              /**
                               * How THIS run is set, which the editor draws it in (ADR-0145): a line of a bold lead
                               * word and a regular rest is two runs in two styles, and the block's own style is one.
                               */
                              style: textBlockStyleSchema,
                            })
                            .strict(),
                        )
                        .min(1)
                        .max(MAX_EDIT_RUNS)
                        .readonly(),
                      box: pdfBoxSchema,
                    })
                    .strict(),
                )
                .min(1)
                .max(MAX_EDIT_RUNS)
                .readonly(),
              /** The block's base: its first line's longest run's style, for a paste and a line typed below. */
              style: textBlockStyleSchema,
            })
            .strict(),
        )
        .max(TEXT_BLOCKS_PART)
        .readonly(),
      /** Whether the engine's walk stopped at its bound, on the last part only. `document.annotations`' flag. */
      truncated: z.boolean(),
      /**
       * Characters on this page set at an angle, which are not offered for editing
       * in place — an editor cannot be placed along an axis the page is not set on.
       */
      rotated: z.number().int().nonnegative(),
      /**
       * Characters on this page that no editing command can name.
       *
       * **Text inside a Form XObject**, which is how Office and InDesign emit
       * it. Measured 2026-09-10: the page's object walk reports the XObject as
       * one `form` object and does not descend, while `FPDFText` extracts every
       * character — so 36 of a fixture's 60 belonged to objects no command can
       * name. `BUILD-PROMPT.md`:278's *normalize-then-edit* is what closes it,
       * and until then this is what stops the gap being silent.
       *
       * It is a COUNT and not a list, because the thing it counts is precisely
       * what could not be turned into addressable runs. A surface owes the
       * reader a sentence when it is non-zero; it cannot offer them a row.
       */
      unaddressable: z.number().int().nonnegative(),
    }),
    ['document-not-open', 'document-poisoned', 'engine-unavailable'],
  ),

  /**
   * Every object on a page — text, paths, images — in the editing engine's own
   * numbering.
   *
   * ## Not `document.textLines` with a filter, and the difference is the ROW
   *
   * That one answers a page's editable TEXT, grouped into lines a person
   * confirms. This one answers the page's *things*: an image and a path have no
   * text at all and are exactly what object-level editing exists to move,
   * resize, recolour and remove. One channel would answer both badly.
   *
   * ## The index is PDFium's, and it is never joined to anything
   *
   * `document.textLines`' rule unchanged: the two engines number one page
   * differently, and this is one of the only two sources of a PDFium index a
   * renderer may use.
   *
   * ## A BOX and a KIND, because that is how a person picks a thing
   *
   * An object is named to a person by where it is and what it is — *the image
   * at the top of the page* — which is what a box in the page's own coordinates
   * and a word like `image` give a surface to render. The kind is a word rather
   * than PDFium's 0–5, for `document.textLines`' reason: a number reaching a
   * chooser is the defect the line row closed.
   *
   * **It carries no text**, and the consequence is stated rather than hidden: a
   * text object is offered here by its position, not its words. Editing words
   * is `document.textLines`' row, and putting the text on both channels would
   * be two answers to *what does this object say*.
   *
   * ## The fill may be ABSENT, which is not black
   *
   * PDFium declines to describe some objects' fill, and *this engine will not
   * say* is a different fact from *it is black*. A surface starting a colour
   * picker at a guess would offer a recolour to something it has been told
   * nothing about.
   */
  'document.pageObjects': channel(
    'One part of the objects on a page, with each one’s kind, box and fill, in the editing engine’s numbering.',
    z.object({ docId: docIdSchema, page: z.number().int().nonnegative(), from: listPartFromSchema }),
    z.object({
      version: docVersionSchema,
      /** Where the next part begins, or `null` for the last. {@link listPartNextSchema}. */
      next: listPartNextSchema,
      objects: z
        .array(
          z.object({
            index: z.number().int().nonnegative(),
            kind: z.enum(['unknown', 'text', 'path', 'image', 'shading', 'form']),
            /** The box in the page's own coordinates, after the object's matrix. */
            left: z.number(),
            bottom: z.number(),
            right: z.number(),
            top: z.number(),
            fill: z
              .object({
                red: z.number().int().min(0).max(255),
                green: z.number().int().min(0).max(255),
                blue: z.number().int().min(0).max(255),
                alpha: z.number().int().min(0).max(255),
              })
              .nullable(),
          }),
        )
        .max(PAGE_OBJECTS_PART)
        .readonly(),
      /** Whether the engine's walk stopped at its bound, on the last part only. `document.annotations`' flag. */
      truncated: z.boolean(),
    }),
    ['document-not-open', 'document-poisoned', 'engine-unavailable'],
  ),

  /**
   * One page drawn by the EDITING engine, as PNG bytes.
   *
   * ## §6.1's setting, and it is a second opinion rather than a better one
   *
   * Amended 2026-09-10 on two measurements. `pdfiumRender.mjs` found that the
   * only reference-free metric ranks hinting rather than accuracy, so *which is
   * better* has no answer available here; `pdfiumAgainstPdfjs.mjs` then compared
   * this engine against PDF.js pixel for pixel — **12.716 levels of mean
   * difference over inked pixels, 1.84% of the canvas differing**. They differ
   * materially, and difference is not quality. What the setting is for is a
   * reader whose document one rasteriser draws badly trying the other.
   *
   * ## THE SECOND SANCTIONED BYTE CROSSING, and its bound is the CALLER'S
   *
   * [ADR-0031](../../../docs/DECISIONS/0031-the-renderer-reads-the-document-by-demand-paged-ranges.md)
   * bans a *snapshot* of the document and permits a raster under a caller-stated
   * maximum; L11 is *per operation*. So the renderer states the device size it
   * needs — it is the only side that knows its canvas — and both ends are
   * bounded: `MAX_RASTER_PIXELS` caps the work, `MAX_RASTER_BYTES` caps the
   * answer. Neither is a function of the document's size, which is what L11
   * asks.
   *
   * The two bounds are not redundant. A pixel cap alone leaves the answer
   * unbounded, because a PNG's size depends on what is on the page: a
   * photograph compresses to nearly its raw size where a page of text does not.
   * A byte cap alone would let a caller ask for a raster that costs minutes to
   * produce and is then refused.
   *
   * ## PNG rather than raw, which is a size decision and not a format preference
   *
   * The engine produces BGRA and the shell encodes. A page at device scale is
   * 1191×1684×4 — eight megabytes of structured clone per page per scroll
   * position — against tens of kilobytes for the same page as PNG, and the
   * renderer decodes it with `createImageBitmap`, which is Chromium's own.
   * ADR-0031 permits a raster to cross; it does not require it to be raw.
   */
  'document.renderPage': channel(
    'One page drawn by the editing engine, at the size the caller states, as PNG bytes.',
    z.object({
      docId: docIdSchema,
      page: z.number().int().nonnegative(),
      /**
       * The size in DEVICE pixels, which is the renderer's own frame.
       *
       * Not a scale: `devicePixelRatio × zoom` is a number only the renderer
       * holds, and a size derived in main from a scale would agree with the
       * canvas on one display and differ on every other — `SHOWN_PAGE`'s defect
       * with pixels in place of page indices.
       */
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    z.object({
      version: docVersionSchema,
      /** The size actually drawn, which a caller compares against what it asked. */
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      /** The page as PNG. Bounded, and the bound is a refusal rather than a crop. */
      png: z.instanceof(Uint8Array).refine((bytes) => bytes.length <= MAX_RASTER_BYTES, {
        message: `a raster larger than ${String(MAX_RASTER_BYTES)} bytes`,
      }),
    }),
    // `raster-too-large` IS ITS OWN CODE rather than `internal`, because it is
    // an OUTCOME a caller can act on: ask for fewer pixels. An incident id for a
    // person who zoomed in would be a defect's answer to a working build.
    ['document-not-open', 'document-poisoned', 'engine-unavailable', 'raster-too-large'],
  ),

  /**
   * The fonts the editor draws a block's runs in, rebuilt by the PDFium host from the runs' own programs
   * ([ADR-0175](../../../docs/DECISIONS/0175-the-typing-box-draws-a-run-in-its-own-font-rebuilt-in-the-host.md)): the
   * third sanctioned byte crossing, beside `document.readRange` and this one's neighbour `document.renderPage`.
   *
   * Never the document's program. ONE READ PER BLOCK, each font once however many runs share it: every read writes the
   * document's image for the host and opens it there, so a read per run cost a block's run count in whole-image writes.
   * A run with no font — not embedded, not an sfnt, or glyphs that do not read as the page's — is `null` and the editor
   * draws it in its kind of face. Read when the editor opens over a block, never in `document.textBlocks`, whose parts
   * outline every page.
   */
  'document.runFonts': channel(
    'The fonts a block’s runs are drawn in, rebuilt by the editing engine from the runs’ own programs, each once.',
    z.object({
      docId: docIdSchema,
      page: z.number().int().nonnegative(),
      /** The runs' first objects, as `document.textBlocks` named them. */
      indices: z.array(z.number().int().min(0).max(MAX_OBJECT_INDEX)).min(1).max(MAX_FONT_RUNS).readonly(),
    }),
    z
      .object({
        version: docVersionSchema,
        /** The rebuilt fonts, each bounded in the predicate where the payload sweep can name it. */
        fonts: z
          .array(
            z.instanceof(Uint8Array).refine((bytes) => bytes.length > 0 && bytes.length <= MAX_RUN_FONT_BYTES, {
              message: `a run font empty or larger than ${String(MAX_RUN_FONT_BYTES)} bytes`,
            }),
          )
          .max(MAX_BLOCK_FONTS)
          .readonly(),
        /** For each run asked about, in the order asked, its font's place in `fonts`, or `null` for none. */
        runs: z
          .array(z.number().int().min(0).max(MAX_BLOCK_FONTS - 1).nullable())
          .max(MAX_FONT_RUNS)
          .readonly(),
      })
      .refine((answer) => answer.runs.every((at) => at === null || at < answer.fonts.length), {
        message: 'a run names a font the answer does not carry',
      }),
    ['document-not-open', 'document-poisoned'],
  ),

  'document.duplicatePages': channel(
    'Groups of pages whose content and resources are identical.',
    z.object({ docId: docIdSchema }),
    z.object({
      version: docVersionSchema,
      groups: z
        .array(
          z.object({
            /**
             * Zero-based indices, ascending. Always at least two.
             *
             * Bounded by the same number as the outer array, and both bounds
             * are real rather than defensive: one group of every page is the
             * scanned-bundle shape, and one page per group is impossible —
             * a group of one is not a group — so neither array alone tells you
             * how much may cross.
             */
            pages: z
              .array(z.number().int().nonnegative())
              .min(2)
              .max(MAX_DUPLICATE_PAGES)
              .readonly(),
          }),
        )
        // AT MOST HALF, because a group is at least two pages. Written as the
        // arithmetic rather than as `2048` so the relationship survives a
        // change to either number — a second literal here is a bound that
        // stops meaning *half* the first time somebody edits one of them.
        .max(MAX_DUPLICATE_PAGES / 2)
        .readonly(),
      /**
       * Whether {@link MAX_DUPLICATE_PAGES} stopped the report.
       *
       * `document.searchPage`'s flag and its reason: without it a caller cannot
       * tell *this document has that many* from *you asked for that many*, and
       * a surface offering to remove them all would remove some of them and say
       * it had finished.
       */
      truncated: z.boolean(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * The document's named destinations, as its outline states them.
   *
   * ## WHOLE-DOCUMENT, answered in PARTS
   *
   * An outline scales with the number of headings an author wrote, and a long manual's is long, so it crosses a part
   * at a time ({@link listPartFromSchema}, ADR-0130): each call is bounded — invariant 11 is *per operation* — and the
   * outline is as long as the document's. Until 2026-10-01 it crossed whole up to 4,096 entries and the walk cut the
   * rest in silence.
   *
   * ## Flat with a depth, not a tree
   *
   * The outline nests and a panel renders rows. Carrying the nesting would put
   * the same tree walk in every consumer, and the first thing each would do is
   * flatten it. The order is the document's own, depth-first; nothing sorts,
   * because an outline's order is authored.
   */
  'document.destinations': channel(
    'One part of the document’s outline, flattened, with each entry’s resolved page.',
    z.object({ docId: docIdSchema, from: listPartFromSchema }),
    z.object({
      version: docVersionSchema,
      destinations: z.array(outlineEntrySchema).max(DESTINATIONS_PART).readonly(),
      /** Where the next part begins, or `null` for the last. {@link listPartNextSchema}. */
      next: listPartNextSchema,
      /** Whether the walk stopped at its bound, on the last part only. `document.annotations`' flag. */
      truncated: z.boolean(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * The links on one page.
   *
   * ## ONE PAGE, for `document.searchPage`'s reason
   *
   * A document-wide answer would scale with the document, which is what
   * invariant 11 forbids per operation. A links panel shows the page a reader
   * is on; a panel for a thousand-page document that fetched every link to show
   * twelve is the same defect the text substrate was measured into avoiding.
   *
   * ## The internal/external split CROSSES, and it is the security half
   *
   * Invariant 24: opening a document runs none of its content, and **no
   * external fetch until the user asks, for that item**. A renderer that had to
   * work out which links leave the document from their URIs would be a second
   * opinion about a question MuPDF answers — and every place that got it wrong
   * would be a page that fetches on open.
   *
   * An internal link carries a resolved page and no URI: a renderer needs the
   * page, and handing it the destination string as well would give it a second
   * way to act on a link it must not interpret (§3.2).
   */
  /**
   * One page's word boxes ([ADR-0137](../../../docs/DECISIONS/0137-a-words-box-is-the-engines-read-on-request.md)):
   * each line the engine walked, with its text, its box and each token's box. Side by Side pairs them with the text
   * layer's lines by `pairWordBoxes` and keeps the estimate for any line that does not pair.
   */
  'document.pageWordBoxes': channel(
    'One page’s lines with each word’s box, for marking changed words where they are printed.',
    z.object({
      docId: docIdSchema,
      /** Zero-based, as every page index that crosses this contract is. */
      page: z.number().int().nonnegative(),
    }),
    z.object({
      version: docVersionSchema,
      lines: z
        .array(
          z
            .object({
              text: z.string().max(MAX_TEXT_LAYER_LINE),
              box: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).strict(),
              boxes: z.array(z.number()).max(MAX_PAGE_WORD_BOXES * 4),
            })
            .strict(),
        )
        .max(4 * MAX_TEXT_LAYER_LINES),
      /** Whether lines were left unboxed for the bound; their words keep the estimate. */
      truncated: z.boolean(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  'document.pageLinks': channel(
    'One part of the links on one page, with internal destinations already resolved.',
    z.object({
      docId: docIdSchema,
      /** Zero-based, as every page index that crosses this contract is. */
      page: z.number().int().nonnegative(),
      from: listPartFromSchema,
    }),
    z.object({
      version: docVersionSchema,
      links: z
        .array(
          z.discriminatedUnion('kind', [
            z.object({
              kind: z.literal('internal'),
              /** Zero-based, so a caller can hand it straight to a jump. */
              page: z.number().int().nonnegative(),
              bounds: linkBoundsSchema,
            }),
            z.object({
              kind: z.literal('external'),
              /**
               * The URI as the document carries it, shortened with an ellipsis past {@link MAX_LINK_URI_LENGTH}.
               *
               * **Nothing on either side follows it.** A renderer shows it and
               * asks; opening it is a separate action a person takes, which is
               * what invariant 24 means by *for that item*.
               */
              uri: z.string().max(MAX_LINK_URI_LENGTH),
              bounds: linkBoundsSchema,
            }),
          ]),
        )
        .max(PAGE_LINKS_PART)
        .readonly(),
      /** Where the next part begins, or `null` for the last. {@link listPartNextSchema}. */
      next: listPartNextSchema,
      /** Whether the walk stopped at its bound, on the last part only. `document.annotations`' flag. */
      truncated: z.boolean(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Everything the last run stored, for the renderer to hydrate from.
   *
   * **A setting is not a document**, so none of §6's per-document machinery
   * applies: there is one set for the application, it is the user's, and it
   * survives every document being closed.
   *
   * ## The value shape is `unknown`, and that is the boundary being honest
   *
   * Every other channel here validates its payload precisely. This one cannot,
   * and pretending otherwise would be the defect: what a settings file holds is
   * whatever a *previous build* wrote, so a schema stated here would be this
   * build's opinion about last build's data — and a value it refused would be
   * dropped by the boundary before the one component that knows how to read it
   * ever saw it.
   *
   * The registry is the writer of record for what a stored value means (B3a):
   * `SettingsRegistry.read` runs `migrate`, validates, and falls back to the
   * default when a value cannot be salvaged. So the channel's job is to carry
   * the bytes faithfully and the registry's job is to decide what they were,
   * which is one opinion rather than two.
   *
   * `z.record` still refuses a non-object, which is the part that IS this
   * boundary's business: a settings file holding an array or a string is
   * corrupt in a way no registration can migrate.
   *
   * ## No failure codes
   *
   * A settings file that does not exist yet is a first launch, and an
   * unreadable one is a corrupt file the user cannot act on — both answer with
   * the defaults, which is what an empty object is. Declaring `absent` here
   * would put a decision in the renderer that main has already taken correctly.
   */
  'settings.load': channel(
    'Everything the previous run stored, unvalidated, for the registry to read.',
    z.object({}),
    z.object({ stored: z.record(z.string(), z.unknown()) }),
  ),

  /**
   * Stores the whole settings object.
   *
   * ## THE WHOLE OBJECT, not one id at a time
   *
   * A per-id channel would make the file the sum of a sequence of writes, so an
   * interrupted sequence leaves a state no single write produced — and a
   * setting removed from the registry would need its own deletion message to
   * ever leave the file. Sending everything makes the stored document a
   * function of the store's current state, which is the only shape where
   * "what is on disk" has one answer.
   *
   * It is also within L11 by the same reasoning `document.execute` is: this
   * scales with the number of registered settings, never with a document.
   *
   * ## `secret` SETTINGS ARE NOT INCLUDED, corrected 2026-09-10
   *
   * This said they were, *deliberately*, on the ground that §7 excludes secrets
   * from **export** and a user who set an API key expects it to survive a
   * restart. The second half of that is right and the conclusion was wrong: a
   * key surviving a restart does not require it to be in this document, and
   * `BUILD-PROMPT.md` E5 says where it does belong — **`safeStorage`**, which
   * appeared nowhere under `packages/` or `apps/` until Stage 6 needed it.
   *
   * So a secret goes through {@link SETTINGS_SECRET_CHANNELS} instead, and this
   * payload carries none. **The shape is the mechanism** (B5): a value that
   * never travels on this channel cannot land in `settings.json`, where a
   * `secret: true` flag read at the wrong end would have been a rule somebody
   * remembers. `SettingsStore.exportable()` is a third projection and stays
   * separate — export, storage and *what the renderer holds* are three
   * questions, and each has one answer.
   */
  'settings.save': channel(
    'Replaces the stored NON-SECRET settings with the values the renderer holds.',
    z.object({
      // A SECRET ID IS REFUSED HERE, not stripped. Stripping would store the
      // rest and answer `stored: true`, and the caller that sent a key would
      // never learn it had been handed to the wrong channel.
      values: z
        .record(z.string(), z.unknown())
        .refine((values) => SECRET_SETTING_IDS.every((id) => !(id in values)), {
          message: 'a secret setting travels on settings.saveSecret, never on settings.save',
        }),
    }),
    z.object({ stored: z.literal(true) }),
  ),

  /**
   * Which secret settings are stored, plus whether this machine can store one.
   *
   * ## `available` is a state, not an error
   *
   * `safeStorage` needs an OS keyring, and on a machine that has none —
   * a Linux session with no keyring daemon, an account whose credential store
   * is unavailable — encryption is simply not offered. A build that treated
   * that as a failure would report an incident for a condition the person
   * cannot act on and did not cause; one that treated it as *no secrets stored*
   * would silently forget an API key every launch.
   *
   * So it crosses as a fact the surface can render: the field says *this
   * machine cannot keep a key for you*, which is `spelling.dictionary`'s
   * `available: false` on a different subject.
   *
   * ## NO VALUE CROSSES, and this said the opposite until 2026-09-12
   *
   * It answered every secret decrypted, on the ground that *the renderer needs
   * the value to put in a box a person edits*. `BUILD-PROMPT.md` E5 had already
   * ruled the other way — a write-only field with a `••••` placeholder, where
   * *the UI can replace or remove a key but never read it back* — and a key in
   * renderer state is there whatever a field draws
   * ([ADR-0056](../../../docs/DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)).
   * So what crosses is which declared secrets are stored, and the box a person
   * edits starts empty with a placeholder saying one is.
   */
  /**
   * The models one provider offers, fetched where it can be and answered from what this
   * build knows where it cannot ([ADR-0081](../../../docs/DECISIONS/0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md)).
   *
   * **The key never crosses**: the renderer names a provider and `main` reads the stored
   * secret. `source` says where the list came from, because a person choosing a model is
   * owed the difference between *this is what your provider offers* and *this is what I
   * know offline*.
   */
  'ai.models': channel(
    'Which models a provider offers, and whether the list was fetched or is this build’s own.',
    z.object({ provider: z.enum(AI_PROVIDER_IDS) }).strict(),
    aiModelListSchema,
  ),

  /**
   * Every provider's list as `main` ALREADY HOLDS it — the one it last fetched this session, or else this build's
   * fallback — and **never a request to a provider** ([ADR-0117](../../../docs/DECISIONS/0117-an-ai-model-is-chosen-per-provider-from-the-fetched-list.md),
   * corrected 2026-09-28). The Settings dialog is props-only (ADR-0038), so it opens with this; a query that fetched
   * would hold the dialog on the network, and an exhaustive record means a provider cannot be missing from it.
   */
  'ai.models.held': channel(
    'Every provider’s model list as main holds it now, fetched this session or the fallback; asks no provider.',
    z.object({}).strict(),
    z.record(z.enum(AI_PROVIDER_IDS), aiModelListSchema),
  ),

  /**
   * Checks a key a person typed against its provider, and stores it ONLY if the provider accepts it.
   *
   * The check is the model list (the owner's ruling, 2026-09-21), asked with the CANDIDATE key rather
   * than the stored one. First-run setup used to store the key, ask, and remove it on a refusal —
   * which, with a working key already stored, replaced it with a typo and then deleted both. Here a
   * refused key never reaches the store, so the key a person had is the key they still have.
   * `accepted: false` carries the provider's reason; a provider with no list (`no-list`) is accepted,
   * because its first question is then the check.
   */
  'ai.checkKey': channel(
    'Checks a typed key with the provider and stores it only when the provider accepts it.',
    z
      .object({
        provider: z.enum(AI_PROVIDER_IDS),
        key: z.string().min(1).max(MAX_SECRET_SETTING),
        /** Azure OpenAI's resource address, checked with the key; empty for every other provider. */
        endpoint: z.string().max(MAX_LINK_URI_LENGTH).optional(),
      })
      .strict(),
    z.discriminatedUnion('accepted', [
      z.object({
        accepted: z.literal(true),
        /**
         * Whether the provider was ASKED and confirmed the key. `false` for a provider with no list to ask, whose key
         * is kept unchecked — so a confirmation that says *your key works* is said only where it was found to.
         */
        checked: z.boolean(),
      }),
      z.object({
        accepted: z.literal(false),
        problem: z.enum(AI_LIST_PROBLEMS),
      }),
    ]),
    ['secret-storage-unavailable'],
  ),

  /**
   * A document's saved conversation (ADR-0093), by `DocId`: `main` finds the file's entry by a digest
   * of its path, which never crosses. Empty when nothing is saved, when saving is off, or when this
   * machine cannot decrypt what was.
   */
  'ai.history.load': channel(
    'The saved assistant conversation for an open document, if chat history is on.',
    z.object({ docId: docIdSchema }).strict(),
    z.object({ turns: savedTurnsSchema }),
    ['document-not-open'],
  ),

  /**
   * Replaces a document's saved conversation; an empty list removes it (ADR-0093). `saved: false`
   * when chat history is off — `main` reads the setting itself, so a renderer that asked anyway
   * stores nothing.
   */
  'ai.history.save': channel(
    'Saves an open document’s assistant conversation, when chat history is on.',
    z.object({ docId: docIdSchema, turns: savedTurnsSchema }).strict(),
    z.object({ saved: z.boolean() }),
    ['document-not-open', 'secret-storage-unavailable'],
  ),

  /** Removes every saved conversation — Settings › Privacy's *Clear chat history* (ADR-0093). */
  'ai.history.clear': channel(
    'Removes every saved assistant conversation.',
    z.object({}).strict(),
    z.object({ cleared: z.number().int().nonnegative() }),
  ),

  /**
   * Asks the assistant, and streams the answer on `ai.delta` / `ai.done`
   * ([ADR-0082](../../../docs/DECISIONS/0082-main-may-push-on-declared-event-channels.md)).
   *
   * **This answers when the request has STARTED**, not when the answer is finished: the
   * answer arrives on the event channels, addressed to the `subscription` the renderer
   * minted and passes here. A second ask on a live subscription is refused rather than
   * interleaved — two answers typing into one conversation is not a state a person can
   * read.
   */
  'ai.ask': channel(
    'Starts an assistant answer; its text arrives on the ai.delta and ai.done events.',
    z
      .object({
        subscription: subscriptionIdSchema,
        provider: z.enum(AI_PROVIDER_IDS),
        model: z.string().min(1).max(MAX_MODEL_ID),
        messages: z
          .array(
            z
              .object({
                role: z.enum(['user', 'assistant']),
                text: z.string().min(1).max(MAX_CHAT_TEXT),
              })
              .strict(),
          )
          .min(1)
          .max(MAX_CHAT_TURNS),
        /**
         * What the ask is about (ADR-0088). Absent is a conversation with no document in it;
         * present, `main` reads the scope's text into a bounded window for this ask alone.
         */
        about: askAboutSchema.optional(),
        /**
         * The second document of a two-document ask (ADR-0089): the one on the right, in the
         * same scope as `about`. Each window reads half of the bound.
         */
        alongside: askAboutSchema.optional(),
        /**
         * *Document + web* (`true`) or *Document only* (`false`), the Assistant's switch (ADR-0108). REQUIRED: a
         * sender that forgot it would otherwise ask whichever way a default said, and the one that matters —
         * whether a document's text may reach a search engine — is not a default's to decide.
         */
        web: z.boolean(),
        /**
         * Files attached to this question (ADR-0135): handles `ai.attach` minted, each read by its contained reader
         * when the ask is sent. Absent and empty mean the same.
         */
        attachments: z.array(fileHandleSchema).max(MAX_ASK_ATTACHMENTS).optional(),
      })
      .strict()
      .refine((request) => new Set(request.attachments ?? []).size === (request.attachments ?? []).length, {
        message: 'an ask names each attached file once',
      })
      .refine((request) => request.alongside === undefined || pairsWith(request.about, request.alongside), {
        message: 'a second document pairs only with a different one, in the same page or document scope',
      })
      .refine((request) => namesEachOnce(request.about), {
        message: 'an ask about every open document names each document once',
      }),
    /**
     * `sent` is what the window carried, and `null` for an ask about nothing or about every open document; `alongside`
     * is the second window's, present exactly when the ask had one; `among` is each document's of an *All Open Docs*
     * ask, in its order — its window, or why it was not read (ADR-0134); `files` is each attached file's, in its order,
     * present exactly when the ask carried one (ADR-0135).
     */
    z.object({
      started: z.boolean(),
      sent: askSentSchema.nullable(),
      alongside: askSentSchema.optional(),
      among: z.array(askAmongSchema).max(MAX_ASK_DOCUMENTS).optional(),
      files: z.array(askFileSchema).max(MAX_ASK_ATTACHMENTS).optional(),
      /** Each text source's characters, present whenever the bound was divided — `askShareOf`'s answer, as applied. */
      share: z.number().int().nonnegative().max(MAX_ASK_CONTEXT).optional(),
    }),
    // THE DOCUMENT'S REFUSALS, because an ask about one reads it in its lane first — and a page
    // too large to draw within the image limits, which a picture ask refuses by name (ADR-0090).
    // `no-comments` is an ask about the comments of a document that has none to send and no file beside them: a
    // question about nothing, refused before any provider is reached (F-V1).
    ['subscription-in-use', 'document-not-open', 'document-busy', 'document-poisoned', 'page-too-large', 'no-comments'],
  ),

  /**
   * Picks files to attach to the next question (ADR-0135 Decision 1). `main` runs the picker, which takes any file
   * and several at once, and mints a handle for each: the renderer gets the handle, the name and the size to draw a
   * chip, never a path. The first `MAX_ASK_ATTACHMENTS` are kept and the rest counted in `dropped`. A cancelled picker
   * answers an empty list.
   */
  'ai.attach': channel(
    'Picks files to attach to the next assistant question.',
    z.object({}).strict(),
    z
      .object({
        files: z
          .array(
            z
              .object({
                handle: fileHandleSchema,
                name: z.string().max(MAX_DOCUMENT_NAME_LENGTH),
                bytes: z.number().int().nonnegative(),
              })
              .strict(),
          )
          .max(MAX_ASK_ATTACHMENTS),
        /** How many picked files were past the eight, counted rather than named so the answer is bounded whatever was picked. */
        dropped: z.number().int().nonnegative(),
      })
      .strict(),
    [],
  ),

  /**
   * Stops a streaming answer, by the subscription it is streaming to.
   *
   * **An `invoke`, not an unsubscribe** (ADR-0082 Decision 4): letting go of the events
   * would leave `main` asking the provider, so Stop has to reach it. Stopping a
   * subscription that is not streaming is not an error — a person may press Stop as the
   * last delta arrives.
   */
  'ai.stop': channel(
    'Stops a streaming assistant answer.',
    z.object({ subscription: subscriptionIdSchema }).strict(),
    z.object({ stopped: z.boolean() }),
  ),

  /**
   * Opens one of an answer's web sources in the person's browser (ADR-0108), **by its place, never by its address**:
   * `main` kept the addresses when the answer finished and the renderer only ever saw a title and a host, so there is
   * no URL here for a page or a provider to have written. `opened: false` is an answer `main` no longer holds (it keeps
   * the most recent ones) or a place past its list.
   */
  'ai.openSource': channel(
    'Opens one web source of an assistant answer in the browser.',
    z.object({ answer: answerIdSchema, index: z.number().int().nonnegative().max(MAX_WEB_SOURCES - 1) }).strict(),
    z.object({ opened: z.boolean() }),
  ),

  /**
   * Translates a page's editable blocks, and answers them ready to write
   * ([ADR-0097](../../../docs/DECISIONS/0097-a-page-is-translated-as-one-block-edit-and-a-font-that-cannot-carry-it-falls-back.md)).
   *
   * ## `main` reads the page, asks, and hands back an INTENT
   *
   * The blocks are read in the document's lane the way `document.textBlocks` reads them, so what
   * is sent is what the in-place editor would outline — ADR-0088's rule that a page's words are
   * read in `main` for every ask. One request goes to the named provider and model; the answer is
   * the blocks that CHANGED, each as `editTextBlock` names a block, with the version they were read
   * at. The renderer writes them with that command, so the undo, the view and the save are every
   * edit's.
   *
   * ## A refusal is an OUTCOME
   *
   * `refused` carries the provider's reason by the one list a streamed answer's end uses, and
   * `unreadable` also covers an answer that is not an array of exactly the blocks sent — which
   * could not be matched to them. `nothing-to-translate` is a page with no editable text, or one
   * already in the language asked for.
   */
  'ai.translatePage': channel(
    'Translates the editable text of one page and answers the blocks to write.',
    z
      .object({
        docId: docIdSchema,
        page: z.number().int().nonnegative(),
        provider: z.enum(AI_PROVIDER_IDS),
        model: z.string().min(1).max(MAX_MODEL_ID),
        language: z.enum(TRANSLATION_LANGUAGE_IDS),
      })
      .strict(),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('translated'),
        version: docVersionSchema,
        /**
         * The blocks to write, in `editTextBlock`'s own wire form (ADR-0142), so the renderer adds the page, the
         * version and the fit and composes nothing.
         */
        edit: blockEditSchema.refine((edit) => blockEditAgrees(edit), {
          message: 'the starts must describe the lists, and an object may be named once',
        }),
      }),
      z.object({ kind: z.literal('nothing-to-translate') }),
      z.object({ kind: z.literal('refused'), problem: z.enum(AI_ANSWER_REFUSALS) }),
    ]),
    ['document-not-open', 'document-poisoned', 'engine-unavailable'],
  ),

  'settings.loadSecrets': channel(
    'Which secret settings are stored, never their values, and whether this machine can store one.',
    z.object({}),
    z.object({
      stored: z.array(z.enum(SECRET_SETTING_IDS)).max(SECRET_SETTING_IDS.length),
      available: z.boolean(),
    }),
  ),

  /**
   * Stores one secret setting, encrypted, or says it could not.
   *
   * ## ONE AT A TIME, which is the opposite of `settings.save`'s rule
   *
   * That channel sends the whole object because the stored document must be a
   * function of the store's state. This one cannot: a whole-object write would
   * put every secret on the wire on every settings change, including the ones
   * nobody touched, and each of those is a decryption and a re-encryption for
   * no reason. A secret is also the one kind of setting a person changes
   * deliberately and rarely.
   *
   * **An empty value REMOVES it**, which is what a person clearing the box
   * means, and it keeps deletion from needing a third channel.
   *
   * ## The refusal is declared, because storage can genuinely be unavailable
   *
   * `secret-storage-unavailable` is the same condition {@link
   * SETTINGS_SECRET_CHANNELS}' loader reports as `available: false`, met from
   * the writing side. It is a refusal rather than a silent fallback to the
   * plain file: writing an unencryptable key into `settings.json` is precisely
   * the outcome this pair of channels exists to make unrepresentable.
   */
  /**
   * Writes the settings to a JSON file a person picks — `BUILD-PROMPT.md`:630's *settings
   * export/import (JSON, secrets excluded)*, the export half.
   *
   * **Secrets never travel**: `main` writes what the plain settings document holds, and a secret is
   * not in it (ADR-0056) — so the exclusion is the storage's shape rather than a filter this channel
   * has to remember. The renderer names no path and receives none; it asks, and main picks, writes
   * and says what happened.
   */
  'settings.export': channel(
    'Writes the settings, without secrets, to a JSON file the user picks.',
    z.object({}).strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('written'), settings: z.number().int().nonnegative(), ...WRITTEN }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('write-failed') }),
    ]),
  ),

  /**
   * Reads a settings file a person picks — *Export settings…*' JSON — for the renderer to apply (`BUILD-PROMPT.md`:630,
   * *"settings export/import (JSON, secrets excluded)"*).
   *
   * ## The values are the REGISTRY's to read, as `settings.load`'s are
   *
   * Main does not know which settings this build registers or what each accepts; the renderer's registry does, and it
   * migrates and validates each value on the way in, leaving out any it cannot read. So the answer is the file's
   * top-level object as it is, less two things main can refuse on its own: a file over
   * {@link MAX_SETTINGS_FILE_BYTES}, read no further than its size, and any **secret** id — a key never arrives by a
   * file, and `settings.save` would refuse the whole write that carried one.
   */
  'settings.import': channel(
    'Reads a settings file the user picks, secrets left out, for the renderer to apply.',
    z.object({}).strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('read'), values: z.record(z.string(), z.unknown()) }),
      z.object({ kind: z.literal('cancelled') }),
      /** Not a JSON object, larger than the bound, or not readable. */
      z.object({ kind: z.literal('unreadable') }),
    ]),
  ),

  'settings.saveSecret': channel(
    'Stores one secret setting through the OS credential store, or refuses.',
    z.object({
      // ONLY A DECLARED SECRET, the other half of `settings.save`'s refusal: an
      // ordinary setting written here would be encrypted into a document the
      // renderer never hydrates from, and read back as unset every launch.
      id: z.enum(SECRET_SETTING_IDS),
      value: z.string().max(MAX_SECRET_SETTING),
    }),
    z.object({ stored: z.literal(true) }),
    ['secret-storage-unavailable'],
  ),

  /**
   * One spelling dictionary's bytes, for the renderer to build a checker from.
   *
   * ## The CHECKING needs no channel; the DICTIONARY does
   *
   * `docs/FEATURES.md`' spell-check row recorded that this feature *"needs no
   * new channel at all"*, on the ground that checking is pure JavaScript at
   * 0.76 ms per page and the renderer already holds the text through
   * `usePageText`. **That half is right and it is not the whole feature.** A
   * checker needs a dictionary, and `dictionary-en` reads its two files with
   * `node:fs/promises` at module top level — so the renderer, which may never
   * import Node, cannot load it. Found by building it, which is what the row's
   * claim was owed.
   *
   * ## Why bytes rather than a built checker
   *
   * Constructing the checker costs **401 ms and +23.95 MB RSS** (measured
   * 2026-09-08, JOURNAL that date) against **0.76 ms** to check a 600-word
   * page. The cost is entirely in construction, so the object is built once and
   * held while it is wanted — and it is held **where the checking happens**,
   * which is the renderer. Building it in main would put 24 MB against §9.17's
   * tightest budget and add a round trip to every page.
   *
   * ## And main never says where it got them
   *
   * The answer is bytes and a language id. Whether main read them out of a
   * bundled dependency or a file it downloaded is invisible here, which is what
   * keeps {@link SPELLING_LANGUAGES}' open half open.
   *
   * ## `unknown-dictionary` is a refusal and not a failure
   *
   * A language this build does not ship is a decided outcome, the same shape as
   * `log.reveal`'s `revealed: false`. The schema already narrows the request to
   * a declared id, so this fires only where the id is declared and the files are
   * not — a dependency that failed to install, which a person can act on.
   */
  'spelling.dictionary': channel(
    'One spelling dictionary’s affix and word-list bytes, by language.',
    z.object({ language: spellingLanguageSchema }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('dictionary'),
        language: spellingLanguageSchema,
        /**
         * `instanceof` with a bound rather than a base64 string, for
         * `insertImagePage`'s reason: a string would cost a third more memory
         * to express the same bytes, and nothing on this path needs encoding.
         */
        affix: z.custom<Uint8Array>(
          (value) => value instanceof Uint8Array && value.byteLength <= MAX_AFFIX_BYTES,
          { message: 'not an affix file, or larger than the bound' },
        ),
        words: z.custom<Uint8Array>(
          (value) => value instanceof Uint8Array && value.byteLength <= MAX_DICTIONARY_BYTES,
          { message: 'not a word list, or larger than the bound' },
        ),
      }),
      z.object({ kind: z.literal('unknown-dictionary') }),
    ]),
  ),

  /**
   * Shows the log directory in the OS file manager.
   *
   * ## NOTHING CROSSES, in either direction, and that is the design
   *
   * The obvious spelling is `log.path` returning a string for the renderer to
   * open. It is a compile error here and would be one anywhere: a filesystem
   * path in a renderer-facing type is what invariant 2 forbids, and the reason
   * is not that this particular path is sensitive — `userData` contains the
   * user's name on Windows — but that a renderer holding one has a capability
   * the architecture says it does not have.
   *
   * So the channel is an **intent** with an empty payload. Main knows where it
   * put the log; the renderer knows only that a place exists to be shown.
   *
   * ## `revealed: false` is a state, not an error
   *
   * A log directory that does not exist yet is the ordinary case on a first
   * launch that has had nothing to report, and it is not a failure — there is
   * simply nothing to show. Answering with a declared `false` rather than a
   * failure code keeps *nothing has gone wrong yet* out of the incident log,
   * which would otherwise be the one entry a quiet run produces.
   */
  'log.reveal': channel(
    'Shows the diagnostics log in the OS file manager. No path crosses.',
    z.object({}),
    z.object({ revealed: z.boolean() }),
  ),

  /**
   * Shows a file a write just put on disk in the OS file manager — a toast's *Show in folder*.
   *
   * ## A HANDLE IN, and nothing out but whether it was shown
   *
   * `log.reveal`'s argument one step on: the renderer names what to show by the `FileHandle` the write answered
   * (`WRITTEN`), main resolves it to the path it wrote, and no path crosses either way. A file is shown selected in its
   * folder; a folder a write of many files went into is opened.
   *
   * ## `revealed: false` is a state, for `log.reveal`'s reason
   *
   * A handle main does not hold, or a file moved or deleted since it was written, is something a person did, not a
   * failure of this build, so it answers `false` and the toast says nothing more rather than raising an incident.
   */
  'file.reveal': channel(
    'Shows a file a write produced in the OS file manager, by its handle. No path crosses.',
    z.object({ handle: fileHandleSchema }).strict(),
    z.object({ revealed: z.boolean() }),
  ),

  /**
   * The crash report the start screen may offer to send (ADR-0109): the newest one not yet offered, by its file's
   * name and when it was written, or `null`. Nothing is read from inside a report to answer this.
   */
  'crashReport.pending': channel(
    'The newest crash report not yet offered, if there is one.',
    z.object({}).strict(),
    z.object({ report: z.object({ id: crashReportIdSchema, crashedAt: z.iso.datetime().max(40) }).nullable() }),
  ),

  /**
   * Opens the Windows Share sheet with the report and the diagnostics log (ADR-0109). `offered` is the sheet shown,
   * never anything sent — the person picks where it goes, or closes it. `gone` is a report no longer on disk.
   */
  'crashReport.share': channel(
    'Offers a crash report to the Windows Share sheet.',
    z.object({ id: crashReportIdSchema }).strict(),
    z.object({ outcome: z.enum(['offered', 'unavailable', 'failed', 'gone']) }),
  ),

  /** Records a report as offered without sending it, so the next start does not ask again. */
  'crashReport.dismiss': channel(
    'Stops offering a crash report.',
    z.object({ id: crashReportIdSchema }).strict(),
    z.object({ dismissed: z.boolean() }),
  ),

  /**
   * Paints the window's own controls — minimise, maximise, close — to match the title bar they sit over
   * (§10.3: *"integrated document tabs (Window Controls Overlay)"*).
   *
   * ## The renderer states the colours, because the renderer is where they are
   *
   * The title bar's background and text are tokens resolved against the theme, the user's accent and the
   * platform's high-contrast state, all in the renderer. Main holding its own copies would be a second writer
   * of the palette (B3), wrong the first time a person picked an accent. So the renderer reads what it
   * **computed** for the bar and sends that; main only applies it.
   *
   * ## Bounded to exactly what Electron's overlay takes
   *
   * `#rrggbb` in lower case, which is what the renderer's conversion produces and all `setTitleBarOverlay`
   * needs — no named colours, no alpha, nothing a CSS parser in main would have to interpret. The height is
   * a whole CSS pixel between 24 and 64: a stated bound, not a measurement — below it the controls do not
   * fit, and above it the bar would be taller than any row this design has.
   *
   * ## `applied: false` is a state
   *
   * `log.reveal`'s shape: a harness that created no window, or a shell with no window attached yet, answers
   * that nothing was painted rather than failing. A compromised renderer can choose these colours; what it
   * gains is the look of three buttons it already sits beside.
   */
  'window.titleBarOverlay': channel(
    'The colours and height of the window controls painted over the title bar.',
    z.object({
      color: z.string().regex(/^#[0-9a-f]{6}$/u, 'a colour is #rrggbb in lower case'),
      symbolColor: z.string().regex(/^#[0-9a-f]{6}$/u, 'a colour is #rrggbb in lower case'),
      height: z.number().int().min(24).max(64),
    }),
    z.object({ applied: z.boolean() }),
  ),

  /**
   * The renderer has resolved every open document, and the window may now close.
   *
   * ## The second half of a close the PLATFORM started
   *
   * The caption's ×, Alt+F4, the taskbar's *Close window*, a quit and Windows' own shutdown all
   * reach main as the window's close, which main holds and turns into the
   * `window.close-requested` event. The renderer then runs its one close path — asking *Save /
   * Don't save / Cancel* for each document with unsaved changes — and calls this only when every
   * answer let the close proceed. A Cancel anywhere means this is never called and the window
   * stays, which is the whole of the owner's *Cancel leaves everything open*.
   *
   * **It carries nothing and decides nothing in main.** The questions were the renderer's; main
   * lets the next close through. `closing: false` is a harness with no window attached.
   */
  'window.close': channel(
    'Closes the window, after the renderer has resolved every document with unsaved changes.',
    z.object({}),
    z.object({ closing: z.boolean() }),
  ),

  /**
   * The renderer is subscribed to `window.close-requested` and will answer one.
   *
   * ## Why main needs telling, and what it does before it is told
   *
   * A pushed event reaches whoever is listening WHEN IT IS SENT; `ipcRenderer` replays nothing. So
   * a close requested before the renderer's subscription exists — Windows' own shutdown moments
   * after launch, or `proof:shell`'s quit at `app.whenReady()` — reaches a page that is there and
   * hears nothing, and the gate then holds the window for an answer that cannot come (measured
   * 2026-09-19: the harness hung past 120 s). Until this call arrives the gate lets a close
   * through instead of asking, which loses nothing: documents open through the renderer, so a page
   * short of its own subscription holds none.
   *
   * Idempotent, and sent again whenever the subscription is rebuilt — the renderer's effect
   * re-runs as tabs change, and *this page is listening* is the same fact each time.
   */
  'window.closeListening': channel(
    'The renderer is listening for close requests and will answer one.',
    z.object({}),
    z.object({ acknowledged: z.boolean() }),
  ),

  /**
   * Runs one of the browser's own edit commands on what has focus in the window, exactly as its
   * chord does — the selected-text menu's *Copy*, and the menu bar's *Cut*, *Copy*, *Paste* and
   * *Select all* while a text field holds the focus (ADR-0107).
   *
   * ## Chromium's own edits, run from main, and they carry NO TEXT
   *
   * The renderer has two ways to reach the clipboard itself and neither is open to it: the async
   * clipboard API asks for `clipboard-sanitized-write` and `clipboard-read`, which ARCHITECTURE §2
   * does not grant (the window is permitted `media` alone), and `document.execCommand` is deprecated
   * and refuses a paste. `webContents.cut()`, `copy()`, `paste()` and `selectAll()` run the browser's
   * command on whatever has focus, so what moves is decided by the one thing that already decides it
   * for the chord — the browser — rather than by a string this side assembles (B3a). One channel for
   * the four, because they are one question with one answer; a channel per verb would be four
   * spellings of it. Nothing crosses but the verb. `done: false` is a harness with no window attached.
   */
  'window.edit': channel(
    'Runs the browser’s own cut, copy, paste or select all on what has focus in the window.',
    z.object({ action: z.enum(WINDOW_EDIT_ACTIONS) }).strict(),
    z.object({ done: z.boolean() }),
  ),

  /**
   * Puts a piece of text the renderer names on the clipboard — the assistant's *Copy*.
   *
   * THROUGH `main`, because the renderer may hold no permission but `media` (ARCHITECTURE §2), so its
   * own `navigator.clipboard.writeText` is refused by the window's deny-all policy — measured live,
   * `NotAllowedError: Write permission denied`, with the window focused. Writing only: the renderer
   * cannot READ the clipboard through this or any channel. Bounded by the assistant's own turn bound,
   * the longest text anything copies this way.
   */
  'window.copyText': channel(
    'Puts the given text on the clipboard.',
    z.object({ text: z.string().min(1).max(MAX_CHAT_TEXT) }).strict(),
    z.object({ copied: z.boolean() }),
  ),

  /**
   * Whether to ask for a Store rating now (the founding record's E3), answered by main's engagement record.
   *
   * **Asking is recording**: a `true` answer counts as a prompt shown — the next is three days away and the
   * fifth is the last — because the page shows it on this answer and nothing else. `false` for a build that
   * is not due, a person who reviewed, or one who turned the Settings toggle off.
   */
  'app.reviewPrompt': channel(
    'Whether to ask for a Store rating now; a yes counts as the prompt shown.',
    z.object({}).strict(),
    z.object({ due: z.boolean() }),
  ),

  /**
   * A person's answer to the rating prompt, or the title bar's *Rate Us* (E3). The ONE writer of the
   * engagement record's `reviewedAt`: *rate* opens the Store's review page and records it — the Store cannot
   * be asked whether a review was written, so this is the honest local record and says no more — *reviewed*
   * records it without opening anything, and *later* restarts the three days. *Don't ask again* is the
   * Settings toggle's value, written by the page's settings store, so it has one writer too.
   */
  'app.review': channel(
    'A person’s answer to the rating prompt, or Rate Us.',
    z.object({ action: z.enum(['rate', 'reviewed', 'later']) }).strict(),
    z.object({ opened: z.boolean() }),
  ),

  /**
   * Opens one of this project's own pages in the person's browser — the title bar's *Donate*.
   *
   * ## The renderer names a PLACE, never an address
   *
   * Invariant 2's shape, applied to a URL: the renderer holds an opaque `DocId` rather than a path
   * *because* a string it can compose is a string it can be made to compose. A parameter of
   * `z.url()` here would hand `shell.openExternal` a destination the page chose, and the guard
   * against that would be an allowlist in `main` that every future caller must remember to consult —
   * the runtime check invariant 2 rejected in favour of a type. So the parameter is a closed union of
   * places, and the addresses live in `main`, where the renderer cannot reach them (B5).
   *
   * `main` still refuses anything but HTTPS at the one route, so the two guards are independent.
   *
   * ## `opened: false` is a state, not a failure
   *
   * `log.reveal`'s shape: a destination this build has no address for — the Store listing before the
   * application is in the Store — answers that nothing was opened. A `when` predicate keeps such a
   * command off the screen in the first place; this is the second half of that, for a build where the
   * two disagree.
   */
  'app.openWebPage': channel(
    'Opens one of this project’s own pages in the person’s browser.',
    // `source` and `licences` are About's (AGPL's source offer and the third-party notices).
    z.object({ page: z.enum(['donate', 'store-listing', 'source', 'licences']) }).strict(),
    z.object({ opened: z.boolean() }),
  ),

  /**
   * Opens one of the Microsoft Store APPLICATION's own pages — *Help › Check for updates* (ADR-0107, the owner's answer
   * of 2026-09-26: the Store's *Downloads and updates* page), and the update indicator's page for this application
   * (ADR-0110).
   *
   * **A place, never an address**, `app.openWebPage`'s shape: the renderer names `updates` and `main` holds the
   * `ms-windows-store:` URI, which is not a web address and so is opened by the platform rather than by the browser
   * route's HTTPS rule. The Store updates this application; the application never installs itself (ADR-0018), so this
   * opens the page where a person sees and takes the update. `opened: false` is a build with no way to reach the Store.
   */
  'app.openStore': channel(
    'Opens one of the Microsoft Store application’s own pages.',
    z.object({ page: z.enum(STORE_PAGES) }).strict(),
    z.object({ opened: z.boolean() }),
  ),

  /**
   * What this start's update check found (ADR-0110). The first ask runs the check in main — one GET, when the
   * address is live, the build is a Store build and the setting is on — and every later ask shares its answer.
   */
  'app.updateStatus': channel(
    'What this start’s update check found.',
    z.object({}).strict(),
    z.object({ status: updateStatusSchema }),
  ),

  /**
   * Records that the person saw the security notice for the release main found. The page names no version: main
   * records its own answer's, so a page cannot acknowledge a release main did not report.
   */
  'app.acknowledgeSecurityUpdate': channel(
    'Records that the security notice was seen.',
    z.object({}).strict(),
    z.object({ acknowledged: z.boolean() }),
  ),
} as const;

export type Channels = typeof channels;
export type ChannelId = keyof Channels;

export type ChannelParams<K extends ChannelId> = ParamsOf<Channels, K>;
export type ChannelResult<K extends ChannelId> = ResultOf<Channels, K>;

/** The main-process side. Exhaustive: omitting a channel is a compile error. */
export type ContractHandlers = Handlers<Channels>;

/** The renderer side, and the shape the browser shim must implement in full. */
export type ContractClient = ClientApi<Channels>;

/** Channel ids as a runtime array, for iterating registrations. */
export const channelIds = Object.keys(channels) as readonly ChannelId[];

/**
 * The longest path a dropped file can have: Win32's extended-length limit, *"a maximum total path length
 * of 32,767 characters"* in WCHARs (Microsoft Learn, *Maximum Path Length Limitation*, read 2026-09-25).
 * The page calls the figure approximate, because the system may expand the `\\?\` prefix at run time, so
 * this is a bound on the message and not a promise that every shorter path opens; `openPath` answers that.
 * A JavaScript string's length counts the same
 * UTF-16 units, so the bound is the platform's own rather than a guess at a typical path.
 */
export const MAX_DROPPED_PATH_LENGTH = 32_767;

/**
 * The channels only the preload sends ([ADR-0099](../../../docs/DECISIONS/0099-a-dropped-file-is-opened-by-the-preload-and-its-path-never-reaches-the-page.md)).
 *
 * ## Declared and validated like every channel, and never in the page's client
 *
 * `document.openDropped` takes a PATH, which no renderer-facing type may carry (L2). So it is not in
 * {@link channels}, `ContractClient` cannot name it, and the bridge's `invoke` refuses its id at runtime —
 * the type stops page code at compile time and the refusal stops page script, which the type cannot. Main
 * registers it through the same wrapper and sender check as every other channel.
 *
 * The keys must be exactly `PRELOAD_CHANNEL_IDS`, so a preload channel declared here is one the bridge
 * already refuses.
 *
 * ## It answers what `document.open` answers, and one thing more
 *
 * A dropped file is opened through the same `openPath` as a picked one, so every outcome is `document.open`'s.
 * `no-path` is the drop's own: an empty or relative path, which is what `getPathForFile` answers for a
 * `File` that did not come from the operating system — a page-built one, or an item dragged out of another
 * program that is not a file on this computer. `cancelled` cannot happen here; it stays in the union because
 * the union is `document.open`'s, and one copy of it is the point.
 */
export const preloadChannels = {
  'document.openDropped': channel(
    'Opens a file a person dropped on the window, from the path the preload resolved.',
    z.object({ path: z.string().max(MAX_DROPPED_PATH_LENGTH) }).strict(),
    z.discriminatedUnion('kind', [...openOutcomeSchema.options, z.object({ kind: z.literal('no-path') })]),
  ),
} as const satisfies Readonly<Record<PreloadChannelId, Channel>>;

export type PreloadChannels = typeof preloadChannels;

/** Main's side of the preload channels. Exhaustive like {@link ContractHandlers}. */
export type PreloadHandlers = Handlers<PreloadChannels>;

/** Everything main registers: the renderer's channels and the preload's, wrapped and checked together. */
export type MainHandlers = ContractHandlers & PreloadHandlers;

/** What `document.openDropped` answers. */
export type DroppedOpenOutcome = ResultOf<PreloadChannels, 'document.openDropped'>;
