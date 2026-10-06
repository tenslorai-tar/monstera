import { describe, expect, it } from 'vitest';

import { joinedContent, operatorOf, showOperators, textObjectCount } from './textOperators.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const latin1 = (codes: Uint8Array): string => new TextDecoder('latin1').decode(codes);

/**
 * The numbering ADR-0176 measured, and the reading under it. The PDFium side of the measurement is
 * `scripts/research/type3Correspondence.mjs`, which reads through this module; these cases pin the shapes it measured
 * without PDFium, so a change to the rule is red here before it is red anywhere slower.
 */
describe('showOperators', () => {
  it('numbers only the operators that show a code: an empty string and a TJ of spacing alone make no object', () => {
    const operators = showOperators(
      bytes(
        [
          'BT /F1 12 Tf 20 360 Td (first) Tj ET',
          'BT /F1 12 Tf 20 340 Td () Tj ET',
          "BT /F1 12 Tf 14 TL 20 320 Td (quote) ' ET",
          'BT /F1 12 Tf 20 300 Td 1 0 (dquote) " ET',
          'BT /F1 12 Tf 20 280 Td [ -100 ] TJ ET',
          'BT /F1 12 Tf 7 Tr 20 260 Td (clip) Tj ET',
          '/Span <</MCID 0>> BDC BT /F1 12 Tf 20 240 Td (marked) Tj ET EMC',
          'q BT /F1 12 Tf 20 220 Td (saved) Tj ET Q',
          'BT /F9 12 Tf 20 210 Td (nofont) Tj ET',
          'BT /F1 12 Tf 20 200 Td (last) Tj ET',
        ].join('\n'),
      ),
    );
    expect(operators.map((operator) => [operator.object, latin1(operator.codes)])).toStrictEqual([
      [0, 'first'],
      [null, ''],
      [1, 'quote'],
      [2, 'dquote'],
      [null, ''],
      [3, 'clip'],
      [4, 'marked'],
      [5, 'saved'],
      [6, 'nofont'],
      [7, 'last'],
    ]);
    expect(textObjectCount(operators)).toBe(8);
    expect(operatorOf(operators, 4)?.state.font).toBe('F1');
    // CONTROL: the clip-only line is counted, as PDFium counts it — render mode is not part of the rule.
    expect(operatorOf(operators, 3)?.state.render).toBe(7);
  });

  it('reads every string form: escapes, octal, a line continuation, hexadecimal with an odd digit, and a TJ array', () => {
    const operators = showOperators(
      bytes('BT /F1 1 Tf (a\\)b[c]<d>\\101\\\nz) Tj <41 42 4> Tj [ (x) -250 <7A> 30 ] TJ ET'),
    );
    expect(operators.map((operator) => latin1(operator.codes))).toStrictEqual(['a)b[c]<d>Az', 'AB@', 'xz']);
    expect(operators[2]?.elements.map((element) => (typeof element === 'number' ? element : latin1(element)))).toStrictEqual([
      'x',
      -250,
      'z',
      30,
    ]);
  });

  it('follows the text matrices through Tm, Td, TD, T* and both quote operators', () => {
    const operators = showOperators(
      bytes("BT 2 0 0 2 10 20 Tm (a) Tj 5 -3 Td (b) Tj 0 -4 TD (c) Tj T* (d) Tj (e) ' 1 2 (f) \" ET"),
    );
    const at = (index: number) => operators[index]?.state.matrix.slice(4);
    expect(at(0)).toStrictEqual([10, 20]);
    // Td MOVES IN TEXT SPACE, so the 2x scale doubles it: (5, -3) lands at (20, 14).
    expect(at(1)).toStrictEqual([20, 14]);
    // TD SETS THE LEADING to its own -ty, so the next T* moves the same distance again.
    expect(at(2)).toStrictEqual([20, 6]);
    expect(operators[2]?.state.leading).toBe(4);
    expect(at(3)).toStrictEqual([20, -2]);
    expect(at(4)).toStrictEqual([20, -10]);
    expect(at(5)).toStrictEqual([20, -18]);
    expect([operators[5]?.state.wordSpacing, operators[5]?.state.charSpacing]).toStrictEqual([1, 2]);
  });

  it('says which operators advanced the matrix since it was last set, which a caller with widths adds', () => {
    const operators = showOperators(bytes('BT 1 0 0 1 0 0 Tm (a) Tj (b) Tj (c) Tj 0 -10 Td (d) Tj ET'));
    expect(operators.map((operator) => operator.positionedAt)).toStrictEqual([0, 0, 0, 3]);
  });

  it('follows cm into the CTM each operator shows under, and Q restores it', () => {
    const operators = showOperators(bytes('2 0 0 2 0 0 cm q 1 0 0 1 10 20 cm BT (in) Tj ET Q BT (out) Tj ET'));
    // `cm` PRE-MULTIPLIES: the translation is applied in the scaled space, so (10, 20) lands at (20, 40).
    expect(operators.map((operator) => operator.state.ctm)).toStrictEqual([
      [2, 0, 0, 2, 20, 40],
      [2, 0, 0, 2, 0, 0],
    ]);
  });

  it('keeps the text state a q saved, and restores it at Q', () => {
    const operators = showOperators(bytes('/F1 9 Tf 3 Tc q /F2 20 Tf 1 Tc BT (in) Tj ET Q BT (out) Tj ET'));
    expect(operators.map((operator) => [operator.state.font, operator.state.size, operator.state.charSpacing])).toStrictEqual([
      ['F2', 20, 1],
      ['F1', 9, 3],
    ]);
  });

  it('records the BT and the settings inside it before each operator, and none of the moves', () => {
    const content = 'q BT /F4 28 Tf 0 0 1 rg 1 0 0 -1 72 97 Tm <30> Tj 23 0 Td <52> Tj ET Q';
    const operators = showOperators(bytes(content));
    const second = operators[1];
    expect(second?.textObject).toBe(content.indexOf('BT'));
    expect(second?.settings.map((span) => content.slice(span.start, span.end))).toStrictEqual(['/F4 28 Tf', '0 0 1 rg']);
    expect(content.slice(second?.start ?? 0, second?.end ?? 0)).toBe('<52> Tj');
  });

  it('skips an inline image whole, so bytes inside it are never read as operators', () => {
    const operators = showOperators(bytes('BI /W 1 /H 1 /BPC 8 /CS /G ID (Tj) Tj EI BT (real) Tj ET'));
    expect(operators.map((operator) => latin1(operator.codes))).toStrictEqual(['real']);
  });

  it('joins a page’s streams with an end of line between, so a token never runs from one into the next', () => {
    const operators = showOperators(joinedContent([bytes('BT (a) Tj'), bytes('ET BT (b) Tj ET')]));
    expect(operators.map((operator) => latin1(operator.codes))).toStrictEqual(['a', 'b']);
    // CONTROL: the same two streams concatenated with nothing between run "Tj" into "ET".
    expect(() => showOperators(new Uint8Array([...bytes('BT (a) Tj'), ...bytes('ET BT (b) Tj ET')]))).not.toThrow();
    expect(showOperators(new Uint8Array([...bytes('BT (a) Tj'), ...bytes('ET BT (b) Tj ET')]))).toHaveLength(1);
  });

  it('refuses a string or an array that never closes rather than reading the rest of the page into it', () => {
    expect(() => showOperators(bytes('BT (open Tj ET'))).toThrow(/not closed/u);
    expect(() => showOperators(bytes('BT [ (a) TJ ET'))).toThrow(/not closed/u);
  });
});
