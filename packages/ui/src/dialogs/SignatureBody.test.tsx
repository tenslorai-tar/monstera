// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { CLOSE_LABEL, EN, SIGNATURE_TITLE } from '../messages/en.js';
import { Dialog } from '../primitives/Dialog.js';
import { asFileHandle } from '@monstera/shared';

import type { HeldSignaturePicture } from './signature.js';
import SignatureBody from './SignatureBody.js';
import { facesRead, openStyleMenu } from './styleMenuInTest.js';
import type { KeptSignature } from './signDocument.js';

/**
 * The Signature dialog's body (ADR-0133): what each way of making a signature answers, that *Save for reuse* is ticked
 * and travels with the look, and that a kept signature is used by one click. The command's half — that the answer
 * reaches `document.placeSignature` unchanged — is `signatureCommands.test.ts`'.
 */

const KEPT: readonly KeptSignature[] = [
  { id: '00000000-0000-4000-8000-0000000000a1', look: { kind: 'typed', text: 'Grace Hopper', font: 'source-sans' } },
];

function opened(
  kept: readonly KeptSignature[] = [],
  asked: { readonly picked?: HeldSignaturePicture; readonly keep?: boolean } = {},
): { readonly resolve: ReturnType<typeof vi.fn> } {
  activateCatalogue('en', EN);
  const resolve = vi.fn();
  function Wrapped(): ReactElement {
    return (
      <I18nProvider i18n={i18n}>
        {/* IN THE DIALOG, as the registry mounts it: the footer's Cancel is the popup's own close. */}
        <Dialog closeLabel={CLOSE_LABEL} onOpenChange={() => undefined} open title={SIGNATURE_TITLE}>
          <SignatureBody kept={kept} {...asked} resolve={resolve} update={() => undefined} />
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
  it('TYPE answers the name in the face chosen from the style menu, with Save for reuse TICKED by default', async () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your name' }), { target: { value: '  Ada Lovelace  ' } });
    await facesRead();
    await openStyleMenu('Dancing Script');
    // ALL FIFTEEN FACES, each its own radio item, named by the face.
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(15);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Courier Prime' }));
    fireEvent.click(USE());
    expect(resolve).toHaveBeenCalledWith({ mark: { kind: 'typed', text: 'Ada Lovelace', font: 'courier-prime' }, keep: true });
  });

  it('CONTROL: unticked, the same look answers keep false, in the face it opened with', async () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your name' }), { target: { value: 'Ada' } });
    await facesRead();
    screen.getByRole('img', { name: 'Your signature, as it will be placed' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Save for reuse' }));
    fireEvent.click(USE());
    expect(resolve).toHaveBeenCalledWith({ mark: { kind: 'typed', text: 'Ada', font: 'dancing-script' }, keep: false });
  });

  it('the PREVIEW is the name drawn in the face — the outline the page receives, not a CSS font', async () => {
    opened();
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your name' }), { target: { value: 'Ada' } });
    await facesRead();
    const preview = screen.getByRole('img', { name: 'Your signature, as it will be placed' });
    expect(preview.tagName.toLowerCase()).toBe('svg');
    expect(preview.querySelector('path')?.getAttribute('d')).toMatch(/^M.*Q/u);
  });

  it('a name the face CANNOT WRITE says which characters as it is typed, and Use Signature answers nothing', async () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your name' }), { target: { value: 'Ада' } });
    // DANCING SCRIPT'S FILES ARE LATIN, Latin Extended and Vietnamese: each Cyrillic letter is named once.
    await facesRead();
    screen.getByText('This style cannot write А д а. Choose another style, or draw or upload your signature.');
    fireEvent.click(USE());
    expect(resolve).not.toHaveBeenCalled();
    // AND THE STYLE MENU says it of each face that cannot, while a face that can — Source Sans 3 — says nothing.
    await openStyleMenu('Dancing Script');
    const sans = screen.getByRole('menuitemradio', { name: 'Source Sans 3' });
    expect(sans.textContent).not.toMatch(/Cannot write/u);
    // THE NOTE IS PART OF THE ITEM'S NAME, so a screen reader hears it with the face.
    expect(screen.getByRole('menuitemradio', { name: /^Allura/u }).textContent).toMatch(/Cannot write А д а/u);
    fireEvent.click(sans);
    fireEvent.click(USE());
    expect(resolve).toHaveBeenCalledWith({ mark: { kind: 'typed', text: 'Ада', font: 'source-sans' }, keep: true });
  });

  it('UPLOAD asks for a picture first: Use Signature answers nothing and says so once pressed, and Choose picture… answers the pick with keep', () => {
    const { resolve } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(screen.getByRole('status').textContent).toBe('');
    fireEvent.click(USE());
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Choose a picture first.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Save for reuse' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose picture…' }));
    expect(resolve).toHaveBeenCalledWith({ upload: 'pick', keep: false });
  });

  it('a PICKED picture is SHOWN before it is placed, and Use Signature answers the handle main holds', () => {
    const { resolve } = opened([], {
      picked: { handle: asFileHandle('held-1'), name: 'My signature.png', src: 'blob:preview-1' },
      keep: false,
    });
    // OPENS ON UPLOAD, where the person was, with their Save for reuse as they left it.
    const shown = screen.getByRole('img', { name: 'Your signature picture, My signature.png' });
    expect(shown.getAttribute('src')).toBe('blob:preview-1');
    expect(screen.getByRole('button', { name: 'Choose another…' })).toBeDefined();
    fireEvent.click(USE());
    expect(resolve).toHaveBeenCalledWith({ mark: { kind: 'image', picked: 'held-1' }, keep: false });
  });

  it('DRAW waits for a stroke: an empty pad OPENS QUIET, and pressing Use Signature answers nothing and says why', () => {
    const { resolve } = opened();
    // QUIET ON OPEN: the person has not had a chance to draw yet (`attempt.ts`).
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByText('Draw your signature above')).toBeDefined();
    fireEvent.click(USE());
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Type or draw the signature first.');
    // ANOTHER WAY FORGETS THE PRESS: Type's empty field is one the person has not had a chance to fill.
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    expect(screen.getByRole('status').textContent).toBe('');
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
