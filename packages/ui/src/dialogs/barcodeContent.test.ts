import { describe, expect, it } from 'vitest';

import { classifyBarcode, friendlyFormat, parseContact } from './barcodeContent.js';

/**
 * What a barcode says, in words: its type's everyday name, what its text is, and a contact card as lines.
 */

const CARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Okafor;Ada;;Dr.;',
  'FN:Dr. Ada Okafor',
  'ORG:Monstera Labs;Research',
  'TITLE:Head of Design',
  'TEL;TYPE=CELL:+44 20 7946 0958',
  'TEL;TYPE=WORK:020 7946 0000',
  'EMAIL;TYPE=INTERNET:ada@example.org',
  'ADR;TYPE=WORK:;;1 High Street;Leeds;West Yorkshire;LS1 1AA;United Kingdom',
  'URL:https://example.org/ada',
  'NOTE:folded line that',
  '  continues here',
  'END:VCARD',
].join('\r\n');

describe('friendlyFormat', () => {
  it('says a symbology as people do, and a name it does not know as zxing-cpp wrote it', () => {
    expect(friendlyFormat('QRCode')).toBe('QR code');
    expect(friendlyFormat('Code128')).toBe('Code 128');
    expect(friendlyFormat('EAN13')).toBe('EAN-13');
    expect(friendlyFormat('DataMatrix')).toBe('Data Matrix');
    // CONTROL: an unlisted name is shown, never blanked.
    expect(friendlyFormat('SomethingNew')).toBe('SomethingNew');
  });
});

describe('parseContact', () => {
  it('reads name, title, company, phones, e-mail, address and web page from a card', () => {
    expect(parseContact(CARD)).toStrictEqual({
      name: 'Dr. Ada Okafor',
      title: 'Head of Design',
      company: 'Monstera Labs, Research',
      phones: ['+44 20 7946 0958', '020 7946 0000'],
      emails: ['ada@example.org'],
      address: '1 High Street, Leeds, West Yorkshire, LS1 1AA, United Kingdom',
      web: ['https://example.org/ada'],
    });
  });

  it('names the person from N when the card has no FN, given name first', () => {
    expect(parseContact('BEGIN:VCARD\nN:Okafor;Ada\nEND:VCARD')?.name).toBe('Ada Okafor');
  });

  it('CONTROL: text that is not a card is not one', () => {
    expect(parseContact('Ada Okafor, +44 20 7946 0958')).toBeUndefined();
    expect(parseContact('')).toBeUndefined();
  });
});

describe('classifyBarcode', () => {
  it('knows a web link, a phone number, an e-mail address, a contact card and plain text', () => {
    expect(classifyBarcode('https://example.org/menu')).toStrictEqual({ kind: 'link', address: 'https://example.org/menu' });
    expect(classifyBarcode('tel:+442079460958')).toStrictEqual({ kind: 'phone', number: '+442079460958' });
    expect(classifyBarcode('+44 20 7946 0958')).toStrictEqual({ kind: 'phone', number: '+44 20 7946 0958' });
    expect(classifyBarcode('mailto:ada@example.org?subject=Hi')).toStrictEqual({ kind: 'email', address: 'ada@example.org' });
    expect(classifyBarcode('ada@example.org')).toStrictEqual({ kind: 'email', address: 'ada@example.org' });
    expect(classifyBarcode(CARD).kind).toBe('contact');
    expect(classifyBarcode('Table 12, window side')).toStrictEqual({ kind: 'text' });
  });

  it('does NOT call a short number a phone, nor a script or file address a link — nothing is offered to open', () => {
    expect(classifyBarcode('12345')).toStrictEqual({ kind: 'text' });
    expect(classifyBarcode('£19.99')).toStrictEqual({ kind: 'text' });
    expect(classifyBarcode('javascript:alert(1)')).toStrictEqual({ kind: 'text' });
    expect(classifyBarcode('file:///C:/Windows/System32/calc.exe')).toStrictEqual({ kind: 'text' });
    // A WEB ADDRESS WITH A SPACE IN IT is words, not a link a button could open as written.
    expect(classifyBarcode('https://example.org is our site')).toStrictEqual({ kind: 'text' });
  });
});
