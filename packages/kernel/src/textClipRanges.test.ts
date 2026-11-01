import { describe, expect, it } from 'vitest';

import { TEXT_CLIP_RANGES_MAX, clipOfTextObject, clipRangesOf } from './textClipRanges.js';
import { clipIdentitiesAt, textObjectClips } from './textOperators.js';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const noXObjects = (): undefined => undefined;

describe('textObjectClips (ADR-0281): which clip each text object is drawn through, by the content’s own parse', () => {
  it('two lines each clipped to a rectangle around itself are two clips, though neither clip narrows its line', () => {
    const content = encode('q 0 696 612 64 re W n BT /F1 11 Tf 72 700 Td (First) Tj ET Q\nq 0 600 612 96 re W n BT /F1 11 Tf 72 686 Td (Second) Tj ET Q');
    const [first, second] = textObjectClips(content, noXObjects);
    expect(first).toMatch(/^[0-9a-f]{16}$/u);
    expect(second).toMatch(/^[0-9a-f]{16}$/u);
    expect(first).not.toBe(second);
  });

  it('CONTROL: two text objects under ONE clip share its identity, and text under none has none', () => {
    const shared = encode('q 0 600 612 160 re W n BT /F1 11 Tf 72 700 Td (First) Tj ET BT /F1 11 Tf 72 686 Td (Second) Tj ET Q');
    const [a, b] = textObjectClips(shared, noXObjects);
    expect(a).toBe(b);
    expect(textObjectClips(encode('BT /F1 11 Tf 72 700 Td (Plain) Tj ET'), noXObjects)).toStrictEqual([null]);
  });

  it('the same rectangle set twice is the same clip, as the writer judges it', () => {
    const twice = encode('q 0 600 612 160 re W n BT /F1 11 Tf 72 700 Td (A) Tj ET Q\nq 0 600 612 160 re W n BT /F1 11 Tf 72 686 Td (B) Tj ET Q');
    const [a, b] = textObjectClips(twice, noXObjects);
    expect(a).toBe(b);
  });

  it('the rule differs by the even-odd rule alone: W and W* over one path are two clips', () => {
    const [nonzero] = clipIdentitiesAt(encode('q 0 0 10 10 re W n BT ET Q'), noXObjects, [20]);
    const [evenOdd] = clipIdentitiesAt(encode('q 0 0 10 10 re W* n BT ET Q'), noXObjects, [21]);
    expect(nonzero).toBeDefined();
    expect(evenOdd).toBeDefined();
    expect(nonzero).not.toBe(evenOdd);
  });
});

describe('clipRangesOf and clipOfTextObject', () => {
  it('answers consecutive objects in one clip as one range, and an object in none in no range', () => {
    const answer = clipRangesOf(['aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', null, 'bbbbbbbbbbbbbbbb']);
    expect(answer).toStrictEqual({
      objects: 4,
      clips: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'],
      ranges: [
        { first: 0, last: 1, clip: 0 },
        { first: 3, last: 3, clip: 1 },
      ],
      truncated: false,
    });
    expect([0, 1, 2, 3].map((k) => clipOfTextObject(answer, 4, k))).toStrictEqual(['aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', undefined, 'bbbbbbbbbbbbbbbb']);
  });

  it('gives no object a clip where the reader counts its text objects otherwise: those numberings do not join', () => {
    const answer = clipRangesOf(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']);
    expect(clipOfTextObject(answer, 3, 0)).toBeUndefined();
    // CONTROL: the same answer read by a reader that counts two gives each its clip.
    expect(clipOfTextObject(answer, 2, 0)).toBe('aaaaaaaaaaaaaaaa');
  });

  it('a page past the bound answers truncated and gives no object a clip, so it is grouped as before', () => {
    const alternating = Array.from({ length: TEXT_CLIP_RANGES_MAX + 2 }, (_, k) => (k % 2 === 0 ? 'aaaaaaaaaaaaaaaa' : 'bbbbbbbbbbbbbbbb'));
    const answer = clipRangesOf(alternating);
    expect(answer.truncated).toBe(true);
    expect(clipOfTextObject(answer, alternating.length, 0)).toBeUndefined();
  });
});
