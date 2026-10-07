import * as mupdf from './mupdfRaw.js';
import type { PDFObject, PDFWidget } from './mupdfRaw.js';
import { z } from 'zod';

import type { FieldFill, FormDataFormat, FormDataImportFormat } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { fieldValues, fillWidget, onState, onStateKey, refuseUnfillable } from './formFields.js';
import { fdfFile, pdfName, pdfString, xmlCanCarry, xmlEscaped } from './interchangeEncoding.js';
import { withDocument } from './mupdfWriter.js';
import { readXfdf } from './xfdfReader.js';

/**
 * Writing a document's form data out, in the three formats the row names.
 *
 * ## AN EXPORT IS A WRITE PATH, and that is the row's finding rather than a
 * framing
 *
 * The instinct is that an import is where hostile data arrives and an export is
 * formatting. It is the other way round by half: **an export is where the
 * document's own values reach this build's serialiser**, and a form's values
 * are not this build's data — somebody else authored that document. A value
 * carrying `)` ends an FDF string early; one carrying `<` opens an element in
 * XFDF.
 *
 * Measured 2026-09-08 (`scripts/research/formDataExport.mjs`), five fields
 * whose values close each format's constructs:
 *
 * | encoder | what a reader gets back |
 * |---|---|
 * | escaped FDF | five of five, byte-identical |
 * | naive FDF | **two of five with empty name and empty value** |
 *
 * **And the naive file opens.** MuPDF printed *syntax error: invalid key in
 * dict*, *ignoring broken object*, and then repaired it and answered. So the
 * failure of an unescaped encoder is not a refusal a caller can catch — it is a
 * file that parses and is silently missing exactly the fields whose values
 * contained a bracket.
 *
 * ## Every byte here is this build's, including the format MuPDF can read
 *
 * `fdf`, case-insensitively, appears **zero** times in `mupdf.d.ts` 1.28.0
 * (control: `getWidgets` found in the same scan). FDF import works because an
 * FDF *is PDF syntax*, not because there is an FDF reader — so the authority
 * does the whole read and none of the write, and none of the read side's
 * comfort transfers.
 *
 * ## ONE ENTRY PER FIELD, and the walk is per widget
 *
 * A radio group is one field with several widgets, all answering the same name.
 * An export that wrote the walk would repeat it, and a reader taking the last
 * entry would get whichever widget came last. So the walk is folded by name.
 *
 * ## What `/V` must BE differs by type
 *
 * A stateful button's value is a **name** (`/Yes`, `/0`) and everything else's
 * is a string. An encoder writing `(Yes)` for a tick box produces a file every
 * reader parses and no reader ticks the box with. Measured the same day: an
 * UNSET stateful field answers no value at all rather than `Off`, so the off
 * state is this build's to write — `/Off` is the format's name for it, and
 * emitting `/` for an empty name would be the unescaped bug in another suit.
 */

// `FormDataFormat` IS THE CONTRACT'S. The renderer's ask, the host channel, the
// picker's filter and this branch are four readers of one closed set, and a
// second spelling here would agree with it until a format was added.

/**
 * One field as an export sees it — folded from the widget walk.
 *
 * `values` is a list for the reader's reason: a multi-select choice field holds
 * several, and all three formats can say so.
 */
export interface ExportedField {
  /** The fully-qualified name, which is a PATH: a dot makes a parent. */
  readonly name: string;
  /** What the field holds. Empty for a field nobody filled. */
  readonly values: readonly string[];
  /**
   * Whether `/V` must be written as a NAME rather than as a string.
   *
   * True for a tick box and a radio group and nothing else, which is a fact
   * about the format rather than a convenience.
   */
  readonly asName: boolean;
}

/**
 * The marker a JSON export carries and a JSON import demands.
 *
 * Without it, importing an arbitrary JSON file matches nothing and reports
 * having imported a form — the reassuring answer. With it, a file that is not
 * one of these is refused by name.
 */
export const FORM_DATA_JSON_MARKER = 'monstera-form-data';

/** The JSON shape's version, so a later change can be refused rather than misread. */
export const FORM_DATA_JSON_VERSION = 1;

/** The name a stateful button carries when nothing of the field is on. */
const OFF_STATE = 'Off';

/**
 * Every field an export would write, folded from the widget walk.
 *
 * **Push buttons and signatures are absent**, and that is a statement rather
 * than an omission: a push button's value is meaningless by construction — the
 * reader answers no value for one deliberately — and a signature's `/V` is a
 * dictionary, not text. Neither is data a form is asked for, and neither is
 * something an import could put back.
 */
export function readFormData(session: MupdfSession): Promise<readonly ExportedField[]> {
  return withDocument(session, (document) => {
    const found: ExportedField[] = [];
    // BY NAME, because the walk is per widget and a radio group is one field
    // with several. First wins: they answer the same value, so the choice
    // between them is not a choice.
    const seen = new Set<string>();
    const pages = document.countPages();
    for (let page = 0; page < pages; page += 1) {
      for (const widget of document.loadPage(page).getWidgets()) {
        const entry = exportable(widget);
        if (entry === null || seen.has(entry.name)) continue;
        seen.add(entry.name);
        found.push(entry);
      }
    }
    return found;
  });
}

/**
 * One widget as an export sees it, or `null` for one that carries no data.
 *
 * The predicates rather than `getFieldType()`'s string, for `kindOf`'s reason:
 * the classification is MuPDF's rule and re-deriving it from a name would be a
 * second opinion about it that agrees until a version spells a type
 * differently.
 */
function exportable(widget: PDFWidget): ExportedField | null {
  // A PUSH BUTTON FIRST, because `isButton()` covers all three kinds and the
  // order is what separates them — `formFields.ts`' ordering and its reason.
  if (widget.isPushButton()) return null;
  const name = widget.getName();
  if (name === '') return null;

  if (widget.isCheckbox() || widget.isRadioButton()) {
    const held = fieldValues(widget);
    return {
      name,
      // `/Off` WHERE THE DOCUMENT HOLDS NOTHING. Measured: an unset stateful
      // field answers no value, and a name has to be something — an empty one
      // is a syntax error rather than an off state.
      values: [held[0] ?? OFF_STATE],
      asName: true,
    };
  }

  // A SIGNATURE'S `/V` IS A DICTIONARY and `fieldValues` answers nothing for
  // it, which would export as a field holding no text — indistinguishable from
  // an empty text field, and it would import back as one. So it is dropped
  // here, where the reason can be said.
  if (widget.getFieldType() === 'signature') return null;

  return { name, values: fieldValues(widget), asName: false };
}

/**
 * A field value or name that no XML document can carry.
 *
 * XML 1.0 admits tab, newline and carriage return out of the C0 range and
 * **nothing else** — not even as a numeric character reference, which is the
 * escape hatch that does not exist here. A PDF string may hold any byte.
 *
 * So an XFDF export of such a value has three options and only one of them is
 * honest: emit it and produce a file no parser accepts; drop it and write a
 * file that is silently missing a character; or refuse. This build refuses,
 * because the other two are the failure this whole module is about — an export
 * that looks like it worked. JSON and FDF carry the value unharmed, and the
 * refusal says so.
 */
export class UnrepresentableFormDataError extends Error {
  constructor(name: string) {
    super(
      `The field "${name}" holds a character XML cannot carry — a control character outside ` +
        'tab, newline and carriage return, which XFDF has no escape for. Export as JSON or FDF, ' +
        'which carry it unchanged.',
    );
    this.name = 'UnrepresentableFormDataError';
  }
}

/** What one field's `/V` is, as FDF syntax. */
function fdfValue(field: ExportedField): string {
  if (field.asName) return pdfName(field.values[0] ?? OFF_STATE);
  if (field.values.length === 1) return pdfString(field.values[0] ?? '');
  // AN ARRAY FOR EVERY OTHER COUNT, including zero: `/V []` says *this field
  // holds nothing* where omitting `/V` would say *this file has no opinion
  // about this field*, and an import cannot tell those apart afterwards.
  return `[ ${field.values.map((value) => pdfString(value)).join(' ')} ]`;
}

/**
 * The three encoders.
 *
 * **UTF-8 bytes, not a string**, because two of the three are byte formats and
 * a caller that had to know which is a caller that can get it wrong.
 */
export function serialiseFormData(
  fields: readonly ExportedField[],
  format: FormDataFormat,
): Uint8Array {
  if (format === 'json') return new TextEncoder().encode(jsonFormData(fields));
  if (format === 'xfdf') return new TextEncoder().encode(xfdfFormData(fields));
  return new TextEncoder().encode(fdfFormData(fields));
}

/**
 * JSON, which is the CONTROL rather than a third encoder.
 *
 * It is the one format with an authority already in the runtime, so the other
 * two are measured against it and nothing here escapes anything.
 *
 * The marker and the version are what let an import refuse a file that is not
 * one of these, instead of matching no field and reporting success.
 */
function jsonFormData(fields: readonly ExportedField[]): string {
  return `${JSON.stringify(
    {
      format: FORM_DATA_JSON_MARKER,
      version: FORM_DATA_JSON_VERSION,
      fields: fields.map((field) => ({ name: field.name, values: field.values })),
    },
    null,
    2,
  )}\n`;
}

/**
 * XFDF.
 *
 * **Several `<value>` children for a field holding several**, which is the
 * format's own shape and the reason the reader answers a list.
 *
 * The `/V`-is-a-name distinction does not survive here and does not need to:
 * XFDF has one text carrier, and a tick box's value is the on-state's name
 * written as text — which is what every reader of this format expects.
 */
function xfdfFormData(fields: readonly ExportedField[]): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<xfdf xmlns="http://ns.adobe.com/xfdf/">', '  <fields>'];
  for (const field of fields) {
    if (!xmlCanCarry(field.name) || !field.values.every(xmlCanCarry)) {
      throw new UnrepresentableFormDataError(field.name);
    }
    const values = field.values.map((value) => `<value>${xmlEscaped(value)}</value>`).join('');
    lines.push(`    <field name="${xmlEscaped(field.name)}">${values}</field>`);
  }
  lines.push('  </fields>', '</xfdf>', '');
  return lines.join('\n');
}

/**
 * FDF, with its cross-reference table computed.
 *
 * The structure PDF 32000-1 Annex L describes: a catalogue whose `/FDF` holds
 * `/Fields`, an array of field dictionaries carrying `/T` and `/V`.
 *
 * **The names are flat and fully qualified** rather than a tree of `/Kids`. A
 * name is a path — a dot makes a parent — and both spellings are legal; the
 * flat one was the one measured to round-trip, and a tree would be this build
 * deciding where a document's field hierarchy divides.
 *
 * The cross-reference table is `fdfFile`'s.
 */
function fdfFormData(fields: readonly ExportedField[]): string {
  return fdfFile([
    '<< /FDF << /Fields 2 0 R >> >>',
    `[ ${fields.map((_field, index) => `${String(index + 3)} 0 R`).join(' ')} ]`,
    ...fields.map((field) => `<< /T ${pdfString(field.name)} /V ${fdfValue(field)} >>`),
  ]);
}

/* ------------------------------------------------------------------ import */

/**
 * Reading a form-data file back in.
 *
 * ## The parse happens HERE, which is the contained process
 *
 * An imported file is the most attacker-controlled thing this row touches, and
 * it arrives through ADR-0044's asset route rather than over the wire. That is
 * forced for FDF — decoding one needs MuPDF and invariant 20 keeps MuPDF out of
 * `main` — and it is *chosen* for JSON, because a parser for a stranger's file
 * belongs on the same side of the boundary whatever the format.
 *
 * ## What a file may say, and what it may not
 *
 * A data file names **fields**, so an import matches by name and there is no
 * handle and no version. An entry naming a field this document does not have is
 * ignored, because a form exported from another revision carries them. A value
 * the field's own type rules reject refuses the **whole** command — a
 * half-applied form with nothing reported is the reassuring failure this row
 * exists to prevent — and a file matching nothing refuses too, because filling
 * zero fields successfully is what importing the wrong file looks like.
 */

/** One field a data file names. */
export interface ImportedField {
  readonly name: string;
  readonly values: readonly string[];
}

/*
 * NO COUNT AND NO TEXT BOUND on an imported file, in any of the three formats: the file's bytes are bounded before it
 * is read (`MAX_FORM_DATA_BYTES`), and reading is linear in them. Bounds of 4,096 fields, 256 values and 4,096
 * characters refused a real form's JSON and XFDF and cut its FDF in silence (JOURNAL, *No document-size refusals*, table
 * A row 9); each format also held its own opinion of what to do past them (`xfdfReader.ts` says the same).
 */

/**
 * The JSON an import accepts.
 *
 * **The marker is required**, and it is what separates *this file holds no
 * fields for this form* from *this is not a form-data file at all*. Without it
 * an arbitrary JSON document matches nothing and the import reports success
 * over a file that was never one of ours.
 *
 * Bounded by the file's bytes, not per axis: see the note above.
 */
const importedJsonSchema = z.object({
  format: z.literal(FORM_DATA_JSON_MARKER),
  version: z.literal(FORM_DATA_JSON_VERSION),
  fields: z.array(
    z.object({
      name: z.string(),
      values: z.array(z.string()),
    }),
  ),
});

/** A form-data file this build will not read. */
export class UnreadableFormDataError extends Error {
  constructor(detail: string) {
    super(`This file is not form data this build can read: ${detail}.`);
    this.name = 'UnreadableFormDataError';
  }
}

/** A file whose fields name nothing in this document. */
export class NoMatchingFieldsError extends Error {
  constructor(named: number) {
    super(
      `The file names ${String(named)} field(s) and this document has none of them. Nothing was ` +
        'changed. An import that filled nothing and reported success would be indistinguishable ' +
        'from importing the wrong file.',
    );
    this.name = 'NoMatchingFieldsError';
  }
}

/**
 * What a data file says, whichever format it is in.
 *
 * **JSON is parsed with the runtime's own parser and a schema**, because
 * `JSON.parse` throwing on malformed input is the authority doing the hard part
 * and a hand-written check would be a second opinion about it. What the schema
 * adds is the shape, the marker and the bounds.
 */
export function parseFormData(
  bytes: Uint8Array,
  format: FormDataImportFormat,
): readonly ImportedField[] {
  if (format === 'json') return parseJson(bytes);
  if (format === 'xfdf') return parseXfdf(bytes);
  return parseFdf(bytes);
}

/**
 * An XFDF, through the strict reader
 * ([ADR-0046](../../../docs/DECISIONS/0046-a-strict-xfdf-reader-rather-than-an-xml-parser.md)).
 *
 * `fatal: true` for the JSON parse's reason: a lenient decode turns a binary
 * file into a run of replacement characters, which then fails as *not XFDF* —
 * the right outcome by the wrong route, and the wrong one the day a binary file
 * decodes into something that parses.
 *
 * The reader's refusals are re-thrown as they are. Each names the rule that
 * fired, which is worth more than a uniform message to whoever reads a log:
 * *this file carries a DOCTYPE* and *this file is not XFDF* are different facts
 * about the person's file.
 */
function parseXfdf(bytes: Uint8Array): readonly ImportedField[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new UnreadableFormDataError(error instanceof Error ? error.message : String(error));
  }
  return readXfdf(text);
}

function parseJson(bytes: Uint8Array): readonly ImportedField[] {
  let decoded: unknown;
  try {
    // `fatal: true` SO INVALID UTF-8 IS A REFUSAL rather than a run of
    // replacement characters. The lenient decoder turns a binary file into a
    // string of `U+FFFD`, which then fails to parse as JSON with a message
    // about syntax — the right outcome by the wrong route, and the wrong
    // outcome the day a binary file happens to decode into valid JSON.
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new UnreadableFormDataError(error instanceof Error ? error.message : String(error));
  }
  const parsed = importedJsonSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new UnreadableFormDataError(
      `it is JSON, but not this build's form data — ${parsed.error.issues[0]?.message ?? 'wrong shape'}`,
    );
  }
  return parsed.data.fields;
}

/**
 * An FDF, read as the PDF syntax it is.
 *
 * MuPDF declares no FDF API — measured, zero mentions in `mupdf.d.ts` 1.28.0 —
 * so this opens the bytes as a document under the FDF magic string and walks
 * `/Root /FDF /Fields`, which is the structure PDF 32000-1 Annex L describes.
 *
 * **A tolerant read of a hostile file.** Every entry that does not answer a
 * name is skipped rather than throwing, because one malformed object in a file
 * a stranger wrote should not cost the caller the fields that were fine — and
 * the empty result is what refuses, one level up, where the message can say
 * which of *nothing matched* and *nothing was there* happened.
 */
function parseFdf(bytes: Uint8Array): readonly ImportedField[] {
  let document: mupdf.Document;
  try {
    document = mupdf.PDFDocument.openDocument(bytes, 'application/vnd.fdf');
  } catch (error) {
    throw new UnreadableFormDataError(error instanceof Error ? error.message : String(error));
  }
  if (!(document instanceof mupdf.PDFDocument)) {
    throw new UnreadableFormDataError('it opened as something that is not PDF syntax');
  }
  try {
    const list = document.getTrailer().get('Root').get('FDF').get('Fields');
    if (!list.isArray()) {
      throw new UnreadableFormDataError('it has no /Root /FDF /Fields array');
    }
    const found: ImportedField[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const entry = list.get(index);
      if (!entry.isDictionary()) continue;
      const name = entry.get('T');
      if (!name.isString()) continue;
      found.push({ name: name.asString(), values: fdfEntryValues(entry.get('V')) });
    }
    return found;
  } finally {
    document.destroy();
  }
}

/** What one FDF entry's `/V` holds, as strings. {@link fieldValues}' shape. */
function fdfEntryValues(value: PDFObject): readonly string[] {
  if (value.isArray()) {
    const found: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const entry = value.get(index);
      const text = entry.isName() ? entry.asName() : entry.isString() ? entry.asString() : null;
      if (text !== null) found.push(text);
    }
    return found;
  }
  // A NAME IS A BUTTON'S STATE and a string is everything else's, which is the
  // export's own branch read backwards.
  if (value.isName()) return [value.asName()];
  if (value.isString()) return [value.asString()];
  return [];
}

/**
 * What one widget should be set to, given what the file said about its field.
 *
 * **The value is turned into a `FieldFill`** so the write goes through the fill
 * row's own primitive: every type rule, the read-only refusal and the
 * toggle-and-read-back belong to that row, and an import writing values its own
 * way would be a second implementation of what filling means (B3a).
 *
 * A stateful button is the one case where the same field value means different
 * things to different widgets: a radio group's file value is the chosen
 * option's export name, so each widget is on exactly when its OWN on-state key
 * equals it. That is why {@link onStateKey} exists apart from the boolean.
 */
function fillFor(widget: PDFWidget, values: readonly string[]): FieldFill {
  if (widget.isCheckbox() || widget.isRadioButton()) {
    const key = onStateKey(widget);
    return { set: 'button', on: key !== undefined && values[0] === key };
  }
  // THE CALLER HAS ALREADY SEPARATED OUT SEVERAL VALUES ({@link planFormImport}): a fill carries one option, so a file
  // naming two for one field is a field this build skips and NAMES, never one it fills with the first and drops the
  // second from.
  if (widget.isChoice()) return { set: 'choice', option: values[0] ?? '' };
  return { set: 'text', text: values[0] ?? '' };
}

/** Why an import left a field as the document had it. The words a person reads for each are the surface's. */
export type ImportSkipReason =
  /** The file names a field this document does not have. */
  | 'not-in-document'
  /** The document marks the field read-only and the file's value differs from what it holds. */
  | 'read-only'
  /** The file gives a choice field several values, and a fill carries one. */
  | 'several-values'
  /** The file's value is not one of the options the document offers. */
  | 'option-not-offered'
  /** The field's kind takes no value of this sort. */
  | 'cannot-be-filled';

/** One field an import did not fill, and why. */
export interface ImportSkip {
  readonly name: string;
  readonly reason: ImportSkipReason;
}

/** What an import will write and what it leaves, decided once. */
export interface FormImportPlan {
  readonly fills: readonly { readonly widget: PDFWidget; readonly value: FieldFill }[];
  /** Named once per field and reason, in the order the document's widgets come. A radio group is one entry. */
  readonly skipped: readonly ImportSkip[];
  /** How many fields the file names, which is what a file that matched nothing is told. */
  readonly named: number;
}

/**
 * Whether a field already holds what the file says. An empty value and no value are the same thing here, and a button
 * is compared as the state each widget would be set to, since one value of a radio group is on for exactly one of them.
 */
function alreadyHolds(widget: PDFWidget, values: readonly string[]): boolean {
  if (widget.isCheckbox() || widget.isRadioButton()) {
    const key = onStateKey(widget);
    return (key !== undefined && values[0] === key) === onState(widget);
  }
  const held = fieldValues(widget);
  if (values.length <= 1 && held.length <= 1) return (values[0] ?? '') === (held[0] ?? '');
  return values.length === held.length && values.every((value, at) => value === held[at]);
}

/**
 * What an import does with each field the file names: the ONE answer to *which fields does this file fill*, taken by
 * the write and by anything that reports it (B3a).
 *
 * ## A field the import cannot fill is skipped and named, and never costs the file
 *
 * A file from somewhere else names fields this document lacks, locks a field the app's own export wrote, or gives a
 * value a field cannot hold. Refusing the whole file for one of them made the app's own export unreadable by the app:
 * the export writes every field including a read-only one, so every round trip met the lock.
 *
 * - **A field that already holds the file's value is no skip at all**, read-only or not. A lock the file agrees with is
 *   not something a person needs told, and the app's own export imported back reports nothing.
 * - **A read-only field the file would change keeps the document's value** and is named: the document decided about
 *   that field, and an import is not the person asking to unlock it.
 * - A push button and a signature are passed over without a mention: they are absent from every file this build writes
 *   and carry no value a file could set.
 */
export function planFormImport(
  document: mupdf.PDFDocument,
  bytes: Uint8Array,
  format: FormDataImportFormat,
): FormImportPlan {
  const named = new Map<string, readonly string[]>();
  for (const field of parseFormData(bytes, format)) named.set(field.name, field.values);

  const fills: { widget: PDFWidget; value: FieldFill }[] = [];
  const skipped: ImportSkip[] = [];
  const said = new Set<string>();
  const skip = (name: string, reason: ImportSkipReason): void => {
    const key = `${name}\u0000${reason}`;
    if (said.has(key)) return;
    said.add(key);
    skipped.push({ name, reason });
  };

  const found = new Set<string>();
  const pages = document.countPages();
  for (let page = 0; page < pages; page += 1) {
    for (const widget of document.loadPage(page).getWidgets()) {
      const name = widget.getName();
      const values = named.get(name);
      if (values === undefined) continue;
      found.add(name);
      if (widget.isPushButton() || widget.getFieldType() === 'signature') continue;
      if (alreadyHolds(widget, values)) continue;
      if (widget.isReadOnly()) {
        skip(name, 'read-only');
        continue;
      }
      if (!(widget.isCheckbox() || widget.isRadioButton()) && values.length > 1) {
        skip(name, 'several-values');
        continue;
      }
      const value = fillFor(widget, values);
      // THE SAME RULES THE WRITE APPLIES, consulted before it: a value the document forbids is a skip with its reason
      // here and not a throw that unwinds fills already planned (B3a, one set of type rules).
      try {
        refuseUnfillable(widget, value);
      } catch {
        skip(name, value.set === 'choice' ? 'option-not-offered' : 'cannot-be-filled');
        continue;
      }
      fills.push({ widget, value });
    }
  }
  for (const name of named.keys()) if (!found.has(name)) skip(name, 'not-in-document');

  return { fills, skipped, named: named.size };
}

/**
 * Fills every field the file names that the document lets it fill, and leaves the rest as they were.
 *
 * ## A file that names nothing this document has is still refused
 *
 * Every other shortfall is one field's, skipped and named by {@link planFormImport}. A file in which not one name is in
 * the document is the wrong file, and filling nothing and reporting success would be indistinguishable from importing
 * it.
 */
export const applyImportFormData: Apply<'mupdf', 'importFormData'> = (session, command) =>
  withDocument(session, (document) => {
    const plan = planFormImport(document, command.bytes, command.format);
    const matched = plan.named - plan.skipped.filter((skip) => skip.reason === 'not-in-document').length;
    if (matched === 0) throw new NoMatchingFieldsError(plan.named);
    // THE PLAN WAS MADE BEFORE ANYTHING WAS WRITTEN, so a fill's own refusal cannot leave the form half filled: each
    // planned value has already passed the rules `fillWidget` applies.
    for (const { widget, value } of plan.fills) fillWidget(widget, value);
  });

/**
 * An import records no prior state, and says why.
 *
 * The prior is every value of every field the file happens to name — a set the
 * command cannot know before it parses, spread across the whole document. It is
 * expressible in principle and it is the checkpoint's job in practice: undo of
 * one restores the document, where an inverse would have to carry a second
 * whole form. `captureFlattenFormFields`' shape and its reason.
 */
export function captureImportFormData(): Promise<CaptureResult<never>> {
  return Promise.resolve({
    captured: false,
    reason:
      'an import writes every field the file names, so the prior state is a whole form rather ' +
      'than a value — the checkpoint restores it exactly',
  });
}

/**
 * Unreachable, and required by `CommandSpec`'s shape.
 *
 * `invertFlattenFormFields`' reason exactly: `CommandPrior` is `never` here, so
 * nothing can construct an argument, and throwing rather than resolving keeps a
 * widened type from landing as an undo that did nothing.
 */
export const invertImportFormData: Invert<'mupdf', 'importFormData'> = (): Promise<void> => {
  throw new Error(
    'an imported form has no inverse; undo restores the checkpoint the bus took (ADR-0037)',
  );
};
