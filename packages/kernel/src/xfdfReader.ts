/**
 * A strict XFDF reader — the one grammar this build reads, and nothing else
 * ([ADR-0046](../../../docs/DECISIONS/0046-a-strict-xfdf-reader-rather-than-an-xml-parser.md)).
 *
 * ## It is not an XML parser and must never become one
 *
 * XFDF is XML, and this repository declares no XML dependency in any workspace.
 * The choice was a new production dependency on the path a stranger's file
 * arrives by, or a reader for the one shape this build already **writes** —
 * because `formData.ts` emits XFDF, and taking a dependency to read what we
 * hand-write splits one format across two owners (B3a).
 *
 * The measurement that decided it (`scripts/research/formDataFormats.mjs`,
 * 2026-09-07) is that **three of the six hostile shapes are DTD features**:
 *
 * | shape | what refuses it here |
 * |---|---|
 * | external entity (XXE) | `<!DOCTYPE` is refused outright |
 * | entity expansion | the same refusal — it happens inside the parser, before any value exists to bound |
 * | external DTD | the same refusal |
 * | deep nesting | {@link MAX_DEPTH} |
 * | a field with no name | {@link NamelessFieldError} — a refusal in the model, not the syntax |
 * | the ordinary case | accepted, and it is the control the other five are read against |
 *
 * So the refusal policy removes exactly what a general parser is valuable for.
 * What is left is a fixed, shallow schema: an element, a `name` attribute, some
 * text.
 *
 * ## What it accepts
 *
 * ```xml
 * <?xml version="1.0" encoding="UTF-8"?>
 * <xfdf xmlns="http://ns.adobe.com/xfdf/">
 *   <fields>
 *     <field name="applicant"><field name="name"><value>Ada</value></field></field>
 *     <field name="applicant.agrees"><value>Yes</value></field>
 *   </fields>
 * </xfdf>
 * ```
 *
 * **Both spellings of a hierarchical name**, and that is not generosity: this
 * build writes the flat one and Acrobat writes the nested one, so a reader that
 * took only the flat form would refuse every file the feature exists for. A
 * nested name is joined with dots, which is what a fully-qualified field name
 * is.
 *
 * **Several `<value>` children** are read as several values, which is how the
 * format says a multi-select — and what the export writes.
 *
 * ## What it refuses, and where each refusal lives
 *
 * Refusals are **declared** — a class per reason — so a caller can tell a file
 * that is not XFDF from one that is hostile, and so a case can assert which
 * rule fired rather than that something threw.
 */

/** How deeply elements may nest before the file is refused. */
const MAX_DEPTH = 32;

/** How many fields one file may name. `MAX_LISTED_FIELDS`' argument. */
const MAX_FIELDS = 4096;

/** How long a name or a value may be. */
const MAX_TEXT = 4096;

/** How many values one field may carry. */
const MAX_VALUES = 256;

/**
 * How long an annotation's geometry may be as text: an attribute such as `coords` or `vertices`,
 * or one `<gesture>`. 262,144 characters holds `MAX_INTERCHANGE_POINTS` pairs written to four
 * decimal places, which a field value's bound would cut through a highlight of a long page.
 */
const MAX_GEOMETRY_TEXT = 262_144;

/** How long an annotation's `<contents>` may be. */
const MAX_CONTENTS_TEXT = 16_384;

/** How many annotations one file may carry. `MAX_FIELDS`' argument. */
const MAX_ANNOTATIONS = 4096;

/**
 * One annotation element an XFDF carries, as text: what `annotationInterchange.ts` turns into a
 * record, so the meaning of every attribute is read in one place and this reader stays a grammar.
 */
export interface XfdfAnnotation {
  /** The element's local name, lower-cased — `square`, `highlight`, `freetext`. */
  readonly element: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly contents: string | undefined;
  /** Each `<gesture>` under `<inklist>`, in order. */
  readonly gestures: readonly string[];
  readonly defaultAppearance: string | undefined;
}

/** One field an XFDF names. `ImportedField`'s shape, before it reaches a model. */
export interface XfdfField {
  readonly name: string;
  readonly values: readonly string[];
}

/** A file this reader will not read. Every refusal below extends it. */
export class XfdfRefusedError extends Error {
  constructor(detail: string) {
    super(`This XFDF was refused: ${detail}.`);
    this.name = 'XfdfRefusedError';
  }
}

/**
 * The refusal that answers three of the six measured shapes at once.
 *
 * A document type declaration is where external entities, entity expansion and
 * the external DTD all live. Refusing the construct rather than bounding its
 * effect is the only order that works: expansion happens **inside** the parser,
 * before any value exists to bound.
 */
export class XfdfDoctypeError extends XfdfRefusedError {
  constructor() {
    super(
      'it carries a document type declaration. External entities, entity expansion and an ' +
        'external DTD all live there, and the last of those expands before any value exists to ' +
        'bound — so the construct is refused rather than its effect limited',
    );
    this.name = 'XfdfDoctypeError';
  }
}

/** Structure deep enough to exhaust a recursive reader, with no entities in it. */
export class XfdfTooDeepError extends XfdfRefusedError {
  constructor() {
    super(`it nests elements more than ${String(MAX_DEPTH)} deep`);
    this.name = 'XfdfTooDeepError';
  }
}

/**
 * A field element with no name.
 *
 * **A refusal in the MODEL rather than in the syntax**, and it is separate for
 * that reason: the document is well-formed and this build's model is keyed by
 * name, so skipping it would drop a value the file meant to carry.
 */
export class NamelessFieldError extends XfdfRefusedError {
  constructor() {
    super('a <field> element carries no name, and the model this fills is keyed by name');
  }
}

/** What the reader is looking at, and where. */
interface Cursor {
  readonly text: string;
  at: number;
}

/**
 * Every field an XFDF names.
 *
 * @throws {@link XfdfRefusedError} — or one of its subclasses, each naming the
 *   rule that fired.
 */
export function readXfdf(text: string): readonly XfdfField[] {
  const cursor: Cursor = { text, at: 0 };
  const found: XfdfField[] = [];

  skipProlog(cursor);
  const root = readTag(cursor);
  if (root?.kind !== 'open' || localName(root.name) !== 'xfdf') {
    throw new XfdfRefusedError('its root element is not <xfdf>');
  }
  readChildren(cursor, found, [], 1);
  if (found.length === 0) {
    throw new XfdfRefusedError('it names no fields at all');
  }
  return found;
}

/**
 * Every annotation element under an XFDF's `<annots>`, wherever that sits.
 *
 * The same prolog, root, depth and entity rules as {@link readXfdf}. Inside an annotation only
 * `<contents>`, `<inklist>`'s `<gesture>`s and `<defaultappearance>` are read; everything else —
 * a `<popup>`, `<contents-richtext>`'s XHTML, a base64 `<appearance>` — is walked past without
 * being interpreted, because an appearance from a stranger's file is content this build would
 * draw, and the record regenerates one instead.
 *
 * @throws {@link XfdfRefusedError} — or one of its subclasses, each naming the rule that fired.
 */
export function readXfdfAnnotations(text: string): readonly XfdfAnnotation[] {
  const cursor: Cursor = { text, at: 0 };
  const found: XfdfAnnotation[] = [];

  skipProlog(cursor);
  const root = readTag(cursor);
  if (root?.kind !== 'open' || localName(root.name) !== 'xfdf') {
    throw new XfdfRefusedError('its root element is not <xfdf>');
  }
  if (!root.selfClosing) walkForAnnots(cursor, found, 1);
  return found;
}

/** A container's children, looking for `<annots>`; anything else is walked through. */
function walkForAnnots(cursor: Cursor, found: XfdfAnnotation[], depth: number): void {
  if (depth > MAX_DEPTH) throw new XfdfTooDeepError();
  for (;;) {
    const tag = nextTag(cursor, 'an element');
    if (tag === 'end') return;
    if (tag.selfClosing) continue;
    if (localName(tag.name) === 'annots') {
      readAnnots(cursor, found, depth + 1);
      continue;
    }
    walkForAnnots(cursor, found, depth + 1);
  }
}

/** The annotation elements of one `<annots>`. */
function readAnnots(cursor: Cursor, found: XfdfAnnotation[], depth: number): void {
  if (depth > MAX_DEPTH) throw new XfdfTooDeepError();
  for (;;) {
    const tag = nextTag(cursor, '<annots>');
    if (tag === 'end') return;
    if (found.length >= MAX_ANNOTATIONS) {
      throw new XfdfRefusedError(`it carries more than ${String(MAX_ANNOTATIONS)} annotations`);
    }
    let contents: string | undefined;
    let defaultAppearance: string | undefined;
    const gestures: string[] = [];
    if (!tag.selfClosing) {
      for (;;) {
        const child = nextTag(cursor, 'an annotation');
        if (child === 'end') break;
        const name = localName(child.name);
        if (child.selfClosing) continue;
        if (name === 'contents') contents = readBoundedText(cursor, MAX_CONTENTS_TEXT, 'a <contents>');
        else if (name === 'defaultappearance') {
          defaultAppearance = readBoundedText(cursor, MAX_TEXT, 'a <defaultappearance>');
        }
        else if (name === 'inklist') readGestures(cursor, gestures, depth + 2);
        else skipElement(cursor, depth + 2);
      }
    }
    for (const [name, value] of tag.attributes) {
      if (value.length > MAX_GEOMETRY_TEXT) {
        throw new XfdfRefusedError(`the attribute "${name}" is longer than ${String(MAX_GEOMETRY_TEXT)} characters`);
      }
    }
    found.push({ element: localName(tag.name), attributes: tag.attributes, contents, gestures, defaultAppearance });
  }
}

/** An `<inklist>`'s `<gesture>` texts. */
function readGestures(cursor: Cursor, gestures: string[], depth: number): void {
  if (depth > MAX_DEPTH) throw new XfdfTooDeepError();
  for (;;) {
    const tag = nextTag(cursor, '<inklist>');
    if (tag === 'end') return;
    if (tag.selfClosing) continue;
    if (localName(tag.name) === 'gesture') gestures.push(readBoundedText(cursor, MAX_GEOMETRY_TEXT, 'a <gesture>'));
    else skipElement(cursor, depth + 1);
  }
}

/** Walks past one element's content to its close tag, interpreting none of it. */
function skipElement(cursor: Cursor, depth: number): void {
  if (depth > MAX_DEPTH) throw new XfdfTooDeepError();
  for (;;) {
    const tag = nextTag(cursor, 'an element');
    if (tag === 'end') return;
    if (!tag.selfClosing) skipElement(cursor, depth + 1);
  }
}

/**
 * The next tag among an element's children, or `'end'` at its close tag — comments, processing
 * instructions and text skipped, and a declaration refused as the prolog refuses one.
 */
function nextTag(cursor: Cursor, within: string): Tag | 'end' {
  for (;;) {
    skipSpace(cursor);
    if (cursor.at >= cursor.text.length) {
      throw new XfdfRefusedError(`it ends in the middle of ${within}`);
    }
    if (cursor.text.startsWith('<!--', cursor.at)) {
      consumeThrough(cursor, '-->', 'an unterminated comment');
      continue;
    }
    if (cursor.text.startsWith('<?', cursor.at)) {
      consumeThrough(cursor, '?>', 'an unterminated processing instruction');
      continue;
    }
    if (cursor.text.startsWith('<!DOCTYPE', cursor.at)) throw new XfdfDoctypeError();
    if (cursor.text.startsWith('<![CDATA[', cursor.at)) {
      consumeThrough(cursor, ']]>', 'an unterminated CDATA section');
      continue;
    }
    if (cursor.text.startsWith('<!', cursor.at)) {
      throw new XfdfRefusedError('it carries a declaration this reader does not accept');
    }
    // ONE CHARACTER PAST THE BOUND, so an attribute that exceeds it is refused where it is read
    // into a record rather than cut to a number that still parses.
    const tag = readTag(cursor, MAX_GEOMETRY_TEXT + 1);
    if (tag === null) {
      skipUntilTag(cursor);
      continue;
    }
    if (tag.kind === 'close') return 'end';
    return tag;
  }
}

/** A text read to one past `limit`, refused if it reaches it — a cut coordinate still parses. */
function readBoundedText(cursor: Cursor, limit: number, what: string): string {
  const text = readText(cursor, limit + 1);
  if (text.length > limit) throw new XfdfRefusedError(`${what} is longer than ${String(limit)} characters`);
  return text;
}

/**
 * The prolog: whitespace, comments and the XML declaration — and the one
 * construct this reader exists to refuse.
 *
 * `<!DOCTYPE` is checked BEFORE anything is consumed from it, so a declaration
 * carrying a megabyte of internal subset is refused without being read.
 */
function skipProlog(cursor: Cursor): void {
  for (;;) {
    skipSpace(cursor);
    if (cursor.text.startsWith('<!DOCTYPE', cursor.at)) throw new XfdfDoctypeError();
    if (cursor.text.startsWith('<?', cursor.at)) {
      consumeThrough(cursor, '?>', 'an unterminated processing instruction');
      continue;
    }
    if (cursor.text.startsWith('<!--', cursor.at)) {
      consumeThrough(cursor, '-->', 'an unterminated comment');
      continue;
    }
    // ANY OTHER `<!` IS REFUSED rather than skipped. A CDATA section is legal
    // here in no XFDF this build has seen, and everything else beginning `<!`
    // is a declaration — which is the class the line above exists to stop.
    if (cursor.text.startsWith('<!', cursor.at)) {
      throw new XfdfRefusedError('it carries a declaration this reader does not accept');
    }
    return;
  }
}

/**
 * The children of an element, and the recursion that a depth bound governs.
 *
 * `path` is the enclosing `<field>` names, which is how a nested vocabulary
 * becomes a fully-qualified name.
 */
function readChildren(
  cursor: Cursor,
  found: XfdfField[],
  path: readonly string[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) throw new XfdfTooDeepError();

  for (;;) {
    skipSpace(cursor);
    if (cursor.at >= cursor.text.length) {
      throw new XfdfRefusedError('it ends in the middle of an element');
    }
    if (cursor.text.startsWith('<!--', cursor.at)) {
      consumeThrough(cursor, '-->', 'an unterminated comment');
      continue;
    }
    if (cursor.text.startsWith('<!DOCTYPE', cursor.at)) throw new XfdfDoctypeError();

    const tag = readTag(cursor);
    if (tag === null) {
      // TEXT WHERE AN ELEMENT BELONGS. Ignored rather than refused, because a
      // pretty-printed file has whitespace everywhere and this reader has
      // already skipped the whitespace it recognises; anything else here is
      // content in a container element, which the format does not use.
      skipUntilTag(cursor);
      continue;
    }
    if (tag.kind === 'close') return;

    const name = localName(tag.name);
    if (name === 'field') {
      if (tag.selfClosing) continue;
      const label = tag.attributes.get('name');
      if (label === undefined || label === '') throw new NamelessFieldError();
      readField(cursor, found, [...path, label], depth + 1);
      continue;
    }
    if (tag.selfClosing) continue;
    // EVERY OTHER ELEMENT IS A CONTAINER we walk through — `<fields>`, and the
    // vocabulary an XFDF carries beside the fields (annotations, `<f>`, `<ids>`)
    // which this build reads nothing from. Walking rather than refusing is what
    // lets a real Acrobat file import; the fields are found wherever they are.
    readChildren(cursor, found, path, depth + 1);
  }
}

/**
 * One `<field>`: its `<value>` children, and any `<field>` children beneath it.
 *
 * A field with values **and** children is not a shape the format produces and
 * is not refused either — the values are recorded under this path and the
 * children under theirs, which is what the two halves of the loop do.
 */
function readField(
  cursor: Cursor,
  found: XfdfField[],
  path: readonly string[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) throw new XfdfTooDeepError();
  const values: string[] = [];

  for (;;) {
    skipSpace(cursor);
    if (cursor.at >= cursor.text.length) {
      throw new XfdfRefusedError('it ends in the middle of a <field>');
    }
    if (cursor.text.startsWith('<!--', cursor.at)) {
      consumeThrough(cursor, '-->', 'an unterminated comment');
      continue;
    }
    if (cursor.text.startsWith('<!DOCTYPE', cursor.at)) throw new XfdfDoctypeError();

    const tag = readTag(cursor);
    if (tag === null) {
      skipUntilTag(cursor);
      continue;
    }
    if (tag.kind === 'close') break;

    const name = localName(tag.name);
    if (name === 'value') {
      if (tag.selfClosing) {
        // AN EMPTY VALUE IS A VALUE, which the export relies on: a cleared
        // choice holds the empty string and a field with no `/V` holds nothing,
        // and those are different states.
        values.push('');
        continue;
      }
      if (values.length >= MAX_VALUES) {
        throw new XfdfRefusedError(`a field names more than ${String(MAX_VALUES)} values`);
      }
      values.push(readText(cursor));
      continue;
    }
    if (name === 'field') {
      if (tag.selfClosing) continue;
      const label = tag.attributes.get('name');
      if (label === undefined || label === '') throw new NamelessFieldError();
      readField(cursor, found, [...path, label], depth + 1);
      continue;
    }
    if (tag.selfClosing) continue;
    readChildren(cursor, found, path, depth + 1);
  }

  if (values.length > 0) {
    if (found.length >= MAX_FIELDS) {
      throw new XfdfRefusedError(`it names more than ${String(MAX_FIELDS)} fields`);
    }
    // A DOT JOINS THE PATH, which is what a fully-qualified field name is —
    // measured by the create row on 2026-09-08: a dot in a name makes a parent
    // in the field tree, so the nested vocabulary and the flat one describe the
    // same field.
    found.push({ name: path.join('.').slice(0, MAX_TEXT), values });
  }
}

/** One element's text content, up to its close tag, cut at `limit` as a field value is. */
function readText(cursor: Cursor, limit = MAX_TEXT): string {
  let out = '';
  for (;;) {
    if (cursor.at >= cursor.text.length) {
      throw new XfdfRefusedError('it ends in the middle of a value');
    }
    if (cursor.text.startsWith('<![CDATA[', cursor.at)) {
      const end = cursor.text.indexOf(']]>', cursor.at);
      if (end === -1) throw new XfdfRefusedError('an unterminated CDATA section');
      out += cursor.text.slice(cursor.at + '<![CDATA['.length, end);
      cursor.at = end + ']]>'.length;
      continue;
    }
    if (cursor.text.startsWith('</', cursor.at)) {
      consumeThrough(cursor, '>', 'an unterminated close tag');
      return out.slice(0, limit);
    }
    if (cursor.text.startsWith('<', cursor.at)) {
      // AN ELEMENT INSIDE A VALUE. XFDF's `<value>` holds text; markup here is
      // either a shape this reader does not know or a value that was written
      // unescaped by somebody else's encoder — and reading through it would be
      // this reader inventing content.
      throw new XfdfRefusedError('a <value> contains markup, and it may only contain text');
    }
    const next = cursor.text.indexOf('<', cursor.at);
    const chunk = cursor.text.slice(cursor.at, next === -1 ? undefined : next);
    out += unescape(chunk);
    cursor.at = next === -1 ? cursor.text.length : next;
  }
}

/**
 * The five predefined entities and numeric character references, and nothing
 * else.
 *
 * **A named entity this reader does not know is a REFUSAL**, which is the other
 * half of the `<!DOCTYPE` rule: without a declaration nothing can define one,
 * so `&whatever;` in a file with no DTD is either a file that needed the
 * construct we refused or a value somebody wrote unescaped. Both are things to
 * say out loud rather than to pass through as literal text.
 */
function unescape(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/gu, (whole, body: string) => {
    if (body === 'lt') return '<';
    if (body === 'gt') return '>';
    if (body === 'amp') return '&';
    if (body === 'quot') return '"';
    if (body === 'apos') return "'";
    if (body.startsWith('#')) {
      const code = body.startsWith('#x')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      // A REFERENCE OUTSIDE UNICODE, or one naming a surrogate, is refused
      // rather than replaced: `String.fromCodePoint` throws on the first and
      // produces a lone surrogate for the second, which is a string nothing
      // downstream can encode.
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        throw new XfdfRefusedError(`a character reference "${whole}" names no character`);
      }
      return String.fromCodePoint(code);
    }
    throw new XfdfRefusedError(
      `an entity "${whole}" this reader does not define. Only the five predefined entities and ` +
        'numeric references are accepted, because nothing may declare a new one',
    );
  });
}

/** What a tag turned out to be. */
interface Tag {
  readonly kind: 'open' | 'close';
  readonly name: string;
  readonly selfClosing: boolean;
  readonly attributes: ReadonlyMap<string, string>;
}

/** Reads one tag, or answers `null` when the cursor is not on one. Attribute values are cut at `limit`. */
function readTag(cursor: Cursor, limit = MAX_TEXT): Tag | null {
  if (!cursor.text.startsWith('<', cursor.at)) return null;
  const end = cursor.text.indexOf('>', cursor.at);
  if (end === -1) throw new XfdfRefusedError('an unterminated tag');

  const body = cursor.text.slice(cursor.at + 1, end);
  cursor.at = end + 1;

  if (body.startsWith('/')) {
    return { kind: 'close', name: body.slice(1).trim(), selfClosing: false, attributes: new Map() };
  }
  const selfClosing = body.endsWith('/');
  const inner = selfClosing ? body.slice(0, -1) : body;
  const name = /^[^\s]*/u.exec(inner)?.[0] ?? '';
  if (name === '') throw new XfdfRefusedError('a tag with no element name');

  const attributes = new Map<string, string>();
  const pattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/gu;
  let match = pattern.exec(inner.slice(name.length));
  while (match !== null) {
    const value = match[3] ?? match[4] ?? '';
    attributes.set(localName(match[1] ?? ''), unescape(value).slice(0, limit));
    match = pattern.exec(inner.slice(name.length));
  }
  return { kind: 'open', name, selfClosing, attributes };
}

/**
 * The part of a name after any namespace prefix.
 *
 * **Prefixes are dropped rather than resolved**, and that is a stated limit
 * rather than an oversight: resolving one means tracking `xmlns` bindings down
 * the tree, which is the reader becoming a parser — ADR-0046's own re-argue
 * trigger. What it costs is that a file using an `xfdf` prefix for a different
 * namespace would be read as XFDF, and nothing this build imports does that.
 */
function localName(name: string): string {
  const colon = name.lastIndexOf(':');
  return (colon === -1 ? name : name.slice(colon + 1)).toLowerCase();
}

function skipSpace(cursor: Cursor): void {
  while (cursor.at < cursor.text.length && /\s/u.test(cursor.text[cursor.at] ?? '')) {
    cursor.at += 1;
  }
}

function skipUntilTag(cursor: Cursor): void {
  const next = cursor.text.indexOf('<', cursor.at);
  cursor.at = next === -1 ? cursor.text.length : next;
}

function consumeThrough(cursor: Cursor, terminator: string, refusal: string): void {
  const end = cursor.text.indexOf(terminator, cursor.at);
  if (end === -1) throw new XfdfRefusedError(refusal);
  cursor.at = end + terminator.length;
}
