import { isFollowable } from '@monstera/contract';

/**
 * What a barcode says, in words a person reads: its type by the name it is known by, and what its text IS — a web link, a
 * phone number, an e-mail address, a contact card or plain text — so the dialog can offer the one action that fits.
 *
 * ## Reading is never doing
 *
 * Nothing here opens, dials or saves anything. A link is classified as one so a button can be drawn for it, and the press is
 * the person's (invariant 24); `main` decides again, from the document, whether its scheme is one that is followed.
 */

/** zxing-cpp's symbology names as people say them. A name not listed here is shown as zxing-cpp wrote it. */
const FORMAT_NAMES: Readonly<Record<string, string>> = {
  QRCode: 'QR code',
  MicroQRCode: 'Micro QR code',
  RMQRCode: 'Rectangular Micro QR code',
  Code128: 'Code 128',
  Code39: 'Code 39',
  Code93: 'Code 93',
  Codabar: 'Codabar',
  EAN13: 'EAN-13',
  EAN8: 'EAN-8',
  UPCA: 'UPC-A',
  UPCE: 'UPC-E',
  DataMatrix: 'Data Matrix',
  Aztec: 'Aztec code',
  PDF417: 'PDF417',
  ITF: 'Interleaved 2 of 5',
  DataBar: 'GS1 DataBar',
  DataBarExpanded: 'GS1 DataBar Expanded',
  DataBarLimited: 'GS1 DataBar Limited',
  MaxiCode: 'MaxiCode',
  DXFilmEdge: 'DX film edge',
};

/** The type of a barcode as a person says it: *QR code*, *Code 128*. */
export function friendlyFormat(format: string): string {
  return FORMAT_NAMES[format] ?? format;
}

/** A contact card's fields, each only where the card gave one. */
export interface ContactFields {
  readonly name?: string;
  readonly title?: string;
  readonly company?: string;
  readonly phones: readonly string[];
  readonly emails: readonly string[];
  readonly address?: string;
  readonly web: readonly string[];
}

/** What a barcode's text is. */
export type BarcodeContent =
  | { readonly kind: 'link'; readonly address: string }
  | { readonly kind: 'email'; readonly address: string }
  | { readonly kind: 'phone'; readonly number: string }
  | { readonly kind: 'contact'; readonly contact: ContactFields }
  | { readonly kind: 'text' };

/** An unfolded vCard's lines: a line that begins with a space or tab continues the one before (RFC 6350 §3.2). */
function unfolded(text: string): readonly string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n/u)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }
  return lines;
}

/** A vCard value with its escapes read: `\n` a line break, `\,` `\;` `\\` the character itself (RFC 6350 §3.4). */
function unescaped(value: string): string {
  return value.replace(/\\([nN,;\\])/gu, (_match, escape: string) => (escape === 'n' || escape === 'N' ? '\n' : escape));
}

/** Parses a vCard's text into the fields a person reads, or `undefined` when it is not one. */
export function parseContact(text: string): ContactFields | undefined {
  const lines = unfolded(text.trim());
  if (lines[0]?.trim().toUpperCase() !== 'BEGIN:VCARD') return undefined;
  const phones: string[] = [];
  const emails: string[] = [];
  const web: string[] = [];
  let name: string | undefined;
  let structuredName: string | undefined;
  let title: string | undefined;
  let company: string | undefined;
  let address: string | undefined;
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    // THE PROPERTY'S NAME, without its group (`item1.TEL`) or its parameters (`TEL;TYPE=CELL`).
    const property = (line.slice(0, colon).split(';')[0] ?? '').split('.').pop()?.toUpperCase() ?? '';
    const value = line.slice(colon + 1);
    if (value.trim() === '') continue;
    switch (property) {
      case 'FN':
        name ??= unescaped(value).trim();
        break;
      case 'N': {
        // FAMILY;GIVEN;ADDITIONAL;PREFIX;SUFFIX, read as the person is named: given then family.
        const [family, given] = value.split(';').map((part) => unescaped(part).trim());
        structuredName ??= [given, family].filter((part) => part !== undefined && part !== '').join(' ');
        break;
      }
      case 'TITLE':
        title ??= unescaped(value).trim();
        break;
      case 'ORG':
        company ??= value.split(';').map((part) => unescaped(part).trim()).filter((part) => part !== '').join(', ');
        break;
      case 'TEL':
        phones.push(unescaped(value).trim());
        break;
      case 'EMAIL':
        emails.push(unescaped(value).trim());
        break;
      case 'URL':
        web.push(unescaped(value).trim());
        break;
      case 'ADR':
        // POST OFFICE BOX;EXTENDED;STREET;CITY;REGION;POSTAL CODE;COUNTRY, joined from the street on, empty parts left out.
        address ??= value
          .split(';')
          .slice(2)
          .map((part) => unescaped(part).trim())
          .filter((part) => part !== '')
          .join(', ');
        break;
      default:
        break;
    }
  }
  const fullName = name ?? structuredName;
  return {
    ...(fullName === undefined || fullName === '' ? {} : { name: fullName }),
    ...(title === undefined || title === '' ? {} : { title }),
    ...(company === undefined || company === '' ? {} : { company }),
    phones,
    emails,
    ...(address === undefined || address === '' ? {} : { address }),
    web,
  };
}

/**
 * Whether a text is only a phone number: an optional `+`, then digits with the spaces, dots, dashes and brackets people
 * write between them — and at least seven digits, so a short code or a price is not offered a call.
 */
function isPhoneNumber(text: string): boolean {
  if (!/^\+?[\d\s().-]+$/u.test(text)) return false;
  return text.replace(/\D/gu, '').length >= 7;
}

/** A contact's fields as lines of text, in the order the dialog shows them. */
export function contactText(contact: ContactFields): string {
  return [
    contact.name,
    contact.title,
    contact.company,
    ...contact.phones,
    ...contact.emails,
    contact.address,
    ...contact.web,
  ]
    .filter((line): line is string => line !== undefined && line !== '')
    .join('\n');
}

/** What *Copy* puts on the clipboard for a barcode: its text as read, and for a contact card its readable lines. */
export function textToCopy(text: string): string {
  const content = classifyBarcode(text);
  return content.kind === 'contact' ? contactText(content.contact) : text;
}

/** Classifies a barcode's text. */
export function classifyBarcode(text: string): BarcodeContent {
  const trimmed = text.trim();
  const contact = parseContact(trimmed);
  if (contact !== undefined) return { kind: 'contact', contact };
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('tel:')) return { kind: 'phone', number: trimmed.slice(4).trim() };
  if (lower.startsWith('mailto:')) return { kind: 'email', address: trimmed.slice(7).split('?')[0]?.trim() ?? '' };
  // A WEB LINK is an address `main` would follow and that begins with a web scheme: `mailto:` is the e-mail's kind above.
  if (/^https?:\/\/\S+$/iu.test(trimmed) && isFollowable(trimmed)) return { kind: 'link', address: trimmed };
  if (isPhoneNumber(trimmed)) return { kind: 'phone', number: trimmed };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmed)) return { kind: 'email', address: trimmed };
  return { kind: 'text' };
}
