import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { channels } from './channels.js';
import { MAX_TEXT_LAYER_LINE, TEXT_LAYER_ADVANCE_MAX, TEXT_LAYER_ADVANCE_MIN } from './textLayerBounds.js';

/**
 * `document.pageTextLayer`'s letters, bounded per page in the schema
 * ([ADR-0280](../../../docs/DECISIONS/0280-the-text-layer-places-each-letter-where-the-engine-reads-it.md), Decision 2):
 * at most `MAX_TEXT_LAYER_LINE` advances a line, each a signed 16-bit count of hundredths. Each case names the refusal
 * it expects, its code and the path to the field, so a refusal for some other reason does not pass as this one.
 */

const answer = channels['document.pageTextLayer'].result;

function page(advances: readonly number[], text = 'x'.repeat(advances.length)) {
  return {
    version: asDocVersion(1),
    lines: [
      {
        text,
        box: { x0: 72, y0: 80.41, x1: 439.49, y1: 95.08 },
        letters: { origin: { x: 72, y: 91.29 }, direction: { x: 1, y: 0 }, size: 11, advances },
      },
    ],
    truncated: false,
    kind: 'text' as const,
  };
}

/** The issues a refusal carried, as code and path, which is what each case asserts. */
function refusal(value: unknown): { code: string; path: string }[] {
  const parsed = answer.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.') }));
}

describe('document.pageTextLayer’s letters, bounded per page (ADR-0280)', () => {
  it('accepts a line of exactly the bound, MAX_TEXT_LAYER_LINE advances', () => {
    expect(refusal(page(Array.from({ length: MAX_TEXT_LAYER_LINE }, () => 500)))).toStrictEqual([]);
  });

  it('refuses a line ONE past the bound, at the advances themselves', () => {
    // THE TEXT STAYS WITHIN ITS OWN BOUND, so the one refusal is the advances': a text one past would refuse too, and
    // a case that accepted either refusal would pass with the advances' bound deleted.
    const advances = Array.from({ length: MAX_TEXT_LAYER_LINE + 1 }, () => 500);
    expect(refusal(page(advances, 'x'.repeat(MAX_TEXT_LAYER_LINE)))).toStrictEqual([{ code: 'too_big', path: 'lines.0.letters.advances' }]);
  });

  it('accepts an advance at each end of the signed 16-bit range, and refuses one past either', () => {
    expect(refusal(page([TEXT_LAYER_ADVANCE_MIN, TEXT_LAYER_ADVANCE_MAX]))).toStrictEqual([]);
    expect(refusal(page([TEXT_LAYER_ADVANCE_MAX + 1, 0]))).toStrictEqual([{ code: 'too_big', path: 'lines.0.letters.advances.0' }]);
    expect(refusal(page([0, TEXT_LAYER_ADVANCE_MIN - 1]))).toStrictEqual([{ code: 'too_small', path: 'lines.0.letters.advances.1' }]);
  });

  it('refuses a field the letters do not declare, so nothing crosses that nobody decided should', () => {
    const value = page([500]);
    const [line] = value.lines;
    if (line === undefined) throw new Error('one line');
    expect(refusal({ ...value, lines: [{ ...line, letters: { ...line.letters, quads: [] } }] })).toStrictEqual([
      { code: 'unrecognized_keys', path: 'lines.0.letters' },
    ]);
  });

  it('accepts a line with no letters, which is a line placed as before', () => {
    const value = page([500]);
    const [line] = value.lines;
    if (line === undefined) throw new Error('one line');
    const { letters: _letters, ...plain } = line;
    expect(refusal({ ...value, lines: [plain] })).toStrictEqual([]);
  });
});
