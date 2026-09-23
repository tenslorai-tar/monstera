// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { type KeyChord, fieldOwnsChord } from './shortcuts.js';

/**
 * Which keys a focused text field keeps from the application's shortcuts.
 *
 * The rule exists because the dispatcher listens on the whole document: Ctrl+Home typed in the
 * in-place text editor turned the document to its first page (seen 2026-09-23, driving the
 * development build), and Ctrl+Z would have undone the document rather than the typing. Every
 * case has its control on the other side of the line — a rule that kept everything for a field
 * passes the first half of each, and one that kept nothing passes the second.
 */

function press(key: string, held: Partial<Omit<KeyChord, 'key'>> = {}): KeyChord {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...held };
}

const area = document.createElement('textarea');
const field = document.createElement('input');
field.type = 'text';
const tick = document.createElement('input');
tick.type = 'checkbox';
const plain = document.createElement('div');

describe('a text field keeps the keys it answers itself', () => {
  it('keeps navigation and editing chords — Ctrl+Home, Ctrl+Z, Ctrl+V, Home, Delete', () => {
    for (const chord of [
      press('Home', { ctrlKey: true }),
      press('End', { ctrlKey: true }),
      press('z', { ctrlKey: true }),
      press('Z', { ctrlKey: true, shiftKey: true }),
      press('v', { ctrlKey: true }),
      press('ArrowLeft', { ctrlKey: true, shiftKey: true }),
      press('Home'),
      press('Delete'),
      press('A', { shiftKey: true }),
    ]) {
      expect(fieldOwnsChord(area, chord), JSON.stringify(chord)).toBe(true);
      expect(fieldOwnsChord(field, chord), JSON.stringify(chord)).toBe(true);
    }
  });

  it('CONTROL: leaves the application its own chords — Ctrl+S, Ctrl+K, F1', () => {
    for (const chord of [press('s', { ctrlKey: true }), press('k', { ctrlKey: true }), press('F1'), press('A', { altKey: true })]) {
      expect(fieldOwnsChord(area, chord), JSON.stringify(chord)).toBe(false);
    }
  });

  it('CONTROL: keeps nothing where nothing is being typed — a tick box, a plain element, no target', () => {
    const undo = press('z', { ctrlKey: true });
    expect(fieldOwnsChord(tick, undo)).toBe(false);
    expect(fieldOwnsChord(plain, undo)).toBe(false);
    expect(fieldOwnsChord(null, undo)).toBe(false);
  });

  it('a READ-ONLY field types nothing, so it keeps nothing', () => {
    const shown = document.createElement('textarea');
    shown.readOnly = true;
    expect(fieldOwnsChord(shown, press('z', { ctrlKey: true }))).toBe(false);
  });
});
