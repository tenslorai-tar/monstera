import { describe, expect, it } from 'vitest';

import { contactCardFileText } from './contactCard.js';

describe('contactCardFileText', () => {
  const CARD = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Ada Lovelace', 'NOTE:kept as written', 'END:VCARD'];

  it('writes the card as it was read, with CRLF line ends and one at the end', () => {
    expect(contactCardFileText(CARD.join('\n'))).toBe(`${CARD.join('\r\n')}\r\n`);
  });

  it('CONTROL: a card already in CRLF is not doubled, and a lone CR is a line end too', () => {
    expect(contactCardFileText(CARD.join('\r\n'))).toBe(`${CARD.join('\r\n')}\r\n`);
    expect(contactCardFileText(CARD.join('\r'))).toBe(`${CARD.join('\r\n')}\r\n`);
  });

  it('keeps a field this build does not show, so the address book gets all of the card', () => {
    const written = contactCardFileText(CARD.join('\n'));
    expect(written).toContain('NOTE:kept as written');
  });

  it('does not write text that is not a vCard, or a card cut short', () => {
    expect(contactCardFileText('MECARD:N:Ada;TEL:555123456;;')).toBeUndefined();
    expect(contactCardFileText('hello')).toBeUndefined();
    expect(contactCardFileText(CARD.slice(0, -1).join('\n'))).toBeUndefined();
  });

  it('reads BEGIN and END in any case, as the dialog does', () => {
    expect(contactCardFileText('begin:vcard\nFN:Ada\nend:vcard')).toBe('begin:vcard\r\nFN:Ada\r\nend:vcard\r\n');
  });
});
