// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { annotationOpacitySchema, MIN_ANNOTATION_OPACITY } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { WordsToEdit } from './annotations/markWords.js';
import type { AnnotationSelection } from './annotations/selectTool.js';
import { STYLE_PRESETS } from './annotations/stylePresets.js';
import { activateCatalogue, i18n } from './i18n.js';
import { panelControlsOutsideCards } from './propertyCards.js';
import { DELETE_SELECTION_TITLE, EN, REPLY_SELECTION_TITLE } from './messages/en.js';
import type { ObjectPick } from './objectEditing.js';
import { PropertiesPanel, type StyleChange, caretRectAt, caretSizeOf } from './PropertiesPanel.js';
import { CommandRegistry, type CommandContext, type UiCommand } from './registries/commands.js';
import type { LiveReading } from './registries/tools.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import {
  ANNOTATION_COLOUR_SETTING,
  ANNOTATION_FONT_SETTING,
  ANNOTATION_FONT_SIZE_SETTING,
  ANNOTATION_LINE_WIDTH_SETTING,
  ANNOTATION_OPACITY_SETTING,
  CARET_SIZE_SETTING,
  STYLE_AS_DEFAULT_SETTING,
  TEXT_BOX_LOOK_SETTING,
} from './settings/editing.js';
import { SettingsStore } from './settingsStore.js';

/**
 * The Properties tab (v5-02, ADR-0102).
 *
 * Every case with marks selected asserts the CHANGE handed to `onRestyle` — the payload's own shape,
 * one property at a time — because that is what reaches the command; `App.test.tsx` proves the
 * dispatch and the carried selection, and the kernel proves the walk is kept. Every case with nothing
 * selected asserts what the STORE holds, which is what the tools read.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  // EVERY VIEW A CASE RENDERED, every property group in a card (Addendum 3, `propertyCards.ts`).
  expect(panelControlsOutsideCards(document)).toStrictEqual([]);
  cleanup();
});

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(4),
  hasSelection: true,
  dirty: false,
  page: 2,
  pageCount: 5,
  openDocuments: [],
};

const SQUARE = {
  index: 1,
  rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
  kind: 'square' as const,
  contents: 'check the figure',
  author: 'Priya Raman',
  created: '2026-09-24T09:38:00.000Z',
  blend: 'normal' as const,
  style: { colour: [0.2, 0.4, 0.6], opacity: 0.5, borderWidth: 2 },
};

const HIGHLIGHT = {
  ...SQUARE,
  index: 3,
  kind: 'highlight' as const,
  contents: '',
  author: '',
  created: null,
  blend: 'multiply' as const,
  style: { colour: [1, 0.83, 0], opacity: 1, borderWidth: null },
};

const ONE: AnnotationSelection = { page: 3, version: asDocVersion(4), items: [SQUARE] };

interface Mounted {
  readonly store: SettingsStore;
  readonly restyled: StyleChange[];
  readonly commented: string[];
  readonly authors: string[];
  readonly ran: string[];
  /** Every whole-words read the comment field asked for, by the mark's index. */
  readonly read: number[];
}

/** The computer's and Monstera's fonts as main lists them: one bundled family a text box can be drawn in (K2). */
const FONTS = {
  listed: true,
  families: [{ name: 'Carlito', origin: 'bundled' as const, embedding: 'subset' as const, bold: true, italic: true }],
  more: 0,
};

function mounted(
  selection: AnnotationSelection | undefined,
  foot: readonly UiCommand[] = [],
  measuring = false,
  // REFUSED BY NAME where a case reads nothing: an uncut comment's field must start from the walk's own text.
  words: WordsToEdit = { kind: 'problem', problem: { code: 'document-not-open' } },
  reading?: LiveReading,
): Mounted {
  const store = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  const restyled: StyleChange[] = [];
  const commented: string[] = [];
  const authors: string[] = [];
  const ran: string[] = [];
  const read: number[] = [];
  render(
    <Wrapped>
      <PropertiesPanel
        context={CONTEXT}
        onComment={(chosen, text) => {
          expect(chosen).toBe(selection);
          commented.push(text);
        }}
        wordsOf={(mark) => {
          // THE SELECTION'S PAGE AND VERSION, the walk's handle and its cut — what main reads the words by.
          expect([mark.page, mark.version]).toStrictEqual([selection?.page, selection?.version]);
          read.push(mark.index);
          return Promise.resolve(words);
        }}
        onAuthor={(chosen, author) => {
          expect(chosen).toBe(selection);
          authors.push(author);
        }}
        onRestyle={(chosen, change) => {
          expect(chosen).toBe(selection);
          restyled.push(change);
        }}
        registry={new CommandRegistry(foot.map((command) => ({ ...command, run: () => void ran.push(command.id) })))}
        selection={selection}
        settings={store}
        measuring={measuring}
        reading={reading}
        fonts={FONTS}
      />
    </Wrapped>,
  );
  return { store, restyled, commented, authors, ran, read };
}

describe('the Comment while a measurement is reshaped (the owner’s B1)', () => {
  const DISTANCE: AnnotationSelection = { ...ONE, items: [{ ...SQUARE, kind: 'measure-distance', contents: '7.5 in' }] };
  const WORDS: WordsToEdit = { kind: 'problem', problem: { code: 'document-not-open' } };

  it('shows the drag’s reading of THIS mark, the number the label shows, and a blur sends nothing', () => {
    const { commented } = mounted(DISTANCE, [], false, WORDS, { page: 3, index: SQUARE.index, text: '6.8 in' });
    const field = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Comment' });
    expect(field.value).toBe('6.8 in');
    fireEvent.blur(field);
    expect(commented).toStrictEqual([]);
  });

  it('CONTROL: a reading of ANOTHER mark, or of the same index on another page, leaves the mark’s own words', () => {
    mounted(DISTANCE, [], false, WORDS, { page: 3, index: SQUARE.index + 1, text: '6.8 in' });
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Comment' }).value).toBe('7.5 in');
    cleanup();
    mounted(DISTANCE, [], false, WORDS, { page: 4, index: SQUARE.index, text: '6.8 in' });
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Comment' }).value).toBe('7.5 in');
  });
});

describe('PropertiesPanel while a measurement is drawn (the owner’s item 14a)', () => {
  it('shows the unit, inches as the rulers are, and the drawing’s scale — and neither for any other tool', () => {
    mounted(undefined, [], true);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Measurement unit' }).value).toBe('in');
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Drawing scale, 1 to' }).value).toBe('1');
    cleanup();
    // CONTROL: the same panel with no measurement tool has neither row.
    mounted(undefined);
    expect(screen.queryByRole('combobox', { name: 'Measurement unit' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Drawing scale, 1 to' })).toBeNull();
  });

  it('writes the unit chosen and the scale typed, and leaves the scale while the field is empty', () => {
    const { store } = mounted(undefined, [], true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Measurement unit' }), { target: { value: 'cm' } });
    expect(store.get('editing.measure-unit')).toBe('cm');
    const scale = screen.getByRole('spinbutton', { name: 'Drawing scale, 1 to' });
    fireEvent.change(scale, { target: { value: '' } });
    // MID-TYPING: the field is empty and the scale is what it was.
    expect((scale as HTMLInputElement).value).toBe('');
    expect(store.get('editing.measure-ratio')).toBe(1);
    fireEvent.change(scale, { target: { value: '100' } });
    expect(store.get('editing.measure-ratio')).toBe(100);
  });
});

describe('PropertiesPanel with marks selected', () => {
  it('names the kind and the page a person reads, 1-based', () => {
    mounted(ONE);
    expect(screen.getByRole('heading', { name: 'Rectangle' })).toBeTruthy();
    expect(screen.getByText('Page 4')).toBeTruthy();
  });

  it('a swatch sends the COLOUR ALONE, so the marks keep their own opacity and width', () => {
    const { restyled } = mounted(ONE);
    const yellow = STYLE_PRESETS[0];
    fireEvent.click(screen.getByRole('button', { name: 'Yellow' }));
    expect(yellow?.hex).toBe('#ffd400');
    // `colourFromHex`'s four places: 0xd4 / 255 is 0.83137…
    expect(restyled).toStrictEqual([{ colour: [1, 0.8314, 0] }]);
  });

  it('and writes it as the default too while *Use as default* is ticked, which it is at first', () => {
    const { store } = mounted(ONE);
    expect(store.get(STYLE_AS_DEFAULT_SETTING.id)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).toBe('#2fbf71');
  });

  it('CONTROL: unticked, the same swatch leaves the default alone', () => {
    const { store, restyled } = mounted(ONE);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use as default for new annotations' }));
    expect(store.get(STYLE_AS_DEFAULT_SETTING.id)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    expect(restyled).toHaveLength(1);
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).toBe('auto');
  });

  it('the opacity slider sends ONCE, on release, and not while it is dragged', () => {
    const { restyled, store } = mounted(ONE);
    const slider = screen.getByRole('slider', { name: 'Opacity' });
    fireEvent.change(slider, { target: { value: '0.7' } });
    fireEvent.change(slider, { target: { value: '0.8' } });
    expect(restyled).toStrictEqual([]);
    fireEvent.pointerUp(slider);
    expect(restyled).toStrictEqual([{ opacity: 0.8 }]);
    expect(store.get(ANNOTATION_OPACITY_SETTING.id)).toBe(0.8);
  });

  it('CONTROL: a release that changed nothing sends nothing', () => {
    const { restyled } = mounted(ONE);
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'Opacity' }));
    expect(restyled).toStrictEqual([]);
  });

  it('the slider SHOWS the mark’s own opacity, and offers no value the payload would refuse', () => {
    // The mark is at 0.5 and the opacity setting starts at 1, so a slider showing the setting reads differently.
    mounted(ONE);
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Opacity' });
    expect(slider.value).toBe('0.5');
    expect(slider.max).toBe('1');
    // Its floor is the LOWEST value the contract accepts: at it, accepted; a hundredth under, refused.
    expect(annotationOpacitySchema.safeParse(Number(slider.min)).success).toBe(true);
    expect(annotationOpacitySchema.safeParse(Number(slider.min) - 0.01).success).toBe(false);
  });

  it('a foreign mark fainter than the floor shows AT the floor, not off the slider’s end', () => {
    // THE READOUT, not the slider's value: happy-dom, like a browser, pulls a range input below its `min` up
    // to it by itself, so the slider reads the floor whether or not the panel clamped. The `<output>` beside
    // it is drawn from the panel's own number and is where a missing clamp shows.
    const readout = (): string | null => document.querySelector('.m-properties__value')?.textContent ?? null;
    mounted({ ...ONE, items: [{ ...SQUARE, style: { ...SQUARE.style, opacity: MIN_ANNOTATION_OPACITY } }] });
    const atFloor = readout();
    cleanup();

    mounted({ ...ONE, items: [{ ...SQUARE, style: { ...SQUARE.style, opacity: 0.05 } }] });
    expect(atFloor).not.toBeNull();
    expect(readout()).toBe(atFloor);
    expect(screen.getByRole<HTMLInputElement>('slider', { name: 'Opacity' }).value).toBe(String(MIN_ANNOTATION_OPACITY));
  });

  it('a width segment sends the width alone, and the pressed one sends nothing', () => {
    const { restyled, store } = mounted(ONE);
    fireEvent.click(screen.getByRole('button', { name: '2 pt' }));
    expect(restyled).toStrictEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '5 pt' }));
    expect(restyled).toStrictEqual([{ borderWidth: 5 }]);
    expect(store.get(ANNOTATION_LINE_WIDTH_SETTING.id)).toBe(5);
  });

  it('SAYS a highlight has no line width rather than offering a width that sets nothing', () => {
    mounted({ ...ONE, items: [HIGHLIGHT] });
    expect(screen.queryByRole('group', { name: 'Line width' })).toBeNull();
    expect(screen.getByText('This kind carries no line width.')).toBeTruthy();
  });

  it('the comment is sent when focus leaves it changed, and not when unchanged', () => {
    const { commented, read } = mounted(ONE);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect((field as HTMLTextAreaElement).value).toBe('check the figure');
    fireEvent.blur(field);
    expect(commented).toStrictEqual([]);
    fireEvent.change(field, { target: { value: 'confirm the rate' } });
    fireEvent.blur(field);
    expect(commented).toStrictEqual(['confirm the rate']);
    // AN UNCUT COMMENT IS NOT READ AGAIN: the walk's text is whole and from the walk the handle points into.
    expect(read).toStrictEqual([]);
  });

  /** The square, listed by a walk that sliced its comment to the listing's 512 characters. */
  const CUT: AnnotationSelection = { ...ONE, items: [{ ...SQUARE, contents: 'a'.repeat(512), cut: true }] };

  it('a CUT comment’s field starts from the WHOLE words, and is read only until they arrive', async () => {
    // Opened on the slice, the first blur after any change would save 512 characters over 600 and lose the end.
    const whole = `${'a'.repeat(600)} the end`;
    const { commented, read } = mounted(CUT, [], false, { kind: 'words', text: whole });
    const field = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Comment' });
    // MEANWHILE the walk's own start of the comment, which a blur cannot send.
    expect([field.readOnly, field.value]).toStrictEqual([true, 'a'.repeat(512)]);
    fireEvent.blur(field);
    await screen.findByDisplayValue(whole);
    expect([field.readOnly, read]).toStrictEqual([false, [SQUARE.index]]);
    fireEvent.blur(field);
    expect(commented).toStrictEqual([]);
    fireEvent.change(field, { target: { value: `b${whole.slice(1)}` } });
    fireEvent.blur(field);
    expect(commented).toStrictEqual([`b${whole.slice(1)}`]);
  });

  it('a comment TOO LONG to write back stays read only and says so, and nothing is sent', async () => {
    const { commented } = mounted(CUT, [], false, { kind: 'too-long' });
    await screen.findByText(
      'This comment is too long to edit here, so it has been kept as it is. You can still reply to it, copy it or delete it.',
    );
    const field = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Comment' });
    expect([field.readOnly, field.value]).toStrictEqual([true, 'a'.repeat(512)]);
    fireEvent.change(field, { target: { value: 'typed anyway' } });
    fireEvent.blur(field);
    expect(commented).toStrictEqual([]);
  });

  it('the AUTHOR is sent when focus leaves it changed, and not when unchanged (ADR-0103)', () => {
    const { authors } = mounted(ONE);
    const field = screen.getByRole('textbox', { name: 'Author' });
    expect((field as HTMLInputElement).value).toBe('Priya Raman');
    fireEvent.blur(field);
    expect(authors).toStrictEqual([]);
    fireEvent.change(field, { target: { value: 'Sam Okafor' } });
    fireEvent.blur(field);
    expect(authors).toStrictEqual(['Sam Okafor']);
  });

  it('shows WHEN the mark was made, read-only, and nothing for a mark with no date', () => {
    mounted(ONE);
    const created = document.querySelector('[data-properties-created]');
    expect(created?.getAttribute('data-properties-created')).toBe('2026-09-24T09:38:00.000Z');
    expect(created?.textContent).toMatch(/^Created /u);
    // READ-ONLY: nothing on the tab edits it.
    expect(screen.queryByRole('textbox', { name: /created/iu })).toBeNull();
    cleanup();
    mounted({ ...ONE, items: [HIGHLIGHT] });
    expect(document.querySelector('[data-properties-created]')).toBeNull();
  });

  it('BLEND shows the mark’s own and sends the other as a restyle, never as a default', () => {
    const { restyled, store } = mounted({ ...ONE, items: [HIGHLIGHT] });
    const multiply = screen.getByRole('button', { name: 'Multiply' });
    expect(multiply.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(multiply);
    // THE PRESSED ONE SENDS NOTHING: no restyle for a document that would not change.
    expect(restyled).toStrictEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Normal' }));
    expect(restyled).toStrictEqual([{ blend: 'normal' }]);
    // *Use as default* is on, and the blend is not one of the settings it writes.
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).toBe('auto');
  });

  const TEXT_BOX = {
    ...SQUARE,
    index: 5,
    kind: 'text-box' as const,
    typed: { fontSize: 12, colour: [0, 0, 0] as [number, number, number], font: 'sans' as const, direction: 'left-to-right' as const },
  };

  it('a TEXT BOX shows Text, then Box, then its comment details FOLDED, and no comment field for its words (E4)', () => {
    mounted({ ...ONE, items: [TEXT_BOX] });
    const groups = [...document.querySelectorAll('[data-text-section], [data-properties-box], [data-properties-comment-details]')];
    expect(groups.map((group) => group.getAttribute('aria-label') ?? group.tagName)).toStrictEqual(['Text', 'Box', 'DETAILS']);
    // THE BOX'S LOOK is in the Box group: its border colour's swatches sit inside it.
    expect(document.querySelector('[data-properties-box] [role="radiogroup"], [data-properties-box] button')).not.toBeNull();
    const details = document.querySelector('[data-properties-comment-details]');
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.textContent).toContain('Blend');
    expect(details?.textContent).toContain('Author');
    // THE BLEND CONTROL ITSELF is in the fold, which the word above does not separate from a label left behind.
    expect(screen.getByRole('group', { name: 'Blend', hidden: true }).closest('details')).toBe(details);
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull();
  });

  it('CONTROL: a mark that is not a text box keeps its comment field and its blend unfolded', () => {
    mounted(ONE);
    expect(document.querySelector('[data-properties-comment-details]')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Comment' })).not.toBeNull();
    // THE BLEND the title names, read as a control and not as a word: shown, and inside no fold.
    expect(screen.getByRole('group', { name: 'Blend' }).closest('details')).toBeNull();
  });

  it('a TEXT BOX shows a Text section, and each control sends ONE property of its words', () => {
    const { restyled, store } = mounted({ ...ONE, items: [TEXT_BOX] });
    expect(document.querySelector('[data-text-section]')).not.toBeNull();
    // THE ONE FONT PICKER, by the real names (K4), sent BY NAME (K2): the kernel draws the family and takes `/DA`'s class.
    fireEvent.click(screen.getByRole('button', { name: 'Font: Helvetica' }));
    const times = document.querySelector('[data-font-choice="Times"]');
    if (times === null) throw new Error('Times is not offered');
    fireEvent.click(times);
    expect(restyled).toStrictEqual([{ text: { family: 'Times' } }]);
    fireEvent.click(screen.getByRole('button', { name: 'Align right' }));
    expect(restyled.at(-1)).toStrictEqual({ text: { align: 'right' } });
    const size = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Size in points' });
    expect(size.value).toBe('12');
    fireEvent.change(size, { target: { value: '18' } });
    fireEvent.blur(size);
    expect(restyled.at(-1)).toStrictEqual({ text: { fontSize: 18 } });
    // *Use as default* is ticked, so the face and size just chosen are what the next text box starts in.
    expect(store.get(ANNOTATION_FONT_SETTING.id)).toBe('Times');
    expect(store.get(ANNOTATION_FONT_SIZE_SETTING.id)).toBe(18);
  });

  it('the style controls kept as the default become how the next text box is set (B5.9); unticked, they are not', () => {
    const { store } = mounted({ ...ONE, items: [TEXT_BOX] });
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Justify' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fill the box' }));
    // MERGED, each control adding its member to what was kept, so the third does not take the first two away.
    expect(store.get(TEXT_BOX_LOOK_SETTING.id)).toStrictEqual({ bold: true, align: 'justify', fill: [1, 1, 0.8] });
    cleanup();
    // CONTROL: the same press with *Use as default* unticked keeps nothing.
    const unticked = mounted({ ...ONE, items: [TEXT_BOX] });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use as default for new annotations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(unticked.store.get(TEXT_BOX_LOOK_SETTING.id)).toStrictEqual({});
  });

  it('the style controls (ADR-0211) each send ONE property: bold, justify, line spacing, padding and a fill', () => {
    const { restyled } = mounted({ ...ONE, items: [TEXT_BOX] });
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(bold);
    expect(restyled.at(-1)).toStrictEqual({ text: { bold: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Justify' }));
    expect(restyled.at(-1)).toStrictEqual({ text: { align: 'justify' } });
    const spacing = screen.getByRole('spinbutton', { name: 'Line spacing' });
    fireEvent.change(spacing, { target: { value: '1.5' } });
    fireEvent.blur(spacing);
    expect(restyled.at(-1)).toStrictEqual({ text: { lineHeight: 1.5 } });
    const padding = screen.getByRole('spinbutton', { name: 'Padding' });
    fireEvent.change(padding, { target: { value: '6' } });
    fireEvent.blur(padding);
    expect(restyled.at(-1)).toStrictEqual({ text: { padding: 6 } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fill the box' }));
    expect(restyled.at(-1)).toStrictEqual({ text: { fill: [1, 1, 0.8] } });
  });

  it('the Box group’s BORDER STYLE shows what the box has and sends the one chosen (E4)', () => {
    const { restyled } = mounted({ ...ONE, items: [TEXT_BOX] });
    const group = screen.getByRole('group', { name: 'Border style' });
    expect(group.closest('[data-properties-box]')).not.toBeNull();
    // SOLID IS SHOWN for a box the read says nothing dashed of, and choosing Dashed sends that one member.
    expect(screen.getByRole('button', { name: 'Solid' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Dashed' }));
    expect(restyled).toStrictEqual([{ text: { borderStyle: 'dashed' } }]);
    cleanup();
    // CONTROL: a box the read says is dashed shows Dashed, so the state above is the read's and not a fixed default.
    mounted({ ...ONE, items: [{ ...TEXT_BOX, typed: { ...TEXT_BOX.typed, dashed: true as const } }] });
    expect(screen.getByRole('button', { name: 'Dashed' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a text box is offered the computer’s and Monstera’s fonts (K2), and a family chosen is sent by name and kept as the default', () => {
    const { restyled, store } = mounted({ ...ONE, items: [TEXT_BOX] });
    fireEvent.click(screen.getByRole('button', { name: 'Font: Helvetica' }));
    const carlito = document.querySelector('[data-font-choice="Carlito"]');
    if (carlito === null) throw new Error('Carlito is not offered');
    fireEvent.click(carlito);
    expect(restyled).toStrictEqual([{ text: { family: 'Carlito' } }]);
    expect(store.get(ANNOTATION_FONT_SETTING.id)).toBe('Carlito');
  });

  it('CHARACTER SPACING is typed in points and sent as the fraction of the size, held to the bound it says (ADR-0228)', () => {
    const { restyled } = mounted({ ...ONE, items: [TEXT_BOX] });
    const field = screen.getByRole('spinbutton', { name: 'Character spacing in points' });
    // THE BOUND AT 12 POINTS: 0.12 of the size, which the field itself carries rather than a sentence under it (N13).
    expect([field.getAttribute('min'), field.getAttribute('max')]).toStrictEqual(['-1.44', '1.44']);
    fireEvent.change(field, { target: { value: '0.6' } });
    fireEvent.blur(field);
    expect(restyled.at(-1)).toStrictEqual({ text: { spacing: 0.05 } });
    // PAST THE BOUND, held to it rather than refused.
    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(restyled.at(-1)).toStrictEqual({ text: { spacing: 0.12 } });
    // CONTROL: the box's own spacing, typed again, sends nothing.
    const before = restyled.length;
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.blur(field);
    expect(restyled).toHaveLength(before);
  });

  it('a box drawn in a real family SHOWS that family by name, not its `/DA` class', () => {
    mounted({ ...ONE, items: [{ ...TEXT_BOX, typed: { ...TEXT_BOX.typed, family: 'Carlito' } }] });
    expect(screen.getByRole('button', { name: 'Font: Carlito' })).toBeTruthy();
  });

  it('CONTROL: a mark Monstera cannot draw — a callout — is offered the standard faces alone', () => {
    mounted({ ...ONE, items: [{ ...TEXT_BOX, typed: { ...TEXT_BOX.typed, stylesUnavailable: true as const } }] });
    fireEvent.click(screen.getByRole('button', { name: 'Font: Helvetica' }));
    expect(document.querySelector('[data-font-choice="Times"]')).not.toBeNull();
    expect(document.querySelector('[data-font-choice="Carlito"]')).toBeNull();
  });

  it('a box that cannot take the styles is shown only its font, size, colour and alignment, with no sentence (N13)', () => {
    const { restyled } = mounted({
      ...ONE,
      items: [{ ...TEXT_BOX, typed: { ...TEXT_BOX.typed, stylesUnavailable: true as const } }],
    });
    const section = document.querySelector('[data-text-section]');
    if (section === null) throw new Error('the Text section is not drawn');
    const names = [...section.querySelectorAll('button, input')].map(
      (control) => control.getAttribute('aria-label') ?? (control as HTMLInputElement).labels?.[0]?.textContent ?? '',
    );
    // WHAT IS DRAWN, named: the rows a callout's writer takes, and none it cannot.
    expect(names).toContain('Size in points');
    expect(names).toContain('Align right');
    for (const absent of ['Bold', 'Superscript', 'Justify', 'Line spacing', 'Character spacing in points']) {
      expect(names).not.toContain(absent);
    }
    expect(section.querySelector('p')).toBeNull();
    expect(restyled).toStrictEqual([]);
  });

  it('CONTROL: a box Monstera draws is shown the style row, justify and the spacings in the same section', () => {
    mounted({ ...ONE, items: [TEXT_BOX] });
    const section = document.querySelector('[data-text-section]');
    expect(section?.querySelector('[aria-label="Bold"]')).not.toBeNull();
    expect(section?.querySelector('[aria-label="Justify"]')).not.toBeNull();
    expect(screen.getByRole('spinbutton', { name: 'Line spacing' }).closest('[data-text-section]')).toBe(section);
  });

  it('a box that draws NO BORDER — a typewriter, `/BS /W 0` — is offered no border style; one with a border is', () => {
    mounted({ ...ONE, items: [{ ...TEXT_BOX, kind: 'typewriter' as const, style: { ...TEXT_BOX.style, borderWidth: 0 } }] });
    expect(document.querySelector('[data-properties-box]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: 'Border style' })).toBeNull();
    cleanup();
    // CONTROL: the same box with a one-point border shows it, so the absence above is the width's and not the section's.
    mounted({ ...ONE, items: [{ ...TEXT_BOX, kind: 'typewriter' as const, style: { ...TEXT_BOX.style, borderWidth: 1 } }] });
    expect(screen.getByRole('group', { name: 'Border style' })).toBeTruthy();
  });

  it('CONTROL: a size that is out of range, or unchanged, sends nothing', () => {
    const { restyled } = mounted({ ...ONE, items: [TEXT_BOX] });
    const size = screen.getAllByRole('spinbutton').find((each) => (each as HTMLInputElement).value === '12');
    if (size === undefined) throw new Error('the size field is not drawn');
    fireEvent.blur(size);
    fireEvent.change(size, { target: { value: '0' } });
    fireEvent.blur(size);
    expect(restyled).toStrictEqual([]);
  });

  it('CONTROL: a mark that is not a text box has no Text section', () => {
    mounted({ ...ONE, items: [SQUARE] });
    expect(document.querySelector('[data-text-section]')).toBeNull();
  });

  it('offers no comment for TWO marks, which have two', () => {
    mounted({ ...ONE, items: [SQUARE, HIGHLIGHT] });
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull();
    expect(screen.getByText('2 selected · page 4')).toBeTruthy();
  });

  it('draws the commands placed at its foot, in order, and runs the one pressed', () => {
    const placed = (id: string, title: typeof REPLY_SELECTION_TITLE, order: number): UiCommand => ({
      id,
      feedback: { kind: 'visible' },
      title,
      placements: [{ surface: 'properties', order }],
      run: () => undefined,
    });
    const { ran } = mounted(ONE, [placed('t.delete', DELETE_SELECTION_TITLE, 20), placed('t.reply', REPLY_SELECTION_TITLE, 10)]);
    const foot = screen.getByRole('group', { name: 'Selected annotation' });
    const names = Array.from(foot.querySelectorAll('button')).map((button) => button.textContent);
    expect(names).toStrictEqual(['Reply…', 'Delete selection']);
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(ran).toStrictEqual(['t.delete']);
  });

  it('CONTROL: a foot command whose `when` is false is not drawn', () => {
    mounted(ONE, [
      {
        id: 't.reply',
        title: REPLY_SELECTION_TITLE,
        placements: [{ surface: 'properties', order: 10 }],
        when: () => false,
        run: () => undefined,
        feedback: { kind: 'visible' },
      },
    ]);
    expect(screen.queryByRole('group', { name: 'Selected annotation' })).toBeNull();
  });
});

describe('PropertiesPanel with nothing selected', () => {
  it('shows the authoring settings, and *Each tool’s own* is pressed on a fresh install', () => {
    mounted(undefined);
    expect(screen.getByRole('heading', { name: 'New annotations' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Each tool’s own' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a swatch writes the colour setting, and *Each tool’s own* writes `auto` back', () => {
    const { store, restyled } = mounted(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Purple' }));
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).toBe('#9b6bf2');
    fireEvent.click(screen.getByRole('button', { name: 'Each tool’s own' }));
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).toBe('auto');
    // NOTHING WAS SENT: with no mark selected there is nothing to restyle.
    expect(restyled).toStrictEqual([]);
  });

  it('offers no comment and no foot, which belong to a mark', () => {
    mounted(undefined, [
      {
        id: 't.reply',
        title: REPLY_SELECTION_TITLE,
        placements: [{ surface: 'properties', order: 10 }],
        run: () => undefined,
        feedback: { kind: 'visible' },
      },
    ]);
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Selected annotation' })).toBeNull();
  });
});

describe('PropertiesPanel with an object selected on the page (ADR-0153 Decision 5)', () => {
  const RULE: ObjectPick = {
    page: 2,
    version: asDocVersion(4),
    object: { source: 'content', index: 1, ordinal: 0, kind: 'path', box: { x0: 0, y0: 0, x1: 10, y1: 1 }, drawn: { x0: 0, y0: 0, x1: 10, y1: 1 }, members: [1], fill: { red: 0, green: 0, blue: 0, alpha: 128 } },
    walked: 3,
  };

  const placed: unknown[] = [];
  const turned: number[] = [];
  function shown(pick: ObjectPick): string[] {
    const colours: string[] = [];
    placed.length = 0;
    turned.length = 0;
    render(
      <Wrapped>
        <PropertiesPanel
          context={CONTEXT}
          object={{
            pick,
            onRecolour: (colour) => colours.push(JSON.stringify(colour)),
            onPlace: (target) => placed.push(target),
            onTurn: (degrees) => turned.push(degrees),
          }}
          onAuthor={() => undefined}
          onComment={() => undefined}
          wordsOf={() => Promise.reject(new Error('an object has no comment to read'))}
          onRestyle={() => undefined}
          registry={new CommandRegistry([])}
          selection={undefined}
          settings={new SettingsStore(new SettingsRegistry(ALL_SETTINGS))}
        />
      </Wrapped>,
    );
    return colours;
  }

  it('names the object and FILLS it with the swatch picked, its own transparency kept', () => {
    const colours = shown(RULE);
    expect(screen.getByRole('heading', { name: 'Object' })).toBeDefined();
    expect(screen.getByText('Kind: Shape')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Yellow' }));
    // #ffd400 in PDFium's 0–255, and the 128 the shape was drawn at rather than an opaque 255.
    expect(colours).toStrictEqual([JSON.stringify({ red: 255, green: 212, blue: 0, alpha: 128 })]);
  });

  it('offers NO colour for a picture, which has no fill, and says why for a shape whose colour cannot be read', () => {
    shown({ ...RULE, object: { ...RULE.object, kind: 'picture', source: 'stamp', fill: null } });
    expect(screen.getByText('Kind: Image')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Yellow' })).toBeNull();
    expect(screen.queryByText('Monstera cannot read a colour for this object, so it cannot change it.')).toBeNull();
    cleanup();
    // CONTROL: a shape with no readable fill is told, since it is the kind a person expects a colour on.
    shown({ ...RULE, object: { ...RULE.object, fill: null } });
    expect(screen.queryByRole('button', { name: 'Yellow' })).toBeNull();
    expect(screen.getByText('Monstera cannot read a colour for this object, so it cannot change it.')).toBeDefined();
  });

  it('shows WHERE it is, how big and how far turned, and a number typed is a placement (E6)', () => {
    shown({ ...RULE, object: { ...RULE.object, box: { x0: 72, y0: 100, x1: 172, y1: 150 }, turn: 30 } });
    const field = (name: string): HTMLInputElement => screen.getByLabelText(name);
    expect([field('Left (pt)').value, field('Bottom (pt)').value, field('Width (pt)').value, field('Height (pt)').value, field('Rotation (°)').value]).toStrictEqual([
      '72',
      '100',
      '100',
      '50',
      '30',
    ]);
    // LEFT TYPED: the box moves and keeps its size.
    fireEvent.change(field('Left (pt)'), { target: { value: '90' } });
    fireEvent.blur(field('Left (pt)'));
    // WIDTH TYPED and Enter: the left edge stays.
    fireEvent.change(field('Width (pt)'), { target: { value: '200' } });
    fireEvent.keyDown(field('Width (pt)'), { key: 'Enter' });
    expect(placed).toStrictEqual([
      { x0: 90, y0: 100, x1: 190, y1: 150 },
      { x0: 72, y0: 100, x1: 272, y1: 150 },
    ]);
    // ROTATION TYPED is the angle it should stand at; the command turns BY the difference.
    fireEvent.change(field('Rotation (°)'), { target: { value: '45' } });
    fireEvent.blur(field('Rotation (°)'));
    expect(turned).toStrictEqual([15]);
  });

  it('CONTROL: a field left as it was, or emptied, sends nothing', () => {
    shown(RULE);
    fireEvent.blur(screen.getByLabelText('Left (pt)'));
    fireEvent.change(screen.getByLabelText('Height (pt)'), { target: { value: '' } });
    fireEvent.blur(screen.getByLabelText('Height (pt)'));
    expect(placed).toStrictEqual([]);
  });

  it('a block of text shows how it is set, and a placed picture, which cannot be turned, has no rotation', () => {
    shown({ ...RULE, object: { ...RULE.object, kind: 'text', look: { size: 11, bold: true, italic: false, family: 'serif' } } });
    expect(screen.getByText('Text size (pt): 11')).toBeDefined();
    expect(screen.getByText('Style: Bold')).toBeDefined();
    expect(screen.getByText('Font: Serif')).toBeDefined();
    cleanup();
    shown({ ...RULE, object: { ...RULE.object, kind: 'picture', source: 'stamp', fill: null } });
    expect(screen.getByLabelText('Left (pt)')).toBeDefined();
    expect(screen.queryByLabelText('Rotation (°)')).toBeNull();
  });
});

describe('PropertiesPanel while Edit object is on with nothing picked (the owner’s E8)', () => {
  function drawn(objectMode: boolean): void {
    render(
      <Wrapped>
        <PropertiesPanel
          context={CONTEXT}
          objectMode={objectMode}
          onAuthor={() => undefined}
          onComment={() => undefined}
          onRestyle={() => undefined}
          registry={new CommandRegistry([])}
          selection={undefined}
          settings={new SettingsStore(new SettingsRegistry(ALL_SETTINGS))}
          wordsOf={() => Promise.reject(new Error('nothing is selected'))}
        />
      </Wrapped>,
    );
  }

  it('says what the mode is for, as the status line does, and offers no annotation defaults', () => {
    drawn(true);
    expect(screen.getByRole('heading', { name: 'Object' })).toBeDefined();
    expect(screen.getByText('Click an object on the page to see where it is and change it.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Yellow' })).toBeNull();
    cleanup();
    // CONTROL: with the mode off, the same panel is the next annotation's, so the text above is the mode's.
    drawn(false);
    expect(screen.getByRole('heading', { name: 'New annotations' })).toBeDefined();
  });
});

describe('PropertiesPanel for an insertion mark (the owner’s O5)', () => {
  /** A caret 20 wide by 14 tall, as MuPDF draws one by default. */
  const CARET = { ...HIGHLIGHT, index: 2, kind: 'caret' as const, rect: { x0: 90, y0: 93, x1: 110, y1: 107 } };

  function withResize(selection: AnnotationSelection): { store: SettingsStore; resized: number[] } {
    const store = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    const resized: number[] = [];
    render(
      <Wrapped>
        <PropertiesPanel
          context={CONTEXT}
          onAuthor={() => undefined}
          onComment={() => undefined}
          onResize={(chosen, size) => {
            expect(chosen).toBe(selection);
            resized.push(size);
          }}
          onRestyle={() => undefined}
          registry={new CommandRegistry([])}
          selection={selection}
          settings={store}
          wordsOf={() => Promise.resolve({ kind: 'problem', problem: { code: 'document-not-open' } })}
        />
      </Wrapped>,
    );
    return { store, resized };
  }

  it('shows its SIZE, its height in points, and a size typed and entered resizes it', () => {
    const { resized, store } = withResize({ page: 3, version: asDocVersion(4), items: [CARET] });
    act(() => {
      store.set(STYLE_AS_DEFAULT_SETTING.id, false);
    });
    const field = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Size' });
    expect(field.value).toBe('14');
    fireEvent.change(field, { target: { value: '30' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(resized).toStrictEqual([30]);
    // CONTROL: with *Use as default* off the next caret's size is left as it was.
    expect(store.get(CARET_SIZE_SETTING.id)).toBe('auto');
  });

  it('with USE AS DEFAULT ticked, the size typed is kept for the next insertion mark', () => {
    const { resized, store } = withResize({ page: 3, version: asDocVersion(4), items: [CARET] });
    act(() => {
      store.set(STYLE_AS_DEFAULT_SETTING.id, true);
    });
    const field = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Size' });
    fireEvent.change(field, { target: { value: '24' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(resized).toStrictEqual([24]);
    expect(store.get(CARET_SIZE_SETTING.id)).toBe(24);
  });

  it('CONTROL: a square, or a caret selected beside one, shows no Size', () => {
    withResize({ page: 3, version: asDocVersion(4), items: [CARET, SQUARE] });
    expect(screen.queryByRole('spinbutton', { name: 'Size' })).toBeNull();
  });

  it('a caret’s box at a size is its own box scaled about its centre, the way it faces kept', () => {
    expect(caretRectAt(CARET.rect, 28)).toStrictEqual({ x0: 80, y0: 86, x1: 120, y1: 114 });
    // TURNED: a caret on a page at 90 degrees is tall in PDF space, and stays so.
    expect(caretRectAt({ x0: 93, y0: 90, x1: 107, y1: 110 }, 28)).toStrictEqual({ x0: 86, y0: 80, x1: 114, y1: 120 });
    expect(caretSizeOf(CARET.rect)).toBe(14);
  });
});
