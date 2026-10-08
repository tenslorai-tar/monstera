import { useLingui } from '@lingui/react';
import { MAX_SIGNATURE_STROKE_POINTS, MAX_SIGNATURE_STROKES } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';

import { SIGN_DOCUMENT_PAD } from '../messages/en.js';

/** One stroke, as the contract carries it: pairs in the pad's own unit. */
export type PadStroke = readonly (readonly [number, number])[];

/**
 * The drawing's viewBox. Its WIDTH is the unit every point is divided by, which
 * is what lets the SVG draw the stored numbers back without knowing how large
 * the pad is on screen.
 */
const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 100;

/**
 * A surface a person draws a signature on with a mouse, a pen or a finger.
 *
 * ## The points are stored in the CONTRACT's unit, not in pixels
 *
 * Both coordinates divided by the pad's rendered width, origin top-left —
 * `signaturePointSchema`'s space. A pad that stored CSS pixels would hand the
 * kernel numbers that mean something different at every window size, and the
 * conversion would then live in whichever call site remembered it.
 *
 * ## SVG and not a canvas
 *
 * The strokes are the state and the drawing is derived from them on every
 * render, so there is no second copy of the signature in a bitmap to fall out of
 * step — and an SVG renders under jsdom, so the surface a person uses is the one
 * the cases drive.
 *
 * ## Bounded where the points are made
 *
 * A stroke stops growing at `MAX_SIGNATURE_STROKE_POINTS` and no new stroke
 * starts past `MAX_SIGNATURE_STROKES`, so the pad cannot compose an answer the
 * channel's schema would refuse. A tap is recorded as a stroke of the same
 * point twice, because a stroke of one point is not one the schema accepts and
 * a dot is a real mark.
 *
 * **Not keyboard-operable, and the dialog is**: drawing has no keyboard
 * equivalent, which is why *Type it* is the first look offered.
 */
export function SignaturePad({
  strokes,
  onStrokesChange,
}: {
  readonly strokes: readonly PadStroke[];
  readonly onStrokesChange: (strokes: readonly PadStroke[]) => void;
}): ReactElement {
  const { _ } = useLingui();
  // THE STROKE BEING DRAWN, held outside React state for the length of one
  // gesture: pointer moves arrive faster than renders, and a state update per
  // move would read the previous render's array and drop points.
  const drawing = useRef<[number, number][] | null>(null);
  // AND DRAWN AS IT GROWS (3a, F-S1): the live line is mounted for the gesture and its points written straight onto it
  // on each move, so what is on screen follows the pointer without a render per move. `livePoints` is the same
  // stroke in the SVG's own numbers, appended to rather than rebuilt.
  const [gesture, setGesture] = useState(false);
  const liveLine = useRef<SVGPolylineElement | null>(null);
  const livePoints = useRef('');

  /** A pointer position in the pad's unit, or `null` when the pad has no width. */
  const pointAt = (box: DOMRect, clientX: number, clientY: number): [number, number] | null => {
    if (box.width <= 0) return null;
    const across = (clientX - box.left) / box.width;
    const down = (clientY - box.top) / box.width;
    return [Math.min(1, Math.max(0, across)), Math.min(1, Math.max(0, down))];
  };

  const add = (point: [number, number]): void => {
    const stroke = drawing.current;
    if (stroke === null || stroke.length >= MAX_SIGNATURE_STROKE_POINTS) return;
    stroke.push(point);
    const shown = `${String(point[0] * VIEW_WIDTH)},${String(point[1] * VIEW_WIDTH)}`;
    livePoints.current = livePoints.current === '' ? shown : `${livePoints.current} ${shown}`;
    liveLine.current?.setAttribute('points', livePoints.current);
  };

  const finish = (): void => {
    const stroke = drawing.current;
    drawing.current = null;
    livePoints.current = '';
    setGesture(false);
    if (stroke === null || stroke.length === 0) return;
    const [first] = stroke;
    const kept: PadStroke = stroke.length === 1 && first !== undefined ? [first, first] : stroke;
    onStrokesChange([...strokes, kept]);
  };

  return (
    <svg
      aria-label={_(SIGN_DOCUMENT_PAD)}
      className="m-signature-pad"
      data-signature-pad=""
      onPointerDown={(event) => {
        if (strokes.length >= MAX_SIGNATURE_STROKES) return;
        const point = pointAt(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
        if (point === null) return;
        drawing.current = [];
        add(point);
        setGesture(true);
      }}
      onPointerLeave={finish}
      onPointerMove={(event) => {
        if (drawing.current === null) return;
        const box = event.currentTarget.getBoundingClientRect();
        // EVERY POSITION THE BROWSER SAW since the last event, where it reports them: a fast stroke is then the curve
        // the hand made rather than the corners between the moves that were dispatched.
        // A FEATURE, not assumed: Pointer Events level 3, which an engine without it answers with one event per move.
        const coalesced = 'getCoalescedEvents' in event.nativeEvent ? event.nativeEvent.getCoalescedEvents() : [];
        for (const one of coalesced.length > 0 ? coalesced : [event]) {
          const point = pointAt(box, one.clientX, one.clientY);
          if (point !== null) add(point);
        }
      }}
      onPointerUp={finish}
      // THE FIELD A "DRAW YOUR SIGNATURE FIRST" REFUSAL IS ABOUT (`Problem`): it takes the focus and the outline.
      data-problem-target=""
      role="img"
      tabIndex={-1}
      viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
    >
      {strokes.map((stroke, index) => (
        <polyline
          // STROKES ARE ONLY EVER APPENDED OR CLEARED TOGETHER, so a position
          // is a stable identity for one.
          key={index}
          points={stroke
            .map(([across, down]) => `${String(across * VIEW_WIDTH)},${String(down * VIEW_WIDTH)}`)
            .join(' ')}
        />
      ))}
      {gesture ? (
        <polyline
          data-signature-live=""
          // THE POINTS SO FAR, written when it mounts, which can be after the first moves; every later one is written
          // on by `add`.
          ref={(node) => {
            liveLine.current = node;
            node?.setAttribute('points', livePoints.current);
          }}
        />
      ) : null}
    </svg>
  );
}
