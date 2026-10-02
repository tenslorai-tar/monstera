import type { AnnotationRect } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { overlayTransform } from './annotationSpace.js';
import { SIGNATURE_DEFAULT_SIZE, SIGNATURE_TOOL_ID, signatureTool } from './signatureTool.js';

/**
 * The plain Signature's click (ADR-0133): one click sends the page and a default-sized box centred on it, converted by
 * the one adapter, and nothing for the bus. The fixture is this directory's: a non-zero crop origin and zoom 2, so a
 * tool passing pixels through fails rather than coincides.
 */
function clicked(
  at: readonly [number, number],
  rotation: 0 | 90 = 0,
): { readonly sent: readonly { page: number; rect: AnnotationRect }[]; readonly command: unknown } {
  const sent: { page: number; rect: AnnotationRect }[] = [];
  const { controller } = signatureTool({
    onPlacePlainSignature: (page, rect) => {
      sent.push({ page, rect });
    },
  });
  const started = controller.begin(viewportPoint(at[0], at[1]));
  const command = controller.commit(started, 3, overlayTransform({ crop: [50, 100, 250, 400], rotation, zoom: 2 }));
  return { sent, command };
}

/** A rectangle's size in PDF units, whichever way round its corners came. */
function sizeOf(rect: AnnotationRect): { readonly wide: number; readonly tall: number } {
  return { wide: Math.abs(rect.x1 - rect.x0), tall: Math.abs(rect.y1 - rect.y0) };
}

describe('the Signature tool', () => {
  it('sends the DEFAULT box centred on the click, in PDF units, and nothing for the bus', () => {
    // (200, 300) at zoom 2 on a page whose visible box starts at (50, 400) is (150, 250) in PDF units; the box is
    // 150 by 50 around it.
    const { sent, command } = clicked([200, 300]);
    expect(command).toBeUndefined();
    expect(sent).toHaveLength(1);
    const [only] = sent;
    expect(only?.page).toBe(3);
    const rect = only?.rect ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
    expect(sizeOf(rect)).toStrictEqual({ wide: SIGNATURE_DEFAULT_SIZE.wide, tall: SIGNATURE_DEFAULT_SIZE.tall });
    expect((rect.x0 + rect.x1) / 2).toBe(150);
    expect((rect.y0 + rect.y1) / 2).toBe(250);
  });

  it('MOVES the box onto the page at its edge rather than cutting it off', () => {
    // A click at the visible box's top-left corner: the default box would hang off two sides, so it is moved to lie
    // inside the page — its top-left at the page's — at its full size.
    const { sent } = clicked([0, 0]);
    const rect = sent[0]?.rect ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
    expect(sizeOf(rect)).toStrictEqual({ wide: SIGNATURE_DEFAULT_SIZE.wide, tall: SIGNATURE_DEFAULT_SIZE.tall });
    expect(Math.min(rect.x0, rect.x1)).toBe(50);
    expect(Math.max(rect.y0, rect.y1)).toBe(400);
  });

  it('ON A QUARTER-TURNED PAGE the box is wide AS SEEN, so its rectangle is the default turned', () => {
    // The page is shown turned, so the person sees the box 150 across; in PDF user space that box is 50 wide and 150
    // tall. A tool that built the rectangle in PDF space directly would place it the wrong way round on screen.
    const { sent } = clicked([300, 200], 90);
    expect(sizeOf(sent[0]?.rect ?? { x0: 0, y0: 0, x1: 0, y1: 0 })).toStrictEqual({
      wide: SIGNATURE_DEFAULT_SIZE.tall,
      tall: SIGNATURE_DEFAULT_SIZE.wide,
    });
  });

  it('is the tool its command names', () => {
    expect(signatureTool({ onPlacePlainSignature: () => undefined }).id).toBe(SIGNATURE_TOOL_ID);
  });
});
