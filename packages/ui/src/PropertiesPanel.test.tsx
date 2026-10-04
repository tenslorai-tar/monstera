// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { annotationOpacitySchema, MIN_ANNOTATION_OPACITY } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { WordsToEdit } from './annotations/markWords.js';
import type { AnnotationSelection } from './annotations/selectTool.js';
import { STYLE_PRESETS } from './annotations/stylePresets.js';
import { activateCatalogue, i18n } from './i18n.js';
import { DELETE_SELECTION_TITLE, EN, REPLY_SELECTION_TITLE } from './messages/en.js';
import type { ObjectPick } from './objectEditing.js';
import { PropertiesPanel, type StyleChange } from './PropertiesPanel.js';
import { CommandRegistry, type CommandContext, type UiCommand } from './registries/commands.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import {
  ANNOTATION_COLOUR_SETTING,
  ANNOTATION_LINE_WIDTH_SETTING,
  ANNOTATION_OPACITY_SETTING,
  STYLE_AS_DEFAULT_SETTING,
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

function mounted(
  selection: AnnotationSelection | undefined,
  foot: readonly UiCommand[] = [],
  measuring = false,
  // REFUSED BY NAME where a case reads nothing: an uncut comment's field must start from the walk's own text.
  words: WordsToEdit = { kind: 'problem', problem: { code: 'document-not-open' } },
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
      />
    </Wrapped>,
  );
  return { store, restyled, commented, authors, ran, read };
}

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
    object: { source: 'content', index: 1, kind: 'path', box: { x0: 0, y0: 0, x1: 10, y1: 1 }, fill: { red: 0, green: 0, blue: 0, alpha: 128 } },
  };

  function shown(pick: ObjectPick): string[] {
    const colours: string[] = [];
    render(
      <Wrapped>
        <PropertiesPanel
          context={CONTEXT}
          object={{ pick, onRecolour: (colour) => colours.push(JSON.stringify(colour)) }}
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
});
