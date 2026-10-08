/**
 * The file a contact-card barcode becomes: the card's own text, with the line endings a `.vcf` reader expects.
 *
 * ## Only a vCard is a contact card here
 *
 * The barcode reader's dialog shows a *Contact card* for text that begins `BEGIN:VCARD` (`barcodeContent.ts`), so that is
 * the one format this writes. A shorter card format (`MECARD:`) is shown as text and is not offered a file: converting it
 * would be inventing a vCard the symbol did not say, and a contact saved with fields it never carried is worse than none.
 * The card is NOT re-serialised from parsed fields either — what the symbol said is written as it said it, so a field
 * this build does not display (a photo, a note, a second address) still reaches the person's address book.
 *
 * ## CRLF, because RFC 6350 asks for it
 *
 * A QR code's text commonly uses bare LF, and several address books refuse a card whose lines end that way. The text is
 * split on any of CRLF, CR or LF and written with CRLF, ending on one. Nothing else in a line is changed.
 *
 * @returns the file's text, or `undefined` when the text is not a vCard
 */
export function contactCardFileText(text: string): string | undefined {
  const lines = text.trim().split(/\r\n|\r|\n/u);
  if (lines[0]?.trim().toUpperCase() !== 'BEGIN:VCARD') return undefined;
  // AN UNFINISHED CARD IS NOT SAVED AS IF IT WERE WHOLE: a symbol cut short has no END line, and a file that an address book
  // half-reads is a contact the person trusts and is missing a field.
  if (lines.at(-1)?.trim().toUpperCase() !== 'END:VCARD') return undefined;
  return `${lines.join('\r\n')}\r\n`;
}
