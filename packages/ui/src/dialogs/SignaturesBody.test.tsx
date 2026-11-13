// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { InDialog } from './inDialog.js';
import type { ShownSignature } from './signatures.js';
import SignaturesBody from './SignaturesBody.js';

/**
 * The Signatures dialog names each fact beside its value. As a list of bare lines, a reason and a place could not be
 * told apart (*"I approve this report"*, *"Head office"*, the owner's review 1c), so what is asserted is the PAIR: a
 * value found under the wrong name, or under none, fails.
 */
afterEach(() => {
  cleanup();
});

const SIGNED: ShownSignature = {
  signer: 'Ada Lovelace',
  organisation: 'Example Ltd',
  reason: 'I approve this report',
  location: 'Head office',
  notBefore: '2026-01-15T00:00:00Z',
  notAfter: '2027-01-15T00:00:00Z',
  coversDocument: true,
  coversWholeFile: true,
  signedThrough: 18360,
};

/** Each fact as the dialog shows it: the name in a `dt`, the value in the `dd` after it. */
function facts(): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const name of document.querySelectorAll('[data-signature] .m-dialog-facts dt')) {
    const value = name.nextElementSibling;
    if (value?.tagName !== 'DD') throw new Error(`no value after ${name.textContent}`);
    pairs[name.textContent] = value.textContent;
  }
  return pairs;
}

describe('SignaturesBody', () => {
  it('heads each signature with its signer, and names every fact beside its value', () => {
    render(
      <InDialog>
        <SignaturesBody signatures={[SIGNED]} unreadable={false} verified={[]} resolve={() => undefined} update={() => undefined} />
      </InDialog>,
    );
    expect(screen.getByRole('heading', { name: 'Ada Lovelace — Example Ltd' })).toBeDefined();
    expect(facts()).toStrictEqual({
      Status: 'Unchanged since it was signed',
      Reason: 'I approve this report',
      Location: 'Head office',
      Certificate: 'Valid from 2026-01-15 to 2027-01-15',
    });
  });

  it('leaves out a fact the signature does not carry, rather than naming it over nothing', () => {
    render(
      <InDialog>
        <SignaturesBody signatures={[{ ...SIGNED, organisation: '', reason: '', location: '' }]} unreadable={false} verified={[]} resolve={() => undefined} update={() => undefined} />
      </InDialog>,
    );
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeDefined();
    expect(Object.keys(facts())).toStrictEqual(['Status', 'Certificate']);
  });

  it('offers Save this signed version on a signature the file holds more than whose cut VERIFIED, and answers where it ends (ADR-0291)', () => {
    const answers: unknown[] = [];
    render(
      <InDialog>
        <SignaturesBody
          signatures={[{ ...SIGNED, coversWholeFile: false, signedThrough: 18360 }]}
          unreadable={false}
          verified={[18360]}
          resolve={(answer) => answers.push(answer)}
          update={() => undefined}
        />
      </InDialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save this signed version…' }));
    expect(answers).toStrictEqual([{ signedThrough: 18360 }]);
  });

  it('a SHORT signature whose cut does not verify offers no button (Decision 7 as written, HHHHHHHHH-12); CONTROL: the same signature verified offers it', () => {
    const short = { ...SIGNED, coversDocument: false, coversWholeFile: false, signedThrough: 18360 };
    render(
      <InDialog>
        <SignaturesBody signatures={[short]} unreadable={false} verified={[]} resolve={() => undefined} update={() => undefined} />
      </InDialog>,
    );
    expect(screen.queryByRole('button', { name: 'Save this signed version…' })).toBeNull();
    // ANOTHER SIGNATURE'S VERIFIED CUT is not this one's.
    cleanup();
    render(
      <InDialog>
        <SignaturesBody signatures={[short]} unreadable={false} verified={[9000]} resolve={() => undefined} update={() => undefined} />
      </InDialog>,
    );
    expect(screen.queryByRole('button', { name: 'Save this signed version…' })).toBeNull();
    cleanup();
    render(
      <InDialog>
        <SignaturesBody signatures={[short]} unreadable={false} verified={[18360]} resolve={() => undefined} update={() => undefined} />
      </InDialog>,
    );
    expect(screen.getByRole('button', { name: 'Save this signed version…' })).toBeDefined();
  });

  it('reports SHOWN once, after it is drawn, however often it is answered with new props', () => {
    const reports: unknown[] = [];
    const short = { ...SIGNED, coversWholeFile: false };
    const body = (verified: number[]): React.JSX.Element => (
      <InDialog>
        <SignaturesBody signatures={[short]} unreadable={false} verified={verified} resolve={() => undefined} update={(report) => reports.push(report)} />
      </InDialog>
    );
    const { rerender } = render(body([]));
    rerender(body([18360]));
    expect(reports).toStrictEqual([{ shown: true }]);
  });

  it('CONTROL: a signature that covers the whole file offers nothing to save, since the file is its signed version', () => {
    render(
      <InDialog>
        <SignaturesBody signatures={[SIGNED]} unreadable={false} verified={[18360]} resolve={() => undefined} update={() => undefined} />
      </InDialog>,
    );
    expect(screen.queryByRole('button', { name: 'Save this signed version…' })).toBeNull();
  });
});
