import type { AnnotationColour } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { overlayTransform } from './annotationSpace.js';
import { PLAIN_STYLE, colourFromHex, hexFromColour } from './annotationStyle.js';
import type { AnnotationStyle } from './annotationStyle.js';
import { STROKE, rectangleTool } from './shapeTools.js';
import { textMarkupTools } from './textMarkupTools.js';
import { viewportPoint } from '@monstera/shared';

/**
 * The style a new annotation is drawn in, and what the tools do with it.
 *
 * ## The cases that matter are the ones about `'auto'`
 *
 * A style that is a colour is uninteresting: every tool uses it. What the
 * tri-state buys is that a person who has chosen nothing gets a highlighter
 * that highlights and a caret that reads as a correction, and that is only
 * visible when two tools with DIFFERENT own colours are asked at once.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = { crop: [0, 0, 200, 300], rotation: 0, zoom: 1 };

/** A style that has chosen `colour`, with everything else moved off its default. */
function chosen(colour: AnnotationColour): AnnotationStyle {
  return { colour: () => colour, opacity: 0.4, lineWidth: 5, fontSize: 20 };
}

function drawn(tool: ReturnType<typeof rectangleTool>): Record<string, unknown> {
  const { controller } = tool;
  const started = controller.begin(viewportPoint(10, 10));
  const moved = controller.update(started, viewportPoint(110, 60));
  const command = controller.commit(moved, 0, overlayTransform(PAGE));
  if (command === undefined || command instanceof Promise) throw new Error('expected a command');
  if (command.kind !== 'addAnnotation') throw new Error('expected an addAnnotation');
  return command.annotation;
}

describe('hexFromColour and colourFromHex', () => {
  it('round-trip a colour a person could have picked', () => {
    // BOTH DIRECTIONS from one value, because the pair is what the panel and
    // the resolver use at opposite ends: the control shows a hex and the tool
    // sends components, and a conversion that was wrong in one direction only
    // would show the right swatch and draw the wrong mark.
    const back = colourFromHex(hexFromColour(STROKE));
    expect(back?.[0]).toBeCloseTo(STROKE[0], 2);
    expect(back?.[1]).toBeCloseTo(STROKE[1], 2);
    expect(back?.[2]).toBeCloseTo(STROKE[2], 2);
  });

  it('reads a hex a colour input produces', () => {
    expect(colourFromHex('#0080ff')).toStrictEqual([0, 0.502, 1]);
  });

  it('refuses a string that is not one, rather than guessing', () => {
    // `undefined` is what the resolver treats as *no choice*, so a malformed
    // stored value falls back to each tool's own colour rather than to black —
    // which would be a silent restyle of every mark.
    expect(colourFromHex('red')).toBeUndefined();
    expect(colourFromHex('#abc')).toBeUndefined();
    expect(colourFromHex('')).toBeUndefined();
  });
});

describe('a chosen style reaches the tools', () => {
  it('overrides the colour, the opacity and the width of a shape', () => {
    const annotation = drawn(rectangleTool(chosen([0, 0, 1])));
    expect(annotation['colour']).toStrictEqual([0, 0, 1]);
    expect(annotation['opacity']).toBe(0.4);
    expect(annotation['borderWidth']).toBe(5);
  });

  it('CONTROL: the plain style leaves the tool its own three', () => {
    // Without this the case above passes on a tool that ignores its argument
    // and happens to hard-code blue — and, more usefully, this is what says the
    // defaults did not move when the setting arrived.
    const annotation = drawn(rectangleTool(PLAIN_STYLE));
    expect(annotation['colour']).toStrictEqual(STROKE);
    expect(annotation['opacity']).toBe(1);
    expect(annotation['borderWidth']).toBe(2);
  });

  it('`auto` gives each tool its OWN colour, which is what makes it a tri-state', () => {
    // TWO TOOLS WITH DIFFERENT OWN COLOURS, asked at once. A resolver that
    // answered one colour for everything satisfies every case above, and this
    // is the one it cannot: a highlighter that paints in the shapes' red is
    // what a single global colour actually produces.
    const highlight = textMarkupTools(PLAIN_STYLE)[0];
    if (highlight === undefined) throw new Error('no highlight tool');
    const marked = drawn(highlight);
    expect(marked['colour']).not.toStrictEqual(drawn(rectangleTool(PLAIN_STYLE))['colour']);
  });

  it('and a CHOSEN colour reaches both of them, which is the other half', () => {
    const highlight = textMarkupTools(chosen([0, 0, 1]))[0];
    if (highlight === undefined) throw new Error('no highlight tool');
    expect(drawn(highlight)['colour']).toStrictEqual([0, 0, 1]);
    expect(drawn(rectangleTool(chosen([0, 0, 1])))['colour']).toStrictEqual([0, 0, 1]);
  });
});
