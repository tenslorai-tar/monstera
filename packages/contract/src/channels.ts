import { MATCH_TEXT_WINDOW } from '@monstera/shared';
import { z } from 'zod';

import { channel, type ClientApi, type Handlers, type ParamsOf, type ResultOf } from './channel.js';
import {
  MAX_ANNOTATION_BORDER,
  MAX_IMAGE_PAGES,
  MAX_REPLACED_TEXT,
  annotationKindNameSchema,
  annotationRectSchema,
  formDataFormatSchema,
  formDataImportFormatSchema,
  formFieldKindSchema,
  renderableCommandSchema,
} from './commands.js';
import { MAX_SIGNATURE_FIELD } from './commands.js';
import {
  DOCUMENT_ACCESS_VALUES,
  DOCUMENT_PASSWORD_MAX_CHARS,
  OCR_ENGINES,
  OCR_LANGUAGES,
  TROCR_SIZES,
  docIdSchema,
  docVersionSchema,
  fileHandleSchema,
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
 * ## What this refuses that is not an attack
 *
 * A document holding one object larger than this cannot be rendered: PDF.js asks
 * for the object whole, and a range cannot be answered in several calls —
 * measured, the reader completes and is deleted after the first chunk. So the
 * failure mode is real and it is the honest one, because the alternative is a
 * channel that will hand over a 300 MB object and call L11 satisfied.
 *
 * **The trigger, so this is a number with an expiry rather than a guess:** the
 * first document that fails to render with a refused range is the evidence that
 * this bound is wrong, and the fix is a measurement of what such documents
 * actually contain — not a larger round number.
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

/** {@link OCR_LANGUAGES} as a schema, derived rather than respelt. */
export const ocrLanguageSchema = z.enum(OCR_LANGUAGES);

/** {@link OCR_ENGINES} as a schema, derived rather than respelt. */
export const ocrEngineSchema = z.enum(OCR_ENGINES);

/** {@link TROCR_SIZES} as a schema, derived rather than respelt. */
export const trocrSizeSchema = z.enum(TROCR_SIZES);

/**
 * The largest download the handwriting engine can honestly ask for.
 *
 * **512 MiB, and it is a bound on a CLAIM rather than on a file.** The manifest
 * in `packages/kernel` is where the real sizes live, and this file may not
 * import it — the contract's schemas are what a hostile main's answer is checked
 * against, and a bound derived from the very table that answer comes from would
 * agree with any figure that table produced. What this refuses is a main
 * process asking a reader to agree to a gigabyte.
 *
 * Measured 2026-09-11: the larger model plus the runtime is 353,021,158 bytes,
 * so this sits above the real maximum with room for a model revision and well
 * below anything a reader would recognise as absurd.
 */
export const HANDWRITING_MAX_BYTES = 512 * 1024 * 1024;

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
 * How many links one page may report to the renderer.
 *
 * A COUNT, because each link is a declared shape whose own fields are bounded —
 * so the only unbounded axis is how many there are. Any constant satisfies
 * invariant 11; the real constraint is the lower one, and a page of a
 * link-heavy index carries hundreds rather than thousands.
 *
 * **The trigger:** the first page refused by this is the evidence the bound is
 * wrong, and the fix is a measurement of what that page contains.
 */
export const MAX_PAGE_LINKS = 4096;

/**
 * How long a link's URI may be.
 *
 * The one string in that shape a DOCUMENT controls, so it is the one that needs
 * a length. 2048 is the ceiling browsers apply to a URL in practice, which
 * makes it a bound a real document cannot legitimately cross rather than a
 * number chosen here.
 */
export const MAX_LINK_URI_LENGTH = 2048;

/**
 * How many outline entries may reach the renderer, and how long a title may be.
 *
 * The two axes a document controls. A long technical manual carries hundreds of
 * headings; four thousand is past what a panel could present and short of what
 * a hostile document could try. A 512-character heading is one a panel
 * truncates rather than one it refuses.
 *
 * **The trigger:** the first document refused by either is the evidence the
 * bound is wrong, and the fix is a measurement of what that document carries.
 */
export const MAX_DESTINATIONS = 4096;

/**
 * How many page indices an extract may name.
 *
 * A **request** bound rather than an answer bound, which is what separates it
 * from every other number here: those cap what a hostile document can make main
 * send to the renderer, and this caps what the renderer can ask main to do.
 * Extracting every page of a long document is an ordinary request, so it is
 * document-shaped rather than a small guard — what it refuses is a list that
 * could not have come from a page count.
 *
 * The kernel bounds it again against the document itself, where the count is
 * known. Two bounds because they answer different questions: *could this have
 * come from a document* and *did it come from THIS one*.
 */
export const MAX_EXTRACT_PAGES = 4096;

/**
 * How many documents one split may write.
 *
 * {@link MAX_EXTRACT_PAGES}' number, because the case that reaches it is the
 * same one: *one file per page* of a long document produces exactly as many
 * outputs as it has pages. A smaller bound here would refuse the feature's own
 * headline mode on any document past it.
 *
 * The two bounds multiply into a request that is still small — an index per
 * page, however the pages are grouped — so what this refuses is a grouping that
 * could not have come from a page count rather than a large-but-honest one.
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
 * How many layers may reach the renderer, and how long a name may be.
 *
 * Much smaller than the outline's, because the shapes differ: a design carries
 * a handful of optional-content groups where a manual carries hundreds of
 * headings. A bound copied across would be a number nobody had thought about,
 * and the number is meant to be a statement about what the thing is.
 */
export const MAX_LAYERS = 1024;
export const MAX_LAYER_NAME_LENGTH = 256;

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
 *
 * Bigger than {@link MAX_LAYERS} because the shapes differ again: a person
 * scanning a list of layers is reading a design's structure, where a person
 * looking at duplicates is about to delete them and wants the whole set.
 */
export const MAX_DUPLICATE_PAGES = 4096;

/**
 * How many annotations may cross in one answer, and how much of a note.
 *
 * {@link MAX_DUPLICATE_PAGES}' number for its reason, stated rather than
 * shared: a heavily reviewed document carries thousands of comments and is
 * ordinary rather than hostile. Two bounds that happen to agree are not one
 * bound, and tying them would move either silently.
 *
 * The note is much smaller because it is one line in a panel, and it is a
 * SLICE rather than a refusal — a note longer than this is still a note, and
 * refusing the annotation would hide it from the list it belongs in.
 */
export const MAX_ANNOTATIONS = 4096;
export const MAX_ANNOTATION_CONTENTS = 512;

/**
 * How many form fields may cross, and how much of a value, name or option list.
 *
 * {@link MAX_ANNOTATIONS}' numbers for {@link MAX_ANNOTATIONS}' reason, stated
 * rather than shared — two bounds that happen to agree are not one bound. The
 * argument is the same one form along: the largest government form anyone has
 * put in front of this build carries fields in the hundreds, and a document
 * carrying thousands is a generated pack rather than a hostile one.
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
export const MAX_FORM_FIELDS = 4096;
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
 * How many of a page's text objects one answer may name — and, because a page
 * cannot have more lines than runs, how many **lines** one answer may carry.
 *
 * A page-scaled read, bounded like every other one that crosses. **Not the
 * engine wire's `ENGINE_TEXT_OBJECTS_MAX`**, which is 8192 and bounds a
 * different hop: that one exists so a hostile host cannot hand main an
 * unbounded array, and this one exists so main cannot hand the renderer a list
 * no person can work through. The smaller number is the honest one here — a
 * chooser of 8192 rows is not a chooser — and the flag beside it says when the
 * page had more, exactly as the flat-field and duplicate reports do.
 *
 * One number for both because they bound the same collection counted two ways:
 * grouping runs into lines can only make the list shorter, so a separate line
 * bound would be a second constant that could never be the binding one.
 *
 * ## `MAX_TEXT_REPLACEMENTS`' NUMBER AND NOT ITS ARGUMENT, which is finding W-1
 *
 * A surface offers what this read answered and sends what the person accepted
 * as one `replaceTextObject`, so a read bound above the command's would offer an
 * accept the command cannot carry. That relationship is real and it is **≤**.
 *
 * This was written `= MAX_TEXT_REPLACEMENTS` on 2026-09-09, citing CLAUDE.md's
 * *copy only where the reader cannot reach the source* — and the audit of
 * `63f10be..258a9ce` found the rule that governs instead, eleven lines from
 * where the derivation was made: `MAX_REPLACED_TEXT` refuses to derive from
 * `MAX_FIELD_VALUE` because **two bounds that happen to agree are not one
 * bound**. The two reasons differ. The command's bound is about a payload; this
 * one is about a list a person works through, and a derivation encoding `=`
 * would let a payload argument raise the chooser's ceiling past *a chooser of
 * 8192 rows is not a chooser* with no mechanism left on that side.
 *
 * So it is a literal with the relationship in prose — `MAX_FLAT_FIELD_CANDIDATES`
 * beside `MAX_CREATED_FIELDS`, which is the precedent this file already had.
 */
export const MAX_TEXT_OBJECTS = 512;

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

/**
 * How long a document's name may be.
 *
 * NTFS bounds a single path component at 255 UTF-16 code units, so this is that
 * limit rather than a number chosen here — the name main sends is a file name,
 * and a bound looser than the filesystem's would be admitting a value no file
 * can have. **It bounds the string and does not shorten it**: truncating a name
 * on the way to the renderer would put a lie in the one place a reader checks
 * which document they are looking at.
 */
export const MAX_DOCUMENT_NAME_LENGTH = 255;

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
 */
export const MAX_RECENT_ENTRIES = 10;

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
const openOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({
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
  }),
  z.object({ kind: z.literal('already-open'), docId: docIdSchema }),
  z.object({ kind: z.literal('absent') }),
  z.object({
    kind: z.literal('at-capacity'),
    /** What the resident total would have become, in bytes. */
    wouldHold: z.number().int().nonnegative(),
    /** The ceiling it would have crossed. */
    ceiling: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal('cancelled') }),
]);

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
   * Whether the handwriting engine's stack is on this machine, and what the rest
   * of it would cost to fetch.
   *
   * ## Why a query rather than a setting the renderer already has
   *
   * `app.ocrLanguages`' reason, one engine along: there is no path in the
   * renderer by invariant L2 and no directory to list. But the sharper reason is
   * the **wired-tools rule**. TrOCR is never bundled, so on a first run the
   * handwriting tool would be a control that dispatches a command the engine
   * then refuses for a file that was never downloaded. The registry's `when`
   * predicate is what keeps a control that cannot work off the screen, and this
   * is what it reads.
   *
   * ## `bytesToFetch` is what is MISSING, never the total
   *
   * A reader agreeing to a download is agreeing to a number, and the honest one
   * is what will actually cross the network — a machine holding the runtime and
   * one model is most of the way there. Zero means the engine runs offline,
   * which is the state the row promises after a first fetch.
   *
   * ## No failure code
   *
   * A machine with nothing downloaded is a STATE and not a refusal —
   * `app.ocrLanguages`' empty list exactly. A build with no cache surface at all
   * answers `available: false`, which is the same shape `settings.loadSecrets`
   * uses for a machine with no keyring.
   */
  'app.handwritingCache': channel(
    'Whether the handwriting models are downloaded, and what is left to fetch.',
    z.object({ size: trocrSizeSchema }),
    z
      .object({
        /** False where this build has no cache surface at all. */
        available: z.boolean(),
        /** True when every file this size needs is present and the engine can run. */
        ready: z.boolean(),
        // BOUNDED BY THE MANIFEST'S OWN ARITHMETIC rather than by a round number:
        // the largest honest answer is every artefact of the larger model, and a
        // bound above that would let a hostile main ask a reader to agree to a
        // download nothing in this build can produce.
        bytesToFetch: z.number().int().nonnegative().max(HANDWRITING_MAX_BYTES),
      })
      .strict(),
  ),

  /**
   * Downloads whatever the handwriting engine is missing, against pinned
   * digests.
   *
   * **A command channel and not a query**, because it changes the machine: it
   * writes up to 339 MB into the reader's profile, and every byte of it is
   * verified against invariant 9's four guarantees before it lands.
   *
   * It answers the cache's state afterwards rather than `{ok: true}`, so a
   * surface shows what happened rather than that something did — and a partial
   * fetch interrupted by a refusal reports honestly what is still missing.
   *
   * **`download-refused` is its own code**, separate from the internal one: a
   * pinned digest that does not match, a host that is not on the list, a
   * response past its ceiling — those are answers about the network and the
   * artefact, and a reader can act on them (try again later) where an internal
   * failure means this build has a defect.
   */
  'app.fetchHandwritingModel': channel(
    'Downloads the handwriting runtime and models this machine is missing.',
    z.object({ size: trocrSizeSchema }),
    z
      .object({
        ready: z.boolean(),
        bytesToFetch: z.number().int().nonnegative().max(HANDWRITING_MAX_BYTES),
      })
      .strict(),
    ['download-refused', 'no-handwriting-cache'],
  ),

  /**
   * Removes the handwriting cache — `BUILD-PROMPT.md`:627's *clear caches*.
   *
   * Answers the bytes it freed, for the reason above: *done* is not something a
   * reader can check, and a control that reports 0 bytes on a machine that held
   * 300 MB is one that did not work.
   */
  'app.clearHandwritingCache': channel(
    'Removes the downloaded handwriting runtime and models.',
    z.object({}),
    z.object({ bytesRemoved: z.number().int().nonnegative() }).strict(),
    ['no-handwriting-cache'],
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
       * Empty after a clean exit — a run that finished has nothing to recover —
       * so a renderer reads this as *the offer*, and `lastExitClean` as
       * *whether to make one*. The two are separate because an unclean exit
       * with nothing recorded is a real state: a run that died before opening
       * anything.
       */
      lastSession: z
        .array(
          z.object({
            handle: fileHandleSchema,
            name: z.string().max(MAX_DOCUMENT_NAME_LENGTH),
          }),
        )
        .max(MAX_RECENT_ENTRIES)
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
   * the result union that nothing can ever produce — the shape this range's
   * audit found in `MAX_LAYERS`, a branch that reads as coverage and cannot
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

  'document.execute': channel(
    'Applies one command to an open document, returning the version it produced.',
    // THE RENDERABLE SUBSET, not the whole union. `insertImagePage` carries an
    // image main reads from a picked file, so the one channel a renderer could
    // put a command on refuses it at the boundary — the capability is
    // unrepresentable rather than merely unused. See `commands.ts`.
    z.object({ docId: docIdSchema, command: renderableCommandSchema }),
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
    ['document-not-open', 'document-busy', 'document-poisoned', 'stale-target', 'engine-unavailable'],
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
    ['document-not-open', 'document-busy', 'document-poisoned'],
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
  'document.save': channel(
    'Writes an open document’s current content to the file it was opened from.',
    z.object({ docId: docIdSchema }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('saved'), version: docVersionSchema }),
      z.object({
        kind: z.literal('refused'),
        reason: z.enum(['contested', 'replaced', 'target-absent', 'unverifiable']),
      }),
      z.object({ kind: z.literal('write-failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
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
       * Zero-based indices, in the order they should appear.
       *
       * Bounded by {@link MAX_EXTRACT_PAGES} because this crosses from the
       * renderer, and by the document itself in the kernel — a page this
       * document does not have is refused there, where the count is known.
       */
      pages: z.array(z.number().int().nonnegative()).min(1).max(MAX_EXTRACT_PAGES),
    }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative() }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
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
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative() }),
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
       * The outputs, each a non-empty list of zero-based page indices.
       *
       * Bounded on both axes: {@link MAX_SPLIT_PARTS} outputs, and
       * {@link MAX_EXTRACT_PAGES} pages in any one of them. A split of every
       * page of a long document is the ordinary case, so the first bound is the
       * document-shaped one.
       */
      groups: z
        .array(z.array(z.number().int().nonnegative()).min(1).max(MAX_EXTRACT_PAGES))
        .min(1)
        .max(MAX_SPLIT_PARTS),
    }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('split'), files: z.number().int().positive() }),
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
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative() }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
      /** A value this format cannot carry. The other two can — see above. */
      z.object({ kind: z.literal('unrepresentable') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  'document.saveCopy': channel(
    'Writes a copy of an open document to a destination the user picks.',
    z.object({ docId: docIdSchema }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('copied'), bytes: z.number().int().nonnegative() }),
      z.object({ kind: z.literal('cancelled') }),
      z.object({ kind: z.literal('refused'), openElsewhere: z.number().int().positive() }),
      z.object({ kind: z.literal('write-failed') }),
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
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
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
    }),
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('signed'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
        historyDropped: z.number().int().nonnegative(),
      }),
      z.object({ kind: z.literal('cancelled') }),
      /** The passphrase did not open the certificate. */
      z.object({ kind: z.literal('wrong-passphrase') }),
      /** The file was picked and is not a PKCS#12 this build can read. */
      z.object({ kind: z.literal('unreadable') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  'document.placeImage': channel(
    'Places an image on pages of an open document, from a file the user picks.',
    z.object({
      docId: docIdSchema,
      pages: z.array(z.number().int().nonnegative()).min(1).max(MAX_IMAGE_PAGES).readonly(),
      rect: annotationRectSchema,
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
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
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
   * read once when a document opens.
   */
  'document.layers': channel(
    'The document’s optional-content groups, with each one’s current visibility.',
    z.object({ docId: docIdSchema }),
    z.object({
      version: docVersionSchema,
      layers: z
        .array(
          z.object({
            /** The layer's address, as a `setLayerVisibility` command names it. */
            index: z.number().int().nonnegative(),
            name: z.string().max(MAX_LAYER_NAME_LENGTH),
            visible: z.boolean(),
          }),
        )
        .max(MAX_LAYERS)
        .readonly(),
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
    'Every annotation in the document, in page order, with what kind each is.',
    z.object({ docId: docIdSchema }),
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
          }),
        )
        .max(MAX_ANNOTATIONS)
        .readonly(),
      /**
       * Whether the bound stopped the walk.
       *
       * `document.duplicatePages`' flag and its reason: without it a caller
       * cannot tell *this document has that many* from *you asked for that
       * many*, and a panel claiming to list a document's comments would be
       * listing some of them.
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
    'Every AcroForm field in the document, in page order, with what kind each is.',
    z.object({ docId: docIdSchema }),
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
             * Where it is, in **PDF user space** — the annotation list's frame,
             * so a surface converts it with the `PageTransform` it holds.
             *
             * **`null` when the page displays no region**, and the field is
             * still listed: it is still there, and a surface that needs a place
             * skips it rather than acting on an invented one.
             */
            rect: annotationRectSchema.nullable(),
          }),
        )
        .max(MAX_FORM_FIELDS)
        .readonly(),
      /** Whether the bound stopped the walk. `document.annotations`' flag. */
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
   * A page's editable text, as **visual lines** carrying the editing engine's
   * own object numbering.
   *
   * ## The index is PDFium's and is never joined to anything
   *
   * `replaceTextObject` names an object by its index in the page's object list,
   * and that list is the engine's own. This channel is the ONLY source of such
   * an index a renderer may use: a number derived from `document.pageTextLayer`
   * — MuPDF's structured text — would be two engines' numbering of one page
   * silently swapped, which is `pageNumbering.ts`' lesson one frame worse. The
   * two indices are not convertible and nothing here converts them.
   *
   * ## LINES, because a run is not what a person recognises
   *
   * This channel answered `indices` alone until 2026-09-09, and the row that
   * shipped on it offered a chooser of numbers — which the row's own note said
   * was what line-level editing would close. It is closed here rather than
   * beside it, because two Edit-section controls where one obsoletes the other
   * is the second wiring place the registry exists to forbid.
   *
   * A line is several runs, measured: PDFium answers one rect per run whether
   * two runs on a baseline sit 170pt apart or 3pt apart, so no engine here has
   * an opinion about lines and the editor forms its own by vertical overlap
   * ([ADR-0049](../../../docs/DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)).
   * That ADR permits the grouping **only while its output reaches a dialog a
   * person answers**, and this channel is that path: a second consumer is the
   * moment the grouping has become the second extraction path Part E2 bans.
   *
   * ## Each line carries its RUNS, not one string
   *
   * A run is a text object with its own font, and `replaceTextObject` names
   * objects. A line that arrived as one string would have to be diffed back
   * onto runs by something holding no run boundaries — so the boundaries
   * travel, and the surface concatenates for display.
   *
   * A handle never crosses: a `FPDF_PAGEOBJECT` is owned by the page it came
   * from. The index is what survives, and the text is the page's own words
   * bounded per run and per page.
   *
   * ## `engine-unavailable` is declared here for `document.execute`'s reason
   *
   * The engine that answers this is the one that applies the edit, so an
   * installation without it cannot answer either — and the read is where a
   * surface finds out first, before offering anything.
   */
  'document.textLines': channel(
    'A page’s editable text as visual lines, in the editing engine’s own object numbering.',
    z.object({ docId: docIdSchema, page: z.number().int().nonnegative() }),
    z.object({
      version: docVersionSchema,
      lines: z
        .array(
          z.object({
            /**
             * The runs this line is made of, in reading order.
             *
             * At least one: a line with no runs is not a line, and an empty
             * entry would be a row a chooser could offer and nothing could
             * edit.
             */
            runs: z
              .array(
                z.object({
                  /** The object's index in the engine's own page-object order. */
                  index: z.number().int().nonnegative(),
                  /** What that run says. */
                  text: z.string().max(MAX_REPLACED_TEXT),
                }),
              )
              .min(1)
              .max(MAX_TEXT_OBJECTS)
              .readonly(),
          }),
        )
        .max(MAX_TEXT_OBJECTS)
        .readonly(),
      /** Whether the bound stopped the list. `document.flatFieldCandidates`' flag. */
      truncated: z.boolean(),
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
    'Every object on a page, with its kind, its box and its fill, in the editing engine’s numbering.',
    z.object({ docId: docIdSchema, page: z.number().int().nonnegative() }),
    z.object({
      version: docVersionSchema,
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
        .max(MAX_TEXT_OBJECTS)
        .readonly(),
      /** Whether the bound stopped the list. `document.flatFieldCandidates`' flag. */
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
   * ## WHOLE-DOCUMENT, and why that is not invariant 11's concern
   *
   * L11 forbids a payload that scales with the document **per operation**. An
   * outline scales with the number of headings an author wrote — a property of
   * the document's structure rather than of its size, and a thousand-page scan
   * has none. It is read once when a document opens rather than per page, so
   * there is no per-operation growth here to bound.
   *
   * The contrast with `document.pageLinks` is the point: links exist per page
   * and would grow with the document, so that channel takes one. Both are
   * bounded by count regardless, because a bound that only exists where the
   * invariant demands it is a bound nobody applies to the hostile case.
   *
   * ## Flat with a depth, not a tree
   *
   * The outline nests and a panel renders rows. Carrying the nesting would put
   * the same tree walk in every consumer, and the first thing each would do is
   * flatten it. The order is the document's own, depth-first; nothing sorts,
   * because an outline's order is authored.
   */
  'document.destinations': channel(
    'The document’s outline, flattened, with each entry’s resolved page.',
    z.object({ docId: docIdSchema }),
    z.object({
      version: docVersionSchema,
      destinations: z.array(outlineEntrySchema).max(MAX_DESTINATIONS).readonly(),
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
  'document.pageLinks': channel(
    'The links on one page, with internal destinations already resolved.',
    z.object({
      docId: docIdSchema,
      /** Zero-based, as every page index that crosses this contract is. */
      page: z.number().int().nonnegative(),
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
               * The URI exactly as the document carries it.
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
        .max(MAX_PAGE_LINKS)
        .readonly(),
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
    z.object({ values: z.record(z.string(), z.unknown()) }),
    z.object({ stored: z.literal(true) }),
  ),

  /**
   * Every secret the previous run stored, decrypted, plus whether it can store.
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
   * ## Decrypted, and that is where the boundary is
   *
   * The renderer needs the value to put in a box a person edits. Handing over
   * ciphertext would mean the renderer holding a key to decrypt it, which is
   * the whole thing `safeStorage` exists to avoid. What crosses is the plain
   * value, once, into the process that was going to render it anyway.
   */
  'settings.loadSecrets': channel(
    'Every stored secret setting, decrypted, and whether this machine can store one.',
    z.object({}),
    z.object({
      // THE KEYS ARE BOUNDED TOO, and `payloadBounds.test.ts` is what said so:
      // a record's `propertyNames` is a string a caller cannot bound unless the
      // schema does, and the ids here are this build's own registered names.
      secrets: z.record(z.string().max(MAX_SETTING_ID), z.string().max(MAX_SECRET_SETTING)),
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
  'settings.saveSecret': channel(
    'Stores one secret setting through the OS credential store, or refuses.',
    z.object({
      id: z.string().min(1).max(MAX_SETTING_ID),
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
