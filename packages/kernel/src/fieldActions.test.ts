import { describe, expect, it } from 'vitest';

import type { FieldFormat } from '@monstera/contract';

import {
  calculationScript,
  faceOfFont,
  formatScripts,
  parseCalculation,
  parseDefaultAppearance,
  parseFormat,
  withFontSize,
} from './fieldActions.js';

/**
 * The grammar of a format and a calculation, written and read by one module.
 *
 * Each case writes, reads the script back and asks for the same value, so a writer and a reader that drifted apart would
 * fail here and not in a person's document. The controls are the scripts the parser must NOT take: a custom script is
 * kept and never interpreted (invariant 24), and a parser that took anything with a familiar name would read a hostile
 * script as ours.
 */
describe('a format is written as the standard call and read back as the same format', () => {
  const formats: readonly FieldFormat[] = [
    { kind: 'number', decimals: 0, separators: 'none-dot', negative: 'minus', currencyBefore: true },
    { kind: 'number', decimals: 2, separators: 'comma-dot', negative: 'parens', currency: '£', currencyBefore: true },
    { kind: 'number', decimals: 3, separators: 'dot-comma', negative: 'red', currency: 'kr', currencyBefore: false },
    { kind: 'number', decimals: 2, separators: 'apostrophe-dot', negative: 'minus', currency: 'CHF "x"', currencyBefore: true },
    { kind: 'percent', decimals: 1, separators: 'none-comma' },
    { kind: 'date', pattern: 'dd/mm/yyyy' },
    { kind: 'date', pattern: 'mmmm d, yyyy' },
    { kind: 'time', pattern: 'HH:MM' },
    { kind: 'time', pattern: 'h:MM:ss tt' },
  ];
  for (const format of formats) {
    it(`${format.kind} ${JSON.stringify(format)}`, () => {
      const { format: shown, keystroke } = formatScripts(format);
      expect(parseFormat(shown)).toStrictEqual(format);
      expect(keystroke.startsWith('AF')).toBe(true);
    });
  }

  it('CONTROL: scripts that are not the grammar are not taken', () => {
    const refused = [
      'event.value = 1;',
      'AFNumber_Format(2, 0, 0, 0, "£", true); app.alert("x");',
      'AFNumber_Format(2, 9, 0, 0, "£", true);',
      'AFDate_FormatEx("dd/mm/yyyy"); this.exportAsText();',
      'AFDate_FormatEx("<script>");',
      'AFTime_Format(7);',
      '',
    ];
    for (const script of refused) expect(parseFormat(script), script).toBeUndefined();
  });
});

describe('a calculation is written as AFSimple_Calculate and read back', () => {
  it('round-trips each operation and a field name that carries a quote', () => {
    for (const operation of ['sum', 'product', 'average', 'min', 'max'] as const) {
      const calculation = { operation, fields: ['a', 'b.c', 'with "quote"'] } as const;
      expect(parseCalculation(calculationScript(calculation))).toStrictEqual({ operation, fields: [...calculation.fields] });
    }
  });

  it('CONTROL: another script, and an empty field name, are not taken', () => {
    expect(parseCalculation('event.value = a.value + b.value;')).toBeUndefined();
    expect(parseCalculation('AFSimple_Calculate("SUM", new Array ("a")); app.alert(1);')).toBeUndefined();
    expect(parseCalculation('AFSimple_Calculate("MEDIAN", new Array ("a"));')).toBeUndefined();
    expect(parseCalculation('AFSimple_Calculate("SUM", new Array (""));')).toBeUndefined();
  });
});

describe('a default appearance', () => {
  it('names its face and size, and a size of its own replaces only the size', () => {
    expect(parseDefaultAppearance('/Helv 12 Tf 0 g')).toStrictEqual({ resource: 'Helv', size: 12 });
    expect(parseDefaultAppearance('/Helv 0 Tf 0 g')).toStrictEqual({ resource: 'Helv', size: 0 });
    expect(parseDefaultAppearance('0 g')).toBeUndefined();
    expect(withFontSize('/Helv 12 Tf 0 0 1 rg', 9)).toBe('/Helv 9 Tf 0 0 1 rg');
    expect(parseDefaultAppearance(withFontSize(undefined, 14))?.size).toBe(14);
  });

  it('reads the standard three faces by font name, and anything else as Helvetica', () => {
    expect(faceOfFont('Times-Roman', undefined)).toBe('times');
    expect(faceOfFont('Courier-Bold', undefined)).toBe('courier');
    expect(faceOfFont('Helvetica', undefined)).toBe('helvetica');
    expect(faceOfFont(undefined, 'TiRo')).toBe('times');
    expect(faceOfFont(undefined, 'Cour')).toBe('courier');
    expect(faceOfFont(undefined, 'F7')).toBe('helvetica');
  });
});
