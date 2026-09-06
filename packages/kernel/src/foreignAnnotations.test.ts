import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { mupdfWriter } from './mupdfWriter.js';
import { applyAddAnnotation } from './pageAnnotations.js';

/**
 * What a save does to an annotation this build did not author — invariant L5,
 * executed rather than assumed.
 *
 * ## The claim, and the sentence these cases were written to settle
 *
 * `docs/ARCHITECTURE.md`:534 states *"A save never rewrites annotations it did
 * not author"* and then says the honest thing about its own evidence:
 * **byte-identity is assumed, not measured.** The spike proved a foreign
 * annotation *survives* a full save, which is strictly weaker — a full rewrite
 * re-serialises every object, so if MuPDF normalises string encoding, filter
 * choice or number formatting on the way through, the invariant is already
 * violated. Running that check is item 4 of
 * [ADR-0008](../../../docs/DECISIONS/0008-save-mode-is-determined-by-purpose.md),
 * and it is the first of that list because it can invert the save-mode default.
 *
 * ## THE ANSWER: byte-identity does NOT hold. Text-identity does.
 *
 * Measured 2026-09-06 against MuPDF 1.28.0, on a plain save of an untouched
 * document. Two entries out of ten come back re-encoded, and both changes are
 * spelling rather than meaning:
 *
 * | entry | written | read back |
 * |---|---|---|
 * | a literal with **balanced** parens | `(see (this))` | `(see \(this\))` |
 * | an **ASCII hex** string | `<414243>` | `(ABC)` |
 *
 * Everything else is untouched: names, numbers, arrays, plain literals,
 * literals whose parens were already escaped, and UTF-16BE hex strings — the
 * form a producer uses for anything a person actually typed.
 *
 * So the invariant as written is **false at the byte level and true at the
 * level a reader cares about**: no foreign annotation loses a key, a value or a
 * character. What that does and does not settle:
 *
 * - It **does** settle that a full rewrite cannot silently discard what another
 *   application wrote — the thing the invariant exists to protect.
 * - It **does not** settle the save-mode default, because a re-encoding is
 *   still a byte change and anything covering those bytes (a signature) breaks.
 *   ADR-0008 already routes signature-bearing saves to an incremental save for
 *   exactly that reason, and whether the default moves is that ADR's decision
 *   rather than this file's.
 *
 * ## The set of divergences is PINNED, not just permitted
 *
 * A case asserting *the text survives* would pass on a version that re-encoded
 * everything, and a case asserting *these two changed* would pass on one that
 * changed six. So the load-bearing assertion is that the changed entries are
 * **exactly** those two — a future MuPDF that stops re-encoding, or starts
 * re-encoding something else, turns this red rather than quietly moving what
 * the invariant means.
 */

const MEDIA: readonly [number, number] = [200, 300];

/** How a foreign annotation's entries read, serialised. */
type Entries = Readonly<Record<string, string>>;

/**
 * The entries whose SPELLING a plain save is known to change.
 *
 * Both preserve the decoded text. Pinned rather than tolerated — see the note
 * above on why a permissive assertion would say nothing.
 */
const RE_ENCODED = ['/Contents', '/NM'] as const;

/**
 * A one-page document carrying an annotation another application wrote.
 *
 * Every field is chosen for a way a re-serialiser could change it and still
 * render identically — which is what makes this a fixture about bytes rather
 * than about appearance.
 */
async function withForeign(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([...MEDIA]);

  const other = document.context.obj({});
  other.set(PDFName.of('Type'), PDFName.of('Annot'));
  other.set(PDFName.of('Subtype'), PDFName.of('Square'));
  const rect = PDFArray.withContext(document.context);
  for (const value of [5, 5, 45, 45]) rect.push(PDFNumber.of(value));
  other.set(PDFName.of('Rect'), rect);
  // UTF-16BE HEX, which is what a producer writes for anything a person typed.
  other.set(PDFName.of('T'), PDFHexString.fromText('Reviewer'));
  // BALANCED PARENS, legal unescaped and the first thing re-escaped.
  other.set(PDFName.of('Contents'), PDFString.of('see (this)'));
  // ALREADY ESCAPED, which is the control for the line above: the same
  // character, in the form the writer would have chosen.
  other.set(PDFName.of('Subj'), PDFString.of('a \\) b'));
  // ASCII HEX, the second thing re-encoded — into a literal.
  other.set(PDFName.of('NM'), PDFHexString.of('414243'));
  // TRAILING PRECISION a number formatter could trim.
  other.set(PDFName.of('CA'), PDFNumber.of(0.5));
  // A KEY THAT MEANS NOTHING ON A SQUARE, so a writer rebuilding the dictionary
  // from what it understands would drop it.
  other.set(PDFName.of('Sound'), PDFName.of('NotARealKeyForASquare'));

  const ref = document.context.register(other);
  const annots = PDFArray.withContext(document.context);
  annots.push(ref);
  page.node.set(PDFName.of('Annots'), annots);
  return document.save({ useObjectStreams: false });
}

/** Every entry of the foreign annotation on page 0, as written. */
async function foreignEntries(bytes: Uint8Array): Promise<Entries> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = document.getPages()[0];
  if (page === undefined) throw new Error('the document lost its page');
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) throw new Error('the foreign annotation is gone');

  for (const entry of annots.asArray()) {
    const dict = entry instanceof PDFRef ? document.context.lookup(entry, PDFDict) : undefined;
    if (dict === undefined) continue;
    // OURS CARRIES AN `/AP`; the foreign one does not. That is what tells the
    // two apart without depending on the order they sit in the array.
    if (dict.lookup(PDFName.of('AP')) !== undefined) continue;
    const found: Record<string, string> = {};
    for (const key of dict.keys()) {
      const value = dict.get(key);
      // `.toString()` IS THE SERIALISED FORM, which is the whole point: it
      // distinguishes `<414243>` from `(ABC)` and `0.50000` from `0.5`, where a
      // decoded comparison would call each pair equal — and a decoded
      // comparison is what would have let this invariant stay assumed.
      found[key.asString()] = value === undefined ? '' : value.toString();
    }
    return found;
  }
  throw new Error('the foreign annotation is gone');
}

/** Which entries differ between two readings. */
function changedBetween(before: Entries, after: Entries): readonly string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => before[key] !== after[key]).sort();
}

/** Opens, runs `work`, serialises, closes. */
async function saved(
  bytes: Uint8Array,
  work: (session: Awaited<ReturnType<typeof mupdfWriter.open>>) => Promise<void> = () =>
    Promise.resolve(),
): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    await work(session);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('a plain save and an annotation this build did not author', () => {
  it('keeps every key, and loses none of them', async () => {
    // The weaker claim ADR-0006's spike already made, restated as a case
    // because everything below compares against it: an unrecognised key
    // survives a writer that does not know what it is.
    const before = await withForeign();
    const after = await saved(before);
    expect(Object.keys(await foreignEntries(after)).sort()).toStrictEqual(
      Object.keys(await foreignEntries(before)).sort(),
    );
  });

  it('RE-ENCODES exactly two entries and no others', async () => {
    // THE CASE THIS FILE EXISTS FOR. *The text survives* passes on a version
    // that re-encoded everything; *these two changed* passes on one that
    // changed six. Requiring the set to be exactly these two is what makes a
    // future divergence red rather than a silent move in what L5 means.
    const before = await withForeign();
    const after = await saved(before);
    expect(changedBetween(await foreignEntries(before), await foreignEntries(after))).toStrictEqual(
      [...RE_ENCODED],
    );
  });

  it('re-encodes them in the way that was measured, not merely differently', async () => {
    const before = await foreignEntries(await withForeign());
    const after = await foreignEntries(await saved(await withForeign()));
    // Balanced parens, legal unescaped, come back escaped.
    expect(before['/Contents']).toBe('(see (this))');
    expect(after['/Contents']).toBe('(see \\(this\\))');
    // An ASCII hex string comes back as a literal.
    expect(before['/NM']).toBe('<414243>');
    expect(after['/NM']).toBe('(ABC)');
  });

  it('leaves a UTF-16BE hex string alone, which is the form that matters', async () => {
    // THE CONTROL FOR THE CASE ABOVE, and the one that decides how much the
    // re-encoding costs: a producer writes anything a person typed as UTF-16BE
    // hex, so if that survives, no authored text is being re-spelt.
    const after = await foreignEntries(await saved(await withForeign()));
    expect(after['/T']).toBe('<FEFF00520065007600690065007700650072>');
    // And an already-escaped literal is untouched, so the escaping rule is
    // MuPDF choosing one spelling rather than rewriting every string.
    expect(after['/Subj']).toBe('(a \\) b)');
  });

  it('changes nothing further when this build adds an annotation to the same page', async () => {
    // The path that actually runs: this build authors one annotation into the
    // array the foreign one is already in, which is the closest any command
    // here comes to rewriting it.
    const before = await withForeign();
    const after = await saved(before, (session) =>
      applyAddAnnotation(session, {
        kind: 'addAnnotation',
        page: 0,
        annotation: {
          type: 'square',
          rect: { x0: 100, y0: 100, x1: 150, y1: 150 },
          colour: [0, 0, 1],
          borderWidth: 1,
        },
      }),
    );
    expect(changedBetween(await foreignEntries(before), await foreignEntries(after))).toStrictEqual(
      [...RE_ENCODED],
    );
  });

  it('CONTROL: the comparison can tell a changed entry from an unchanged one', async () => {
    // Every case above turns on `changedBetween`, and a reader that answered
    // with nothing — or a comparison that always agreed — would satisfy them
    // all. This requires it to see a single altered entry.
    const entries = await foreignEntries(await withForeign());
    expect(Object.keys(entries).length).toBeGreaterThan(6);
    expect(changedBetween(entries, { ...entries, '/CA': '0.50000' })).toStrictEqual(['/CA']);
    expect(changedBetween(entries, entries)).toStrictEqual([]);
  });
});
