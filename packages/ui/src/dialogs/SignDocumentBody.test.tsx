// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import type { SignDocumentAnswer } from './signDocument.js';
import SignDocumentBody from './SignDocumentBody.js';

/**
 * The signing dialog's body, driven through the surface a person uses.
 *
 * ## What is asserted is the ANSWER
 *
 * The command half — that a placed answer becomes `document.sign`'s appearance
 * — is `documentCommands.test.ts`. This half is that the controls a person
 * operates produce that answer, including the one control no other case in
 * this build drives: a drawing surface, whose points must arrive in the
 * contract's unit rather than in pixels.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/** Renders the body and collects what it resolves with. */
function opened(placed: boolean): { readonly answers: SignDocumentAnswer[] } {
  const answers: SignDocumentAnswer[] = [];
  render(
    <Wrapped>
      <SignDocumentBody
        placed={placed}
        resolve={(answer) => {
          answers.push(answer);
        }}
      />
    </Wrapped>,
  );
  return { answers };
}

const SIGN = (): HTMLElement => screen.getByRole('button', { name: 'Choose certificate and sign' });

function choose(selector: string, value: string): void {
  const select = document.querySelector(selector);
  if (select === null) throw new Error(`no ${selector} on screen`);
  fireEvent.change(select, { target: { value } });
}

/**
 * The pad, reporting a fixed on-screen box.
 *
 * **A left and top that are not zero and a width that is not one**, so a pad
 * passing client pixels through — or dividing by the height — produces numbers
 * this case does not expect rather than coinciding with them.
 */
function pad(): Element {
  const surface = document.querySelector('[data-signature-pad]');
  if (surface === null) throw new Error('no signature pad on screen');
  surface.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 300, height: 100, right: 310, bottom: 120, x: 10, y: 20 }) as DOMRect;
  return surface;
}

describe('SignDocumentBody', () => {
  it('UNPLACED: asks nothing about a look, and answers no mark', () => {
    // THE CONTROL for every case below: the ribbon's invisible signing has no
    // rectangle, so a look control here would ask a person to design something
    // nobody will ever see.
    const { answers } = opened(false);
    expect(document.querySelector('[data-sign-look]')).toBeNull();

    fireEvent.click(SIGN());

    expect(answers).toStrictEqual([{ passphrase: '' }]);
  });

  it('a chosen timestamp authority is answered by its id, beside the sentence saying what is sent', () => {
    // THE CASE ABOVE IS THIS ONE'S CONTROL: untouched, the control answers no
    // `timestamp` at all — an absent field, never a `none` the wire would refuse.
    const { answers } = opened(false);

    choose('[data-sign-timestamp]', 'sectigo');
    fireEvent.click(SIGN());

    expect(answers).toStrictEqual([{ passphrase: '', timestamp: 'sectigo' }]);
    // THE NOTE IS ON SCREEN, which is where ADR-0058 Decision 1 put the promise:
    // the person choosing is the one who needs to know what leaves the machine.
    expect(screen.getByText(/Only a fingerprint of the signature is sent/u)).not.toBeNull();
  });

  it('PLACED and typed: Sign waits for text, then answers it trimmed in the chosen face', () => {
    const { answers } = opened(true);
    expect(SIGN()).toHaveProperty('disabled', true);
    expect(screen.getByRole('status').textContent).toBe('Type or draw the signature first.');

    fireEvent.change(screen.getByLabelText('Signature'), { target: { value: '  Grace Hopper ' } });
    choose('[data-sign-font]', 'courier');
    fireEvent.click(SIGN());

    expect(answers).toStrictEqual([
      { passphrase: '', mark: { kind: 'typed', text: 'Grace Hopper', font: 'courier' } },
    ]);
  });

  it('PLACED and drawn: strokes arrive in the PAD’S unit, divided by its width', () => {
    const { answers } = opened(true);
    choose('[data-sign-look]', 'drawn');
    expect(SIGN()).toHaveProperty('disabled', true);

    const surface = pad();
    // (40, 50) on a pad whose box starts at (10, 20) and is 300 wide is
    // (30/300, 30/300); (160, 80) is (150/300, 60/300). Dividing the y by the
    // HEIGHT would make the second 0.6, which is what this separates.
    fireEvent.pointerDown(surface, { clientX: 40, clientY: 50 });
    fireEvent.pointerMove(surface, { clientX: 160, clientY: 80 });
    fireEvent.pointerUp(surface, { clientX: 160, clientY: 80 });
    fireEvent.click(SIGN());

    expect(answers).toStrictEqual([
      {
        passphrase: '',
        mark: {
          kind: 'drawn',
          strokes: [
            [
              [0.1, 0.1],
              [0.5, 0.2],
            ],
          ],
        },
      },
    ]);
  });

  it('a TAP is a dot, recorded as the same point twice; Clear takes Sign away again', () => {
    const { answers } = opened(true);
    choose('[data-sign-look]', 'drawn');

    const surface = pad();
    fireEvent.pointerDown(surface, { clientX: 160, clientY: 50 });
    fireEvent.pointerUp(surface, { clientX: 160, clientY: 50 });
    expect(SIGN()).toHaveProperty('disabled', false);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(SIGN()).toHaveProperty('disabled', true);

    fireEvent.pointerDown(surface, { clientX: 160, clientY: 50 });
    fireEvent.pointerUp(surface, { clientX: 160, clientY: 50 });
    fireEvent.click(SIGN());

    expect(answers).toStrictEqual([
      {
        passphrase: '',
        mark: {
          kind: 'drawn',
          strokes: [
            [
              [0.5, 0.1],
              [0.5, 0.1],
            ],
          ],
        },
      },
    ]);
  });

  it('PLACED and a picture: answers the look with nothing attached, and says main asks for the file', () => {
    const { answers } = opened(true);
    choose('[data-sign-look]', 'image');
    expect(
      screen.getByText(
        'You will be asked for a PNG or JPEG picture of your signature first, then for your certificate.',
      ),
    ).toBeDefined();

    fireEvent.click(SIGN());

    expect(answers).toStrictEqual([{ passphrase: '', mark: { kind: 'image' } }]);
  });
});
