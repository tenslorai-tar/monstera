import { Zip, ZipDeflate } from 'fflate';

/**
 * An Office Open XML package, streamed — the zip under every Word, PowerPoint
 * and Excel export ([ADR-0072](../../../docs/DECISIONS/0072-office-open-xml-exports-are-written-by-this-build-over-fflate.md)).
 *
 * ## STREAMED, part by part and chunk by chunk
 *
 * A package's main part is document-sized — every page's text — and ADR-0035
 * forbids holding a document's extracted text in `main`. So a part is an
 * iterable of chunks, deflated as each arrives, and the zip's own output is
 * handed on as it is produced: what is resident is one chunk and the
 * compressor's window, which is the plain text export's page-at-a-time bound.
 *
 * `fflate`'s `ZipDeflate` compresses synchronously on `push`, so after every
 * push the bytes it produced are already queued, and draining the queue there
 * is the whole of the backpressure — no timer, no event loop turn.
 */

/**
 * One part of the package: its name inside the zip, and its content in order —
 * text for an XML part, bytes for a media part such as a slide's picture.
 */
export interface OoxmlPart {
  readonly name: string;
  readonly chunks: Iterable<string | Uint8Array> | AsyncIterable<string | Uint8Array>;
}

/**
 * The package's bytes, as they are produced.
 *
 * **The parts may themselves arrive lazily**: a presentation's slides are known
 * one page at a time, and each is three parts. A caller that listed every part
 * up front would have to read every page first.
 */
export async function* ooxmlPackage(
  parts: Iterable<OoxmlPart> | AsyncIterable<OoxmlPart>,
): AsyncIterable<Uint8Array> {
  const queued: Uint8Array[] = [];
  const failures: Error[] = [];
  const zip = new Zip((error, data) => {
    if (error !== null) failures.push(error);
    else queued.push(data);
  });
  const encoder = new TextEncoder();

  function* drain(): Iterable<Uint8Array> {
    const [failure] = failures;
    if (failure !== undefined) throw failure;
    while (queued.length > 0) {
      const next = queued.shift();
      if (next !== undefined) yield next;
    }
  }

  for await (const part of parts) {
    const file = new ZipDeflate(part.name, { level: 6 });
    zip.add(file);
    for await (const chunk of part.chunks) {
      file.push(typeof chunk === 'string' ? encoder.encode(chunk) : chunk, false);
      yield* drain();
    }
    file.push(new Uint8Array(0), true);
    yield* drain();
  }
  zip.end();
  yield* drain();
}

/**
 * Whether XML 1.0 can carry a code point at all.
 *
 * XML 1.0's `Char` production: tab, line feed, carriage return, and everything
 * from space up except the surrogate block and the two non-characters U+FFFE
 * and U+FFFF. Written as numbers rather than as a pattern of escapes, because
 * an escape in source is exactly the byte an editing tool can resolve on the
 * way past — measured on this file's first write.
 */
function xmlCarries(codePoint: number): boolean {
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return true;
  if (codePoint < 0x20) return false;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false;
  return codePoint !== 0xfffe && codePoint !== 0xffff;
}

/** U+FFFD, the replacement character. */
const REPLACEMENT = String.fromCodePoint(0xfffd);

/**
 * Text as XML character data or an attribute value — the ONE escape every
 * Office part uses (ADR-0072 Decision 1).
 *
 * ## Characters XML 1.0 cannot carry are REPLACED, not passed
 *
 * A PDF's text can hold control characters, and XML 1.0 has no representation
 * for most of them — not even a character reference — so Word refuses the whole
 * package over one. They become U+FFFD, which says *a character was here that
 * this format cannot hold* rather than dropping it without trace.
 */
export function xmlText(value: string): string {
  let out = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0xfffd;
    if (!xmlCarries(codePoint)) {
      out += REPLACEMENT;
      continue;
    }
    switch (character) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      default:
        out += character;
    }
  }
  return out;
}

/** The XML declaration every part begins with. */
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
