// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { CLOSE_LABEL, EN, EXPORT_PAGE_IMAGES_TITLE } from '../messages/en.js';
import { Dialog } from '../primitives/Dialog.js';
import ExportPageImagesBody from './ExportPageImagesBody.js';

/**
 * The page-image export dialog's body: which format it answers, and when it
 * asks for a quality.
 *
 * The command's half — that the answer reaches `document.exportPageImages`
 * unchanged — is `commands/documentCommands.test.ts`'. This half asserts what
 * that one cannot: that choosing a format in the dialog is what puts it in the
 * answer, since that test hands the command an answer it wrote itself.
 */

/** IN THE DIALOG, as the registry mounts it: the footer's Cancel is the popup's own close and exists only inside one. */
function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return (
    <I18nProvider i18n={i18n}>
      <Dialog closeLabel={CLOSE_LABEL} onOpenChange={() => undefined} open title={EXPORT_PAGE_IMAGES_TITLE}>
        {children}
      </Dialog>
    </I18nProvider>
  );
}

/** Every refusal on screen, joined: an empty alert region is a live region waiting, not a sentence. */
function alerts(): string {
  return screen
    .queryAllByRole('alert')
    .map((alert) => alert.textContent)
    .filter((text) => text !== '')
    .join(' ');
}

function opened(): { readonly resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  render(
    <Wrapped>
      <ExportPageImagesBody pageCount={3} resolve={resolve} update={() => undefined} />
    </Wrapped>,
  );
  return { resolve };
}

const QUALITY = (): HTMLElement | null => screen.queryByRole('textbox', { name: 'Quality' });
const EXPORT = (): HTMLElement => screen.getByRole('button', { name: 'Choose a folder…' });
/** A format is a segment of the Format group: a toggle, so a button with a pressed state. */
const FORMAT = (name: string): HTMLElement => screen.getByRole('button', { name });

afterEach(() => {
  cleanup();
});

describe('ExportPageImagesBody', () => {
  it('CHOOSING WebP answers WebP, with the quality typed', () => {
    const { resolve } = opened();

    fireEvent.click(FORMAT('WebP'));
    const quality = QUALITY();
    if (quality === null) throw new Error('WebP is lossy, and the dialog asked no quality for it');
    fireEvent.change(quality, { target: { value: '40' } });
    fireEvent.click(EXPORT());

    expect(resolve).toHaveBeenCalledWith({ pages: [0, 1, 2], format: 'webp', dpi: 150, quality: 40 });
  });

  it('ITS PAGE CHOICE IS THE EXPORTS’ SHARED ROW, and what it sends is the pages chosen there', () => {
    // BY WHAT A PERSON MEETS, not by which component drew it: the group, its two options, a typed range refused only
    // once the export is pressed, and the pages sent being the ones typed. A row of this dialog's own fails here —
    // its words, or its refusing as the text is typed, or its button disabled so pressing it says nothing.
    const { resolve } = opened();

    expect(screen.getByRole('group', { name: 'Pages' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Every page' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Select pages' }));
    const field = screen.getByRole('textbox', { name: 'Page numbers' });
    fireEvent.change(field, { target: { value: '4' } });
    expect(alerts()).toBe('');

    fireEvent.click(EXPORT());

    expect(resolve).not.toHaveBeenCalled();
    expect(alerts()).toBe('“4” is outside this document, which has 3 pages.');

    fireEvent.change(field, { target: { value: '3, 1' } });
    fireEvent.click(EXPORT());

    expect(resolve).toHaveBeenCalledWith({ pages: [0, 2], format: 'png', dpi: 150, quality: 85 });
  });

  it('CONTROL: a PNG asks no quality and answers the default, whatever was typed for a lossy format', () => {
    // Without this, "the field is shown for WebP" is also what a dialog that
    // showed it for every format would pass.
    const { resolve } = opened();

    fireEvent.click(FORMAT('JPEG'));
    const quality = QUALITY();
    if (quality === null) throw new Error('JPEG is lossy, and the dialog asked no quality for it');
    fireEvent.change(quality, { target: { value: '0' } });
    fireEvent.click(FORMAT('PNG'));

    expect(QUALITY()).toBeNull();
    fireEvent.click(EXPORT());
    expect(resolve).toHaveBeenCalledWith({ pages: [0, 1, 2], format: 'png', dpi: 150, quality: 85 });
  });
});
