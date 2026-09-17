/**
 * The encoders both interchange files share — form data and annotations — so XFDF and FDF are
 * spelt by one module whichever of them is being written (B3a).
 *
 * They lived in `formData.ts` until annotations became a second writer of the same two formats;
 * their reasons are unchanged and stated on each.
 */

/** Whether every character of this text can appear in an XML 1.0 document. */
export function xmlCanCarry(text: string): boolean {
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
export function xmlEscaped(text: string): string {
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
export function pdfString(text: string): string {
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
export function pdfName(text: string): string {
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

/**
 * An FDF file from its numbered objects, with its cross-reference table computed.
 *
 * `objects[0]` is object 1 and is the catalogue. The offsets are byte counts of an ASCII-only
 * body: every string has been through {@link pdfString}, which emits ASCII or hex, and every name
 * through {@link pdfName}, so a character's byte length and its string length agree and `length`
 * is the offset.
 */
export function fdfFile(objects: readonly string[]): string {
  let body = '%FDF-1.2\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }
  const startxref = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body +=
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n` +
    `startxref\n${String(startxref)}\n%%EOF\n`;
  return body;
}
