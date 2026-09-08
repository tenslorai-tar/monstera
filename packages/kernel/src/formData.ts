import * as mupdf from 'mupdf';
import type { PDFObject, PDFWidget } from 'mupdf';
import { z } from 'zod';

import type { FieldFill, FormDataFormat, FormDataImportFormat } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { fieldValues, fillWidget, onStateKey, refuseUnfillable } from './formFields.js';
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

/** Whether every character of this text can appear in an XML 1.0 document. */
function xmlCanCarry(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
}

/**
 * XML text or an attribute value, escaped.
 *
 * **One escaper for both positions**, and the extra character is why: an
 * attribute is delimited by `"`, so a name carrying one closes it — which the
 * research instrument's own encoder did not handle, because it only ever put
 * values in element content. Escaping the union is smaller than two rules and
 * cannot be applied in the wrong place.
 */
function xmlEscaped(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

/**
 * A PDF text string, in the encoding the value needs.
 *
 * **A literal string only while the value is ASCII.** A PDF literal string is
 * bytes read as PDFDocEncoding, which cannot spell most of Unicode, so anything
 * outside ASCII is written as UTF-16BE with a byte-order mark in a hex string —
 * which is the format's own answer and what `@cantoo/pdf-lib` writes. A build
 * that emitted a literal for everything would produce a file that parses and
 * holds the wrong characters, this module's subject one layer down.
 *
 * Inside the literal, `\`, `(` and `)` are escaped: they are the construct the
 * measurement showed a naive encoder losing two of five fields to.
 */
function pdfString(text: string): string {
  // THE PRINTABLE ASCII RANGE. Its ends are a space and a tilde, neither of
  // which is a control character, so `no-control-regex` has nothing to say
  // here — a disable comment would be claiming a control that does not exist.
  if (/^[\x20-\x7e]*$/u.test(text)) {
    return `(${text.replace(/[\\()]/gu, (match) => `\\${match}`)})`;
  }
  // UTF-16BE WITH A BOM. `charCodeAt` walks code units, which is what UTF-16
  // wants — a surrogate pair is two of them and must stay two.
  let hex = 'FEFF';
  for (let index = 0; index < text.length; index += 1) {
    hex += text.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0');
  }
  return `<${hex}>`;
}

/**
 * A PDF name, with everything outside the regular character set escaped.
 *
 * `#` followed by two hex digits is the format's own escape, and it is needed
 * here rather than theoretically: a tick box's on-state name comes from the
 * document, so `/V` for a button is a name a stranger chose.
 */
function pdfName(text: string): string {
  let out = '/';
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    const regular = byte > 0x20 && byte < 0x7f && !'()<>[]{}/%#'.includes(String.fromCharCode(byte));
    out += regular
      ? String.fromCharCode(byte)
      : `#${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
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
 * The offsets are byte counts of an ASCII-only body: every value has been
 * through {@link pdfString}, which emits ASCII or hex, so a character's byte
 * length and its string length agree and `length` is the offset.
 */
function fdfFormData(fields: readonly ExportedField[]): string {
  const objects = [
    '1 0 obj\n<< /FDF << /Fields 2 0 R >> >>\nendobj\n',
    `2 0 obj\n[ ${fields.map((_field, index) => `${String(index + 3)} 0 R`).join(' ')} ]\nendobj\n`,
    ...fields.map(
      (field, index) =>
        `${String(index + 3)} 0 obj\n<< /T ${pdfString(field.name)} /V ${fdfValue(field)} >>\nendobj\n`,
    ),
  ];

  let body = '%FDF-1.2\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const startxref = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body +=
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n` +
    `startxref\n${String(startxref)}\n%%EOF\n`;
  return body;
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

/** How many fields an imported file may name. `MAX_LISTED_FIELDS`' argument. */
const MAX_IMPORTED_FIELDS = 4096;

/** How long an imported name or value may be. */
const MAX_IMPORTED_TEXT = 4096;

/** How many values one imported field may carry. The reader's bound, inbound. */
const MAX_FIELD_VALUES_IN = 256;

/**
 * The JSON an import accepts.
 *
 * **The marker is required**, and it is what separates *this file holds no
 * fields for this form* from *this is not a form-data file at all*. Without it
 * an arbitrary JSON document matches nothing and the import reports success
 * over a file that was never one of ours.
 *
 * Bounded at every axis a stranger controls, for the reason the channel schemas
 * are: a list and a string are the two things a hostile file makes large.
 */
const importedJsonSchema = z.object({
  format: z.literal(FORM_DATA_JSON_MARKER),
  version: z.literal(FORM_DATA_JSON_VERSION),
  fields: z
    .array(
      z.object({
        name: z.string().max(MAX_IMPORTED_TEXT),
        values: z.array(z.string().max(MAX_IMPORTED_TEXT)).max(MAX_FIELD_VALUES_IN),
      }),
    )
    .max(MAX_IMPORTED_FIELDS),
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
    const length = Math.min(list.length, MAX_IMPORTED_FIELDS);
    for (let index = 0; index < length; index += 1) {
      const entry = list.get(index);
      if (!entry.isDictionary()) continue;
      const name = entry.get('T');
      if (!name.isString()) continue;
      found.push({
        name: name.asString().slice(0, MAX_IMPORTED_TEXT),
        values: fdfEntryValues(entry.get('V')),
      });
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
    const length = Math.min(value.length, MAX_FIELD_VALUES_IN);
    for (let index = 0; index < length; index += 1) {
      const entry = value.get(index);
      const text = entry.isName() ? entry.asName() : entry.isString() ? entry.asString() : null;
      if (text !== null) found.push(text.slice(0, MAX_IMPORTED_TEXT));
    }
    return found;
  }
  // A NAME IS A BUTTON'S STATE and a string is everything else's, which is the
  // export's own branch read backwards.
  if (value.isName()) return [value.asName().slice(0, MAX_IMPORTED_TEXT)];
  if (value.isString()) return [value.asString().slice(0, MAX_IMPORTED_TEXT)];
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
  // SEVERAL VALUES IS A REFUSAL, and it is the third place this build says the
  // same sentence: it READS a multi-select and WRITES one value. `FieldFill`
  // carries one option, so importing two would put the first in and drop the
  // second — silently, into a document the person then saves. The panel refuses
  // to offer a control for such a field and the capture refuses to record one
  // as a prior, for the same reason and with the same words.
  if (values.length > 1) {
    throw new MultiValuedImportError(widget.getName(), values.length);
  }
  if (widget.isChoice()) return { set: 'choice', option: values[0] ?? '' };
  return { set: 'text', text: values[0] ?? '' };
}

/** A file naming more values for one field than a fill can carry. */
export class MultiValuedImportError extends Error {
  constructor(name: string, count: number) {
    super(
      `The file gives ${String(count)} values for the field "${name}", and this build writes one ` +
        'per field. Nothing was changed: importing the first and dropping the rest would be a ' +
        'loss with no report, which is worse than a refusal.',
    );
    this.name = 'MultiValuedImportError';
  }
}

/**
 * Fills every field the file names, or changes nothing at all.
 *
 * ## Two passes, and the first one is the point
 *
 * Everything is resolved and refused before anything is written, so a value the
 * document forbids leaves the form exactly as it was rather than partly filled
 * with no report. `fillWidget` refuses on its own terms — a read-only field, a
 * dropdown option the document does not offer, text aimed at a tick box — and
 * those refusals are what the first pass is collecting.
 *
 * ## A push button and a signature are skipped rather than refused
 *
 * They are absent from every file this build writes, and a file from elsewhere
 * may carry them: a push button's value means nothing and a signature's is a
 * dictionary. Refusing the import over one would make a foreign export
 * unusable for the fields that are fine.
 */
export const applyImportFormData: Apply<'mupdf', 'importFormData'> = (session, command) =>
  withDocument(session, (document) => {
    const named = new Map<string, readonly string[]>();
    for (const field of parseFormData(command.bytes, command.format)) {
      named.set(field.name, field.values);
    }

    const planned: { widget: PDFWidget; value: FieldFill }[] = [];
    const pages = document.countPages();
    for (let page = 0; page < pages; page += 1) {
      for (const widget of document.loadPage(page).getWidgets()) {
        const values = named.get(widget.getName());
        if (values === undefined) continue;
        // SKIPPED, NOT REFUSED. See the note above: a foreign file may name
        // them and they carry nothing this build could write.
        if (widget.isPushButton() || widget.getFieldType() === 'signature') continue;
        const value = fillFor(widget, values);
        // REFUSED HERE AND NOT AT THE WRITE, which is what makes the two passes
        // mean anything. The claim *nothing is written until everything is
        // resolved* was a comment and not a mechanism until this line existed:
        // `fillWidget` validates on its way in, so a plan pass that only built
        // values left the first entries applied and the document half filled.
        // A mutation writing inside this loop was supposed to find that and
        // could not, because the case re-read the fixture BYTES — which no
        // apply can change. Both defects are fixed here.
        //
        // The same function the write calls, so this is one set of type rules
        // consulted twice rather than two sets (B3a).
        refuseUnfillable(widget, value);
        planned.push({ widget, value });
      }
    }

    if (planned.length === 0) throw new NoMatchingFieldsError(named.size);
    // THE SECOND PASS WRITES. `fillWidget` throws on the first value the
    // document forbids, and because nothing has been written yet the form is
    // untouched when it does — which is what makes *refuse the whole import*
    // true rather than aspirational.
    for (const { widget, value } of planned) fillWidget(widget, value);
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
