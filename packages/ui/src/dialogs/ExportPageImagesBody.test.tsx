// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
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

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function opened(): { readonly resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  render(
    <Wrapped>
      <ExportPageImagesBody pageCount={3} resolve={resolve} />
    </Wrapped>,
  );
  return { resolve };
}

const QUALITY = (): HTMLElement | null => screen.queryByRole('textbox', { name: 'Quality (1–100)' });
const EXPORT = (): HTMLElement => screen.getByRole('button');

afterEach(() => {
  cleanup();
});

describe('ExportPageImagesBody', () => {
  it('CHOOSING WebP answers WebP, with the quality typed', () => {
    const { resolve } = opened();

    fireEvent.click(screen.getByRole('radio', { name: 'WebP — smaller still, some detail lost' }));
    const quality = QUALITY();
    if (quality === null) throw new Error('WebP is lossy, and the dialog asked no quality for it');
    fireEvent.change(quality, { target: { value: '40' } });
    fireEvent.click(EXPORT());

    expect(resolve).toHaveBeenCalledWith({ pages: [0, 1, 2], format: 'webp', dpi: 150, quality: 40 });
  });

  it('CONTROL: a PNG asks no quality and answers the default, whatever was typed for a lossy format', () => {
    // Without this, "the field is shown for WebP" is also what a dialog that
    // showed it for every format would pass.
    const { resolve } = opened();

    fireEvent.click(screen.getByRole('radio', { name: 'JPEG — smaller files, some detail lost' }));
    const quality = QUALITY();
    if (quality === null) throw new Error('JPEG is lossy, and the dialog asked no quality for it');
    fireEvent.change(quality, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('radio', { name: 'PNG — exact, larger files' }));

    expect(QUALITY()).toBeNull();
    fireEvent.click(EXPORT());
    expect(resolve).toHaveBeenCalledWith({ pages: [0, 1, 2], format: 'png', dpi: 150, quality: 85 });
  });
});
