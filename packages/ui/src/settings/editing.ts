import {
  MAX_ANNOTATION_BORDER,
  MAX_ANNOTATION_FONT,
  MIN_ANNOTATION_FONT,
  measurePerPointSchema,
  measureUnitSchema,
  ocrLanguageSchema,
  trocrSizeSchema,
  AZURE_ENDPOINT_SETTING_ID,
  AZURE_KEY_SETTING_ID,
} from '@monstera/contract';
import { z } from 'zod';

import {
  EDITING_COLOUR_TITLE,
  EDITING_FONT_SIZE_TITLE,
  EDITING_IMAGE_PAGES_TITLE,
  EDITING_LINE_WIDTH_TITLE,
  EDITING_OPACITY_TITLE,
  EDITING_OCR_LANGUAGE_TITLE,
  EDITING_TROCR_SIZE_TITLE,
  EDITING_AZURE_ENDPOINT_TITLE,
  EDITING_AZURE_KEY_TITLE,
  EDITING_PERSONAL_DICTIONARY_TITLE,
  MEASURE_SCALE_TITLE,
  MEASURE_UNIT_TITLE,
} from '../messages/en.js';
import type { SettingDefinition } from '../registries/settings.js';

/**
 * The style a new annotation is drawn in — `BUILD-PROMPT.md`:614's *editing
 * defaults*, and the first settings in the `editing` category.
 *
 * ## They are SETTINGS and not per-document state
 *
 * A person's preferred mark colour follows them between documents, which is the
 * test `viewing.ts` states: a document has no opinion about what colour you like
 * drawing in. That is also why they survive a restart, unlike the active tool —
 * the tool is a mode you are in, and this is how you like your marks.
 *
 * ## Three shipped rows have been waiting for these BY NAME
 *
 * The headers-and-footers row owes *a font choice*, the watermark row owes
 * *colour*, and the page-background row says *a colour control, until Stage 3's
 * style controls own the picker*. Those three take the same values, which is why
 * the bounds here are the contract's rather than numbers chosen locally: a
 * control that offers a size the payload refuses is a control that fails on
 * apply.
 */

/**
 * What a new annotation is coloured.
 *
 * ## `'auto'` IS A REAL STATE, not a sentinel standing in for a missing value
 *
 * A single colour for every tool is what the founding record asks for — *editing
 * defaults: annotation color* — and applied literally it would make the
 * highlighter paint in whatever the shapes use, which is how a person ends up
 * with a red wash over the text they meant to mark. Applied per tool it would be
 * eleven settings nobody wants to keep in step.
 *
 * So the value is a choice or the absence of one. `'auto'` means *use each
 * tool's own colour* — the highlighter's yellow, the note's yellow, the caret's
 * red — which is what somebody who has never opened this control expects. Any
 * colour set here is used by every tool, which is what somebody who HAS opened
 * it expects.
 *
 * **A hex string, and this is the one place a hex belongs.** §10.2 bans a raw
 * hex in a component and names *a user-chosen annotation color* as the
 * genuinely dynamic case. This is not a component and the value is the person's.
 */
export const ANNOTATION_COLOUR_SETTING: SettingDefinition<
  z.ZodUnion<[z.ZodLiteral<'auto'>, z.ZodString]>
> = {
  id: 'editing.annotation-colour',
  title: EDITING_COLOUR_TITLE,
  schema: z.union([z.literal('auto'), z.string().regex(/^#[0-9a-f]{6}$/u)]),
  fallback: 'auto',
  category: 'editing',
};

/**
 * How opaque a new annotation is.
 *
 * The contract's own bound, imported, so the slider cannot offer a value the
 * payload refuses — and the floor is 0.1 for the reason stated there: a fully
 * transparent mark is indistinguishable from a tool that did not fire.
 */
export const ANNOTATION_OPACITY_SETTING: SettingDefinition<z.ZodNumber> = {
  id: 'editing.annotation-opacity',
  title: EDITING_OPACITY_TITLE,
  schema: z.number().min(0.1).max(1),
  fallback: 1,
  category: 'editing',
};

/** How wide a new shape's stroke is, in points. */
export const ANNOTATION_LINE_WIDTH_SETTING: SettingDefinition<z.ZodNumber> = {
  id: 'editing.annotation-line-width',
  title: EDITING_LINE_WIDTH_TITLE,
  schema: z.number().min(0).max(MAX_ANNOTATION_BORDER),
  // TWO POINTS, which is what every shape tool has hard-coded since Stage 3
  // began. The default is what shipped rather than a fresh opinion: a setting
  // arriving with a different default silently restyles every mark a person
  // makes from that day, and nothing on screen says why.
  fallback: 2,
  category: 'editing',
};

/**
 * How many units one PDF point represents on this drawing.
 *
 * `BUILD-PROMPT.md`:615's *measurement unit & scale*, and it is a **setting**
 * for the same reason its neighbours are: a person working through a set of
 * plans drawn at one scale sets it once. It is the shakiest of the five on that
 * point — the scale is a fact about the DOCUMENT rather than about the person —
 * and it is here rather than in the document's own state because nothing in the
 * file records it and a per-document store would have to invent somewhere to
 * keep it. Stated so the next reader meets the trade rather than the choice.
 *
 * **One by default, which means the reading is in the unit itself.** A point is
 * 1/72 inch, so an uncalibrated distance reads in points and is honest: nothing
 * has told this build what the drawing is.
 */
export const MEASURE_SCALE_SETTING: SettingDefinition<typeof measurePerPointSchema> = {
  id: 'editing.measure-scale',
  title: MEASURE_SCALE_TITLE,
  // THE PAYLOAD'S OWN SCHEMA, for the reason the bounds above are imported: a
  // control that accepts a number the command refuses fails on apply, and this
  // field is one a person types into.
  schema: measurePerPointSchema,
  fallback: 1,
  category: 'editing',
};

/** What unit a measurement is stated in. The contract's closed set. */
export const MEASURE_UNIT_SETTING: SettingDefinition<typeof measureUnitSchema> = {
  id: 'editing.measure-unit',
  title: MEASURE_UNIT_TITLE,
  schema: measureUnitSchema,
  fallback: 'pt',
  category: 'editing',
};

/**
 * Which pages a placed image goes on — the stamps row's **multi-page apply**.
 *
 * ## Why a setting rather than a dialog after every drag
 *
 * `docs/FEATURES.md`'s stamps row asks for *multi-page apply*, and the command
 * has taken a page list since it was written: stamping ten pages is one
 * decision, so it is one log entry and one undo. What was missing was a way for
 * a person to say so.
 *
 * A dialog after each drag would ask the question every time and the answer is
 * *this page* almost every time — which is the shape that trains people to
 * dismiss it. A setting is asked once and then it is a **mode**, which is what
 * *stamp this on every page* actually is: somebody applying a DRAFT mark to a
 * document is doing it to the document, not to page four.
 *
 * ## `'this'` is the default, and the cost of getting it wrong is asymmetric
 *
 * Placing on one page when you meant all of them is one more drag. Placing on
 * all of them when you meant one is a mark on every page of a long document,
 * removed one at a time — there is no *undo the stamps* short of the command's
 * own undo, which is the whole placement and therefore the right tool, and a
 * person who has since done something else has lost that.
 *
 * So the safe value is the default, and it is the one that matches what the
 * gesture looks like: a box drawn on the page in front of you.
 */
export const IMAGE_PAGES_SETTING: SettingDefinition<z.ZodEnum<{ this: 'this'; all: 'all' }>> = {
  id: 'editing.image-pages',
  title: EDITING_IMAGE_PAGES_TITLE,
  schema: z.enum(['this', 'all']),
  fallback: 'this',
  category: 'editing',
};

/**
 * How many words a personal dictionary may hold.
 *
 * A bound because the values in this store are written to a file and read back
 * on every launch, and a list a person adds to has no natural ceiling. Ten
 * thousand is far past a working vocabulary of names, jargon and product terms
 * — the whole of `dictionary-en` is 49,568 words — and far short of a settings
 * file that costs anything to parse.
 */
export const MAX_PERSONAL_WORDS = 10_000;

/**
 * The words a reader has told this build are spelt correctly.
 *
 * ## This is the *dictionary management* the founding record asks for
 *
 * `BUILD-PROMPT.md`:464 names the row *"spell check (nspell + **dictionary
 * management**)"*. One language ships (`SPELLING_LANGUAGES`), so there is
 * nothing to choose **between** and a language selector would be a control that
 * renders and does nothing. What a person actually manages, on any number of
 * languages, is the list of words their own documents use that no dictionary
 * has — names, products, jargon — and that is this.
 *
 * ## A SETTING and not per-document state, which is `viewing.ts`' test
 *
 * A colleague's surname is spelt the same way in every document, so the list
 * follows the person rather than the file. It survives a restart for the same
 * reason: a personal dictionary that forgot itself every launch is one nobody
 * would add a second word to.
 *
 * ## Not `secret`, and that is a decision rather than the default
 *
 * §7 excludes `secret` settings from export. This is a vocabulary, and a person
 * moving to a new machine wants it to come with them — but it is also drawn
 * from the documents they work on, so it is the one non-secret setting that
 * could carry a surname or a project name into a shared file. Stated here so
 * the next reader of §7's rule knows the question was asked and answered on
 * *the user expects their dictionary to move with them*.
 *
 * ## The first non-primitive setting in this build
 *
 * `useSetting` returned `schema.safeParse(…).data` straight to
 * `useSyncExternalStore`, and zod builds a **new array every call** — so a
 * component reading this through that hook would have re-rendered for ever. The
 * hook now holds its snapshot; nothing reads this one through it, which is
 * exactly why the trap was worth closing rather than noting.
 */
export const PERSONAL_DICTIONARY_SETTING: SettingDefinition<
  z.ZodArray<z.ZodString>
> = {
  id: 'editing.personal-dictionary',
  title: EDITING_PERSONAL_DICTIONARY_TITLE,
  // TRIMMED AND NON-EMPTY at the door. A blank entry is a word that matches
  // nothing and shows as a gap in any list of them, and the store validates
  // before storing — so this is the one place it can be refused rather than
  // coped with by every reader (`SettingsStore.set`).
  schema: z.array(z.string().trim().min(1).max(128)).max(MAX_PERSONAL_WORDS),
  fallback: [],
  category: 'editing',
};

/**
 * Which language a recognition reads in.
 *
 * ## Why a setting, when the OCR dialog already asks
 *
 * Because the **region tool** cannot. D6 row 6 is a drag on the page, and a dialog
 * after every drag is the shape `IMAGE_PAGES_SETTING` below already refused for
 * stamping: the choice is made once and then repeated, and asking each time turns a
 * gesture into a form. A tool has nowhere else to read it from — `commit` builds a
 * command and has no channel of its own.
 *
 * So the dialog and the tool read one value, which is what keeps *what language is
 * this document in* a single answer rather than one per surface (B3a). The dialog
 * writes it back when a reader chooses something else, the way `checkSpelling`'s
 * result writes the personal dictionary.
 *
 * **`eng` by default, and that is a fact about the models rather than a guess about
 * the reader**: it is the one model CI provisions and the first entry in
 * `OCR_LANGUAGES`. A machine with only `heb` installed shows Hebrew in the dialog —
 * the list offered is always what is provisioned — and this value is what a tool
 * uses when nobody has chosen.
 */
export const OCR_LANGUAGE_SETTING: SettingDefinition<typeof ocrLanguageSchema> = {
  id: 'editing.ocr-language',
  title: EDITING_OCR_LANGUAGE_TITLE,
  // THE CONTRACT'S OWN ENUM, for `MEASURE_SCALE_SETTING`'s reason: a stored value
  // the command would refuse is one that fails on apply, and ADR-0014's constraint 1
  // is that the language reaching the engine comes from a closed set.
  schema: ocrLanguageSchema,
  fallback: 'eng',
  category: 'editing',
};

/**
 * Which TrOCR the handwriting engine loads — `BUILD-PROMPT.md`:619's
 * *TrOCR model size (small/base)*.
 *
 * ## A setting, where the ENGINE is not
 *
 * The engine is a per-rectangle choice and is made by picking a tool: a reader
 * knows whether this box is over handwriting. The size is not about the box at
 * all — it decides what this machine **downloads and keeps**, measured
 * 2026-09-11 at 67,737,573 bytes for `small` against 339,045,465 for `base`, and
 * a choice with that consequence belongs where a reader can find it once rather
 * than beside a gesture.
 *
 * **`small` by default**, which is ADR-0052's own ruling and not a guess: it is a
 * fifth of the download and a quarter of the encoder, and the founding record
 * names both sizes without saying which a first run gets.
 *
 * Changing it does not remove the other one. Both live in the same cache and the
 * clear-caches control removes both, so a reader who tries `base` and goes back
 * has not lost the first download.
 */
export const TROCR_SIZE_SETTING: SettingDefinition<typeof trocrSizeSchema> = {
  id: 'editing.trocr-size',
  title: EDITING_TROCR_SIZE_TITLE,
  // THE CONTRACT'S OWN ENUM, for `OCR_LANGUAGE_SETTING`'s reason: a stored value
  // the command would refuse is one that fails on apply.
  schema: trocrSizeSchema,
  fallback: 'small',
  category: 'editing',
};

/**
 * Where Azure Document Intelligence lives — `BUILD-PROMPT.md`:621's
 * *Azure DI endpoint + key (secret)*, the half that is not the key.
 *
 * ## Why the endpoint is an ORDINARY setting and the key is not
 *
 * They are two different kinds of fact. The endpoint is a resource name a reader
 * can read off the Azure portal and would want to see in an exported settings
 * file; the key is a credential, and §9's rule is that one lives in the OS
 * keychain through `safeStorage` or is refused. `secret: true` is what keeps the
 * second out of `settings.json` by shape rather than by care.
 *
 * ## An empty string is the ABSENT state and the only one a first run has
 *
 * Not a default endpoint and not a placeholder: there is no address that would
 * be right for anybody, and one that looked plausible would be a control that
 * fails after a reader drags a box. The cloud tool is hidden while either half
 * is empty, which is the same `when` the handwriting tool uses.
 */
export const AZURE_DI_ENDPOINT_SETTING: SettingDefinition<z.ZodString> = {
  // FROM THE CONTRACT, not a literal here: main looks this one up by name to
  // make the call, and two strings that agree today is exactly the shape B3a is
  // about — a rename would leave the cloud engine reporting that the service
  // refused a key it never found.
  id: AZURE_ENDPOINT_SETTING_ID,
  title: EDITING_AZURE_ENDPOINT_TITLE,
  // NOT `z.string().url()`. A reader typing an address mid-keystroke would have
  // a setting that refuses to store what they are in the middle of writing, and
  // the scheme check that actually matters happens where the request is made —
  // before anything is sent, with the call count as its own case.
  schema: z.string(),
  fallback: '',
  category: 'editing',
};

/**
 * The key for that endpoint. **Secret**, so it never travels on `settings.save`.
 *
 * The first consumer of E5's rule from D6, which is what that row predicted:
 * *the range that implements storage will not be the range that owns the rule*.
 * A machine whose `safeStorage` reports itself unavailable gets a declared
 * refusal rather than a plaintext fallback.
 */
export const AZURE_DI_KEY_SETTING: SettingDefinition<z.ZodString> = {
  id: AZURE_KEY_SETTING_ID,
  title: EDITING_AZURE_KEY_TITLE,
  schema: z.string(),
  fallback: '',
  category: 'editing',
  secret: true,
};

/** What size a new text box, callout or typewriter is set in. */
export const ANNOTATION_FONT_SIZE_SETTING: SettingDefinition<z.ZodNumber> = {
  id: 'editing.annotation-font-size',
  title: EDITING_FONT_SIZE_TITLE,
  schema: z.number().min(MIN_ANNOTATION_FONT).max(MAX_ANNOTATION_FONT),
  fallback: 12,
  category: 'editing',
};
