// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { activateCatalogue } from '../i18n.js';
import { InDialog } from './inDialog.js';
import { EN } from '../messages/en.js';
import { MAX_SIGNATURE_FIELD } from '@monstera/contract';
import type { KeptSignature, SignDocumentAnswer } from './signDocument.js';
import SignDocumentBody from './SignDocumentBody.js';
import { facesRead, openStyleMenu } from './styleMenuInTest.js';

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
  return <InDialog>{children}</InDialog>;
}

/** Renders the body and collects what it resolves with. */
function opened(
  placed: boolean,
  kept: readonly KeptSignature[] = [],
): { readonly answers: SignDocumentAnswer[]; readonly library: unknown[] } {
  const answers: SignDocumentAnswer[] = [];
  // A CHANGE TO THE LIBRARY is an answer too, kept apart so the signing cases read only signing answers.
  const library: unknown[] = [];
  render(
    <Wrapped>
      <SignDocumentBody
        placed={placed}
        kept={kept}
        resolve={(answer) => {
          if ('library' in answer) library.push(answer);
          else answers.push(answer);
        }}
        update={() => undefined}
      />
    </Wrapped>,
  );
  return { answers, library };
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

  it('a field too long for the document is NAMED and marked invalid, and only that field (WCAG 3.3.1)', () => {
    opened(false);
    const location = screen.getByLabelText('Location (optional)');
    fireEvent.change(location, { target: { value: 'x'.repeat(MAX_SIGNATURE_FIELD + 1) } });

    expect(screen.getByRole('status').textContent).toBe(
      '“Location (optional)” is longer than the document can carry. Shorten it to sign.',
    );
    expect(location.getAttribute('aria-invalid')).toBe('true');
    // CONTROL: a field within the bound is not marked, so the mark separates the one field from the rest.
    expect(screen.getByLabelText('Reason (optional)').getAttribute('aria-invalid')).not.toBe('true');
    expect(SIGN()).toHaveProperty('disabled', true);

    // BACK WITHIN THE BOUND: the sentence and the mark both go.
    fireEvent.change(location, { target: { value: 'Rome' } });
    expect(screen.getByRole('status').textContent).toBe('');
    expect(location.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('the signer’s name field offers the browser’s name fill-in (WCAG 1.3.5)', () => {
    opened(false);
    expect(screen.getByLabelText('Signed by (optional)').getAttribute('autocomplete')).toBe('name');
    // CONTROL: a field that is not the signer's own name carries no purpose.
    expect(screen.getByLabelText('Reason (optional)').getAttribute('autocomplete')).toBeNull();
  });

  it('PLACED and typed: Sign waits for text, then answers it trimmed in the face chosen from the style menu', async () => {
    const { answers } = opened(true);
    // QUIET ON OPEN, and the press with nothing typed signs nothing and says why (`attempt.ts`).
    expect(screen.getByRole('status').textContent).toBe('');
    fireEvent.click(SIGN());
    expect(answers).toStrictEqual([]);
    expect(screen.getByRole('status').textContent).toBe('Type or draw the signature first.');

    fireEvent.change(screen.getByLabelText('Signature'), { target: { value: '  Grace Hopper ' } });
    await facesRead();
    await openStyleMenu('Dancing Script');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Courier Prime' }));
    fireEvent.click(SIGN());

    expect(answers).toStrictEqual([
      { passphrase: '', mark: { kind: 'typed', text: 'Grace Hopper', font: 'courier-prime' } },
    ]);
  });

  it('PLACED and typed in a face that CANNOT WRITE it: says which characters, and Sign answers nothing', async () => {
    const { answers } = opened(true);
    fireEvent.change(screen.getByLabelText('Signature'), { target: { value: 'Grace 王' } });
    await facesRead();
    screen.getByText('This style cannot write 王. Choose another style, or draw or upload your signature.');
    fireEvent.click(SIGN());
    expect(answers).toStrictEqual([]);
  });

  it('PLACED and drawn: strokes arrive in the PAD’S unit, divided by its width', () => {
    const { answers } = opened(true);
    choose('[data-sign-look]', 'drawn');
    fireEvent.click(SIGN());
    expect(answers).toStrictEqual([]);

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

  it('a TAP is a dot, recorded as the same point twice; after Clear, Sign signs nothing again', () => {
    const { answers } = opened(true);
    choose('[data-sign-look]', 'drawn');

    const surface = pad();
    fireEvent.pointerDown(surface, { clientX: 160, clientY: 50 });
    fireEvent.pointerUp(surface, { clientX: 160, clientY: 50 });

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(SIGN());
    expect(answers).toStrictEqual([]);
    expect(screen.getByRole('status').textContent).toBe('Type or draw the signature first.');

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
        'You will be asked for a picture or a scanned PDF of your signature first, then for your certificate.',
      ),
    ).toBeDefined();

    fireEvent.click(SIGN());

    expect(answers).toStrictEqual([{ passphrase: '', mark: { kind: 'image' } }]);
  });

  describe('the signature library', () => {
    const TYPED: KeptSignature = {
      id: '00000000-0000-4000-8000-0000000000a1',
      look: { kind: 'typed', text: 'Grace Hopper', font: 'courier-prime' },
    };
    const DRAWN: KeptSignature = {
      id: '00000000-0000-4000-8000-0000000000a2',
      look: { kind: 'drawn', strokes: [[[0.1, 0.1], [0.4, 0.3]]] },
    };

    /** Waits for the typed name to be set in its face, which is when there is a mark to sign with. */
    const typedAndSet = async (text: string): Promise<void> => {
      fireEvent.change(screen.getByLabelText('Signature'), { target: { value: text } });
      await facesRead();
      screen.getByRole('img', { name: 'Your signature, as it will be placed' });
    };

    it('KEEP asks to keep a typed look once signed (the case after is its control)', async () => {
      const ticked = opened(true);
      await typedAndSet('Grace Hopper');
      fireEvent.click(screen.getByLabelText('Keep this signature for next time'));
      fireEvent.click(SIGN());
      expect(ticked.answers[0]?.keep).toBe(true);
    });

    it('CONTROL: an unticked look is not kept', async () => {
      const plain = opened(true);
      await typedAndSet('Grace Hopper');
      fireEvent.click(SIGN());
      expect(plain.answers[0]).not.toHaveProperty('keep');
    });

    it('with kept signatures it OPENS ON THEM and signs with the one chosen, by id', async () => {
      const { answers } = opened(true, [TYPED, DRAWN]);
      expect(document.querySelector<HTMLSelectElement>('[data-sign-look]')?.value).toBe('saved');
      // A KEPT TYPED NAME IS DRAWN as the outline it will be placed as, named by its words.
      await facesRead();
      expect(screen.getByRole('img', { name: 'Grace Hopper' })).toBeTruthy();
      expect(screen.getByRole('img', { name: 'Drawn signature 2' })).toBeTruthy();
      const second = document.querySelector(`[data-sign-kept="${DRAWN.id}"] input`);
      if (second === null) throw new Error('no second kept signature');
      fireEvent.click(second);
      fireEvent.click(SIGN());
      expect(answers).toStrictEqual([{ passphrase: '', mark: { kind: 'saved', id: DRAWN.id } }]);
    });

    it('REMOVE and ADD answer a change to the library rather than signing', () => {
      const { answers, library } = opened(true, [TYPED]);
      const [remove] = screen.getAllByRole('button', { name: 'Remove' });
      if (remove === undefined) throw new Error('no Remove button');
      fireEvent.click(remove);
      fireEvent.click(screen.getByRole('button', { name: 'Add a picture…' }));
      expect(library).toStrictEqual([{ library: 'remove', id: TYPED.id }, { library: 'add' }]);
      expect(answers).toStrictEqual([]);
    });
  });
});
