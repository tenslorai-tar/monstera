// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from './i18n.js';
import { InlineWriter } from './InlineWriter.js';
import { EN, WRITE_NOTE_LABEL, WRITE_TEXT_BOX_LABEL, WRITE_TOO_LONG } from './messages/en.js';
import { type Draft, type WriteRequest, draftOf } from './pageWriting.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/**
 * Words typed where they go (ADR-0154): the editor a page draws over its own page for the one pending request. The
 * tools' cases (`textTools.test.ts` and its siblings) see which request a gesture makes and cannot see a box; this sees
 * the box and what each way of ending it answers, and cannot see a tool.
 *
 * `ObjectEditLayer.test`'s geometry on purpose: a non-zero crop origin and a zoom that is not 1, so an editor passing
 * PDF numbers straight through fails rather than coincides.
 */
const GEOMETRY = {
  crop: [50, 100, 250, 400] as readonly [number, number, number, number],
  rotation: 0 as const,
  zoom: 2,
};

/** Lower-left (60, 350) and upper-right (110, 390): its top-left lands at (20, 20) on screen, 100 by 80 pixels. */
const BLOCK: WriteRequest = {
  page: 0,
  box: { x0: 60, y0: 350, x1: 110, y1: 390 },
  shape: 'block',
  initial: '',
  label: WRITE_TEXT_BOX_LABEL,
  style: { fontSize: 12, colour: [0.85, 0.15, 0.15], font: 'serif', direction: 'left-to-right' },
};

/** A note's comment: words the page does not draw where they are typed, so a request with no style. */
const NOTE: WriteRequest = {
  page: 0,
  box: { x0: 60, y0: 390, x1: 60, y1: 390 },
  shape: 'block',
  initial: '',
  label: WRITE_NOTE_LABEL,
};

afterEach(cleanup);

function mounted(
  request: WriteRequest,
  draft: Draft = draftOf(request.initial),
): { readonly done: (string | undefined)[]; readonly draft: Draft; readonly unmount: () => void } {
  const done: (string | undefined)[] = [];
  const view = render(
    <Wrapped>
      <div className="m-page-slot" data-testid="slot">
        <InlineWriter draft={draft} geometry={GEOMETRY} onDone={(words) => done.push(words)} request={request} />
      </div>
      <button type="button">Elsewhere</button>
    </Wrapped>,
  );
  return { done, draft, unmount: view.unmount };
}

function typeInto(field: HTMLElement, words: string): void {
  act(() => {
    fireEvent.change(field, { target: { value: words } });
  });
}

describe('InlineWriter', () => {
  it('draws a block OVER ITS BOX on the drawn page, in the words’ own size, colour and face, with the caret in it', () => {
    mounted(BLOCK);
    const field = screen.getByRole('textbox', { name: 'Text box' });
    const root = field.parentElement;
    // (60 − 50) × 2 across and (400 − 390) × 2 down; 50 points wide is 100 pixels at zoom 2.
    expect([root?.style.left, root?.style.top]).toStrictEqual(['20px', '20px']);
    expect([field.style.inlineSize, field.style.minBlockSize]).toStrictEqual(['100px', '80px']);
    // TWELVE POINTS AT ZOOM 2, and the colour the annotation will be drawn in.
    expect([field.style.fontSize, field.style.color]).toStrictEqual(['24px', '#d92626']);
    expect(field.classList.contains('m-inline-writer__block--serif')).toBe(true);
    expect(document.activeElement).toBe(field);
  });

  it('a GROWING block keeps the box as its least size and the page’s right edge as its most, rather than one size', () => {
    mounted({ ...BLOCK, grows: true });
    const field = screen.getByRole('textbox', { name: 'Text box' });
    // The page is 200 points wide at zoom 2: 400 pixels, of which 380 lie right of the box's left edge.
    expect([field.style.minInlineSize, field.style.maxInlineSize, field.style.inlineSize]).toStrictEqual(['100px', '380px', '']);
  });

  it('ESCAPE FINISHES a block and keeps its words — the owner’s *click outside or Esc to finish*', () => {
    const { done } = mounted(BLOCK);
    const field = screen.getByRole('textbox', { name: 'Text box' });
    typeInto(field, 'see figure 3');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(done).toStrictEqual(['see figure 3']);
  });

  it('a COMPOSITION’S Escape and Ctrl+Enter are the input method’s, and finish nothing (CR-COR-07)', () => {
    const { done } = mounted(BLOCK);
    const field = screen.getByRole('textbox', { name: 'Text box' });
    typeInto(field, 'にほんご');
    // ESCAPE CANCELS THE CANDIDATE, and Ctrl+Enter is a key the composition is still taking.
    fireEvent.keyDown(field, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(done).toStrictEqual([]);
    // CONTROL: with the composition closed, the same Escape finishes.
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(done).toStrictEqual(['にほんご']);
  });

  it('answers ONCE: the blur that follows a finish is not a second answer', () => {
    const { done } = mounted(BLOCK);
    const field = screen.getByRole('textbox', { name: 'Text box' });
    typeInto(field, 'see figure 3');
    fireEvent.keyDown(field, { key: 'Escape' });
    fireEvent.blur(field);
    expect(done).toStrictEqual(['see figure 3']);
  });

  it('Ctrl+Enter finishes a block, and plain Enter does not — it is a new line', () => {
    const { done } = mounted(BLOCK);
    const field = screen.getByRole('textbox', { name: 'Text box' });
    typeInto(field, 'two\nlines');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(done).toStrictEqual([]);
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
    expect(done).toStrictEqual(['two\nlines']);
  });

  it('keeps the page’s keys out: a key typed here does not reach the application’s shortcuts on the document', () => {
    const reached = vi.fn();
    mounted(BLOCK);
    document.addEventListener('keydown', reached);
    try {
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Text box' }), { key: 'Delete' });
      expect(reached).not.toHaveBeenCalled();
      // CONTROL: the same key pressed anywhere else does reach them, so the silence above is the editor's doing.
      fireEvent.keyDown(screen.getByRole('button', { name: 'Elsewhere' }), { key: 'Delete' });
      expect(reached).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', reached);
    }
  });

  it('a press elsewhere ON THE PAGE finishes it and goes no further, so it cannot also start the next box', () => {
    const { done } = mounted(BLOCK);
    typeInto(screen.getByRole('textbox', { name: 'Text box' }), 'see figure 3');
    const slot = screen.getByTestId('slot');
    const beyond = vi.fn();
    slot.addEventListener('pointerdown', beyond);
    const press = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    act(() => {
      slot.dispatchEvent(press);
    });
    expect(done).toStrictEqual(['see figure 3']);
    expect(beyond).not.toHaveBeenCalled();
    expect(press.defaultPrevented).toBe(true);
  });

  it('CONTROL: a press OFF the page goes where it was aimed and does not finish the box by itself', () => {
    // The press above and this one differ only in where they land: off the page, the editor leaves the press alone,
    // and the box ends only because its focus leaves it — which `answers once` above covers.
    const { done } = mounted(BLOCK);
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    const aimed = vi.fn();
    elsewhere.addEventListener('pointerdown', aimed);
    act(() => {
      elsewhere.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    expect(aimed).toHaveBeenCalledTimes(1);
    expect(done).toStrictEqual([]);
  });

  it('keeps every change in the request’s DRAFT, and starts from the draft when drawn again', () => {
    const draft = draftOf('');
    const first = mounted(BLOCK, draft);
    typeInto(screen.getByRole('textbox', { name: 'Text box' }), 'half a sentence');
    expect(draft.read()).toBe('half a sentence');
    // ANOTHER DOCUMENT ON SHOW takes the editor off the page with the request still open; drawn again, it continues.
    first.unmount();
    mounted(BLOCK, draft);
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Text box' }).value).toBe('half a sentence');
  });

  // NOT THE BROWSER'S PROOF: happy-dom fires no blur when a focused node is removed, and Chromium does. That one is
  // `pageWriting.pw.ts`'s, which also shows the same switch made by a click on the tab does answer.
  it('being TAKEN OFF THE PAGE is not an ending: nothing is answered', () => {
    const { done, unmount } = mounted(BLOCK);
    typeInto(screen.getByRole('textbox', { name: 'Text box' }), 'half a sentence');
    unmount();
    expect(done).toStrictEqual([]);
  });

  it('says what its rule refuses AS IT IS TYPED, and stays open with the words when a person finishes', () => {
    const { done } = mounted({ ...BLOCK, check: (text) => (text.length > 5 ? WRITE_TOO_LONG : undefined) });
    const field = screen.getByRole('textbox', { name: 'Text box' });
    typeInto(field, 'far too long');
    expect(screen.getByText('That is too long for one annotation. Shorten it, or use several.')).toBeDefined();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(done).toStrictEqual([]);
    expect((field as HTMLTextAreaElement).value).toBe('far too long');
  });

  it('CONTROL: within its rule, the same box says nothing and finishes', () => {
    const { done } = mounted({ ...BLOCK, check: (text) => (text.length > 5 ? WRITE_TOO_LONG : undefined) });
    const field = screen.getByRole('textbox', { name: 'Text box' });
    typeInto(field, 'short');
    expect(field.getAttribute('aria-invalid')).toBe('false');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(done).toStrictEqual(['short']);
  });

  it('a block NOT DRAWN ON THE PAGE — a note’s comment — is the application’s own field, on a card beside the point', () => {
    mounted(NOTE);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.classList.contains('m-input')).toBe(true);
    const card = field.parentElement;
    // UNDER AND RIGHT OF THE POINT, at (20, 20): the page has more room below it and to its right.
    expect([card?.style.left, card?.style.top]).toStrictEqual(['20px', '20px']);
  });

  it('CONTROL: a card for a point near the page’s FOOT and RIGHT EDGE opens above it and to its left', () => {
    // The page is 400 by 600 pixels; (240, 120) in PDF is (380, 560) on screen, with more room above and to the left.
    mounted({ ...NOTE, box: { x0: 240, y0: 120, x1: 240, y1: 120 } });
    const card = screen.getByRole('textbox', { name: 'Comment' }).parentElement;
    expect([card?.style.left, card?.style.top, card?.style.right, card?.style.bottom]).toStrictEqual(['', '', '20px', '40px']);
  });
});
