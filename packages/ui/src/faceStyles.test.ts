import { describe, expect, it } from 'vitest';

import { nearestStyle, styleOf, togglesOf } from './faceStyles.js';

describe('the styles a family has', () => {
  it('names bold and italic together', () => {
    expect([styleOf(false, false), styleOf(true, false), styleOf(false, true), styleOf(true, true)]).toStrictEqual([
      'regular',
      'bold',
      'italic',
      'bold-italic',
    ]);
  });

  it('sets a missing style in the nearest the family has, keeping the slant before the weight', () => {
    expect(nearestStyle('bold', ['regular', 'bold'])).toBe('bold');
    expect(nearestStyle('bold-italic', ['regular', 'bold', 'italic'])).toBe('italic');
    expect(nearestStyle('bold', ['regular', 'italic'])).toBe('regular');
    expect(nearestStyle('italic', [])).toBeUndefined();
  });

  it('offers a toggle only where the family has a face for it', () => {
    expect(togglesOf(['regular', 'bold'])).toStrictEqual({ bold: true, italic: false });
    // CONTROL: a family with only a bold italic still offers both.
    expect(togglesOf(['bold-italic'])).toStrictEqual({ bold: true, italic: true });
  });
});
