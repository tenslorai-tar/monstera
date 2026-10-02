// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { CLOSE_LABEL, EN, SIGNATURE_TITLE } from '../messages/en.js';
import { Dialog } from '../primitives/Dialog.js';
import SignatureBody from './SignatureBody.js';
import type { KeptSignature } from './signDocument.js';

/**
 * The Signature dialog's body (ADR-0133): what each way of making a signature answers, that *Save for reuse* is ticked
 * and travels with the look, and that a kept signature is used by one click. The command's half — that the answer
 * reaches `document.placeSignature` unchanged — is `signatureCommands.test.ts`'.
 */

const KEPT: readonly KeptSignature[] = [
  { id: '00000000-0000-4000-8000-0000000000a1', look: { kind: 'typed', text: 'Grace Hopper', font: 'helvetica' } },
];

function opened(kept: readonly KeptSignature[] = []): { readonly resolve: ReturnType<typeof vi.fn> } {
  activateCatalogue('en', EN);
  const resolve = vi.fn();
  function Wrapped(): ReactElement {
    return (
      <I18nProvider i18n={i18n}>
        {/* IN THE DIALOG, as the registry mounts it: the footer's Cancel is the popup's own close. */}
        <Dialog closeLabel={CLOSE_LABEL} onOpenChange={() => undefined} open title={SIGNATURE_TITLE}>
          <SignatureBody kept={kept} resolve={resolve} update={() => undefined} />
        </Dialog>
      </I18nProvider>
    );
  }
  render(<Wrapped />);
  return { resolve };
}

const USE = (): HTMLElement => screen.getByRole('button', { name: 'Use Signature' });

afterEach(() => {
  cleanup();
});

describe('SignatureBody', () => {
  it('TYPE answers the name in the chosen face, with Save for reuse TICKED by default', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your name' }), { target: { value: '  Ada Lovelace  ' } });
    fireEvent.click(screen.getByRole('radio', { name: /Courier$/u }));
    fireEvent.click(USE());
    expect(resolve).toHaveBeenCalledWith({ mark: { kind: 'typed', text: 'Ada Lovelace', font: 'courier' }, keep: true });
  });

  it('CONTROL: unticked, the same look answers keep false', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your name' }), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Save for reuse' }));
    fireEvent.click(USE());
    expect(resolve).toHaveBeenCalledWith({ mark: { kind: 'typed', text: 'Ada', font: 'times-italic' }, keep: false });
  });

  it('UPLOAD answers a picture for main to pick, and keep applies to it too', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    fireEvent.click(USE());
    expect(resolve).toHaveBeenCalledWith({ mark: { kind: 'image' }, keep: true });
  });

  it('DRAW waits for a stroke: Use Signature is disabled on an empty pad and says why', () => {
    const { resolve } = opened();
    expect(USE().hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Type or draw the signature first.');
    expect(screen.getByText('Draw your signature above')).toBeDefined();
    fireEvent.click(USE());
    expect(resolve).not.toHaveBeenCalled();
  });

  it('a KEPT signature is used by ONE click, as itself, and is not kept again', () => {
    const { resolve } = opened(KEPT);
    fireEvent.click(screen.getByRole('button', { name: 'Use your signature 1' }));
    expect(resolve).toHaveBeenCalledWith({ mark: { kind: 'saved', id: KEPT[0]?.id }, keep: false });
  });

  it('Remove answers the library change, for the opener to make and ask again', () => {
    const { resolve } = opened(KEPT);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(resolve).toHaveBeenCalledWith({ library: 'remove', id: KEPT[0]?.id });
  });
});
