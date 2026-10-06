import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { pageFonts } from './pageFonts.js';
import { readPageRewrite } from './pageRewrite.js';

/** The Chromium print committed as Part B's starting material (`scripts/research/chromiumType3Fixture.mjs`). */
const CHROMIUM = fileURLToPath(new URL('../../testing/fixtures/text-edit/chromium-type3.pdf', import.meta.url));

/**
 * The print with its page's content replaced by `content(type3, other)`, where `type3` names its Type 3 font resource
 * and `other` one of any other subtype. The resources are left as they came, so both fonts stay on the page whatever
 * the content shows: the answer has to come from what is SHOWN, not from what is present.
 */
async function rewriteOf(content: (type3: string, other: string) => string): Promise<string> {
  const session = await mupdfWriter.open(new Uint8Array(readFileSync(CHROMIUM)));
  try {
    await withDocument(session, (document) => {
      const leaf = document.findPage(0);
      const fonts = [...pageFonts(leaf).values()];
      const type3 = fonts.find((font) => font.subtype === 'Type3')?.resource;
      const other = fonts.find((font) => font.subtype !== 'Type3')?.resource;
      if (type3 === undefined || other === undefined) throw new Error('the print no longer holds both kinds of font');
      leaf.put('Contents', document.addStream(content(type3, other), document.newDictionary()));
    });
    return await readPageRewrite(session, 0);
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('readPageRewrite', () => {
  it('names the operator writer for the print, whose heading is set in a Type 3 font', async () => {
    const session = await mupdfWriter.open(new Uint8Array(readFileSync(CHROMIUM)));
    try {
      expect(await readPageRewrite(session, 0)).toBe('operators');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('names the object writer for a page that holds a Type 3 font and shows nothing in it', async () => {
    // THE CONTROL a rule reading the resources would fail: the Type 3 font is still on the page.
    expect(await rewriteOf((_type3, other) => `BT /${other} 12 Tf 20 700 Td <0025> Tj ET`)).toBe('objects');
  });

  it('follows the text state through q and Q, so a Type 3 font restored by Q is the one shown', async () => {
    expect(
      await rewriteOf((type3, other) => `BT /${type3} 12 Tf ET q BT /${other} 12 Tf ET Q BT 20 700 Td <01> Tj ET`),
    ).toBe('operators');
    // AND THE OTHER WAY: shown inside the q where the other font is set, the Type 3 font set outside it is not shown.
    expect(await rewriteOf((type3, other) => `BT /${type3} 12 Tf ET q BT /${other} 12 Tf 20 700 Td <0025> Tj ET Q`)).toBe(
      'objects',
    );
  });

  it('does not count an operator that shows no code, which makes no text object', async () => {
    expect(await rewriteOf((type3, other) => `BT /${type3} 12 Tf () Tj /${other} 12 Tf 20 700 Td <0025> Tj ET`)).toBe(
      'objects',
    );
  });
});
