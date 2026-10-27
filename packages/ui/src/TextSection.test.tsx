// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { FaceStyle } from '@monstera/contract';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { TEXT_FORMAT_BOLD, TEXT_FORMAT_ITALIC, TEXT_FORMAT_UNDERLINE } from './messages/en.js';
import type { EditorFaces } from './editorKit/openEditor.js';
import { editorFontsOf } from './TextFormatPanel.js';
import { type TextLook, type TextRow, TextSection } from './TextSection.js';

beforeAll(() => {
  activateCatalogue('en', EN);
});
afterEach(() => {
  cleanup();
});

const LOOK: TextLook = { family: 'Mono Sans', size: 11, bold: false, italic: false, underline: false, strike: false, colour: undefined, align: 'left' };
const BOUNDS = { min: 1, max: 100, step: 1 };

/** The section over `look`, with the family's styles as the read on open answered them (`undefined`: not read). */
function section(look: TextLook, styles: readonly FaceStyle[] | undefined) {
  return render(
    <I18nProvider i18n={i18n}>
      <TextSection
        font={{ list: undefined, builtIn: [], inDocument: [], unset: TEXT_FORMAT_BOLD, editor: { closest: ['Mono Sans'], styles, onAsOnPage: vi.fn() } }}
        lineSpacingBounds={BOUNDS}
        live={false}
        look={look}
        onAlign={vi.fn()}
        onColour={vi.fn()}
        onFamily={vi.fn()}
        onHighlight={vi.fn()}
        onLineSpacing={vi.fn()}
        onRise={vi.fn()}
        onSize={vi.fn()}
        onSpaceAfter={vi.fn()}
        onSpacing={vi.fn()}
        onToggle={vi.fn()}
        ownColour={false}
        shows={new Set<TextRow>(['style'])}
        sizeBounds={BOUNDS}
        spacingBound={undefined}
      />
    </I18nProvider>,
  );
}

const named = (key: Parameters<typeof i18n._>[0]): string => i18n._(key);
const button = (view: ReturnType<typeof section>, key: Parameters<typeof i18n._>[0]) => view.queryByRole('button', { name: named(key) });

describe('the Text section offers the styles the family has (faceStyles.ts, ADR-0271 section 3)', () => {
  it('a family with no bold face is offered Italic and not Bold; CONTROL: a family not read yet is offered both', () => {
    const lacking = section(LOOK, ['regular', 'italic']);
    expect(button(lacking, TEXT_FORMAT_BOLD)).toBeNull();
    expect(button(lacking, TEXT_FORMAT_ITALIC)).not.toBeNull();
    // UNDERLINE IS NOT A FACE, so no family's styles hide it.
    expect(button(lacking, TEXT_FORMAT_UNDERLINE)).not.toBeNull();
    cleanup();
    const unread = section(LOOK, undefined);
    expect(button(unread, TEXT_FORMAT_BOLD)).not.toBeNull();
    expect(button(unread, TEXT_FORMAT_ITALIC)).not.toBeNull();
  });

  it('a style already on stays offered so it can be taken off, and the words are said to be in the nearest style', () => {
    const view = section({ ...LOOK, bold: true }, ['regular', 'italic']);
    expect(button(view, TEXT_FORMAT_BOLD)).not.toBeNull();
    const note = view.container.querySelector('[data-style-nearest]');
    expect(note?.textContent).toContain('Mono Sans');
    // CONTROL: a family that has the style says nothing.
    cleanup();
    const has = section({ ...LOOK, bold: true }, ['regular', 'bold']);
    expect(has.container.querySelector('[data-style-nearest]')).toBeNull();
  });
});

describe('editorFontsOf', () => {
  const faces: EditorFaces = {
    closest: [
      { family: 'Mono Sans', styles: ['regular', 'bold'] },
      { family: 'Other Serif', styles: ['regular'] },
    ],
    chosen: 'Mono Sans',
  };

  it('takes the styles of the family at the selection, by name in any case, and lists the closest families in order', () => {
    const fonts = editorFontsOf(faces, 'other serif');
    expect(fonts.styles).toStrictEqual(['regular']);
    expect(fonts.closest).toStrictEqual(['Mono Sans', 'Other Serif']);
    expect(fonts.chosen).toBe('Mono Sans');
    // CONTROL: a family the read did not answer has no styles, so every toggle stays offered.
    expect(editorFontsOf(faces, 'Unlisted').styles).toBeUndefined();
  });
});
