import { describe, expect, it } from 'vitest';

import {
  calculate,
  calculatedText,
  checkFieldValue,
  formatFieldValue,
  parseFieldDate,
  parseFieldNumber,
  parseFieldTime,
  storedNumber,
} from './fieldFormatting.js';

describe('parseFieldNumber', () => {
  it('reads a number in the style it looks like, and in the field’s own style where it has one', () => {
    expect(parseFieldNumber('1,234.5')).toBe(1234.5);
    expect(parseFieldNumber('1.234,5')).toBe(1234.5);
    expect(parseFieldNumber('12,5')).toBe(12.5);
    expect(parseFieldNumber('1,234')).toBe(1234);
    expect(parseFieldNumber('1.234', 'dot-comma')).toBe(1234);
    expect(parseFieldNumber('£ 12.00')).toBe(12);
    expect(parseFieldNumber('(7.5)')).toBe(-7.5);
    expect(parseFieldNumber('-3')).toBe(-3);
  });

  it('is nothing for a value that is not a number, and for an empty one', () => {
    expect(parseFieldNumber('twelve')).toBeUndefined();
    expect(parseFieldNumber('1.2.3', 'comma-dot')).toBeUndefined();
    expect(parseFieldNumber('')).toBeUndefined();
  });
});

describe('formatFieldValue', () => {
  it('shows a number with its decimals, its grouping, its currency and its negative style', () => {
    const money = { kind: 'number', decimals: 2, separators: 'comma-dot', negative: 'parens', currency: '£', currencyBefore: true } as const;
    expect(formatFieldValue('1234.5', money)).toBe('£1,234.50');
    expect(formatFieldValue('-1234.5', money)).toBe('(£1,234.50)');
    expect(formatFieldValue('-0.001', money)).toBe('£0.00');
    expect(formatFieldValue('1234.5', { kind: 'number', decimals: 1, separators: 'dot-comma', negative: 'minus' })).toBe('1.234,5');
    // CONTROL: the stored value as it is, which is what a field shows with no format applied.
    expect(formatFieldValue('1234.5', money)).not.toBe('1234.5');
  });

  it('shows a percent as the number times a hundred', () => {
    expect(formatFieldValue('0.125', { kind: 'percent', decimals: 1, separators: 'comma-dot' })).toBe('12.5%');
  });

  it('shows a date in its pattern, read in the pattern’s own order', () => {
    expect(formatFieldValue('3/4/2026', { kind: 'date', pattern: 'dd/mm/yyyy' })).toBe('03/04/2026');
    expect(formatFieldValue('3/4/2026', { kind: 'date', pattern: 'mm/dd/yyyy' })).toBe('03/04/2026');
    expect(formatFieldValue('2026-10-10', { kind: 'date', pattern: 'd mmmm yyyy' })).toBe('10 October 2026');
    expect(formatFieldValue('10 Oct 26', { kind: 'date', pattern: 'dd-mmm-yy' })).toBe('10-Oct-26');
  });

  it('shows a time in its pattern', () => {
    expect(formatFieldValue('14:05', { kind: 'time', pattern: 'h:MM tt' })).toBe('2:05 pm');
    expect(formatFieldValue('2:05 pm', { kind: 'time', pattern: 'HH:MM:ss' })).toBe('14:05:00');
  });

  it('shows a value its format cannot read as it is', () => {
    expect(formatFieldValue('soon', { kind: 'date', pattern: 'dd/mm/yyyy' })).toBe('soon');
  });
});

describe('storedNumber', () => {
  it('stores what was typed in the field’s style as the canonical number, and a percent as its fraction', () => {
    const european = { kind: 'number', decimals: 1, separators: 'dot-comma', negative: 'minus' } as const;
    expect(storedNumber('1.234,5', european)).toBe('1234.5');
    // THE ROUND TRIP: what is stored shows again as what was typed.
    expect(formatFieldValue(storedNumber('1.234,5', european), european)).toBe('1.234,5');
    expect(storedNumber('12.5%', { kind: 'percent', decimals: 1, separators: 'comma-dot' })).toBe('0.125');
    expect(storedNumber('soon', european)).toBe('soon');
  });
});

describe('checkFieldValue', () => {
  it('names what a format asks for when a value does not fit, and passes an empty value', () => {
    expect(checkFieldValue('31/02/2026', { kind: 'date', pattern: 'dd/mm/yyyy' })).toStrictEqual({ fits: false, wants: 'date' });
    expect(checkFieldValue('28/02/2026', { kind: 'date', pattern: 'dd/mm/yyyy' })).toStrictEqual({ fits: true });
    expect(checkFieldValue('abc', { kind: 'number', decimals: 0, separators: 'comma-dot', negative: 'minus' })).toStrictEqual({ fits: false, wants: 'number' });
    expect(checkFieldValue('25:00', { kind: 'time', pattern: 'HH:MM' })).toStrictEqual({ fits: false, wants: 'time' });
    expect(checkFieldValue('', { kind: 'time', pattern: 'HH:MM' })).toStrictEqual({ fits: true });
  });
});

describe('parse helpers', () => {
  it('reads a date and a time or answers nothing', () => {
    expect(parseFieldDate('29/02/2025', 'dd/mm/yyyy')).toBeUndefined();
    expect(parseFieldDate('29/02/2024', 'dd/mm/yyyy')).toStrictEqual({ year: 2024, month: 2, day: 29 });
    expect(parseFieldTime('12 am')).toStrictEqual({ hours: 0, minutes: 0, seconds: 0 });
    expect(parseFieldTime('13 pm')).toBeUndefined();
  });
});

describe('calculate', () => {
  it('works the five out as AF does, a value that is not a number counting as nothing', () => {
    expect(calculate('sum', [1, 2, undefined, 3])).toBe(6);
    expect(calculate('product', [2, 3])).toBe(6);
    expect(calculate('product', [2, undefined])).toBe(0);
    expect(calculate('average', [2, 4, undefined])).toBe(2);
    expect(calculate('min', [5, -1, 3])).toBe(-1);
    expect(calculate('max', [5, -1, 3])).toBe(5);
  });

  it('stores a number with no float noise and no trailing zeros', () => {
    expect(calculatedText(0.1 + 0.2)).toBe('0.3');
    expect(calculatedText(12)).toBe('12');
    expect(calculatedText(-0)).toBe('0');
  });
});
