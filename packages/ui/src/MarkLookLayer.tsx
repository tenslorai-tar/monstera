import type { ReactElement } from 'react';

import { hexFromColour } from './annotations/annotationStyle.js';
import { CORNER_REACH } from './annotations/selectTool.js';
import { type LookBox, type LookPart, type LookStroke, type MarkLook, RUBBER_STAMP } from './markLook.js';
import { RedactMark } from './registries/annotationTypes.js';

/**
 * The marks held in their final look on one page, until the page draws them
 * ([ADR-0257](../../../docs/DECISIONS/0257-a-released-mark-is-held-in-its-final-look-until-the-page-draws-it.md)).
 *
 * Laid over the page as the overlay is, in the overlay's own pixels, and taking no pointer: a held look is what the page
 * is about to show, never something to press. The lines, outlines, fills and signs are one SVG; the words, a pending
 * redaction and a picture are HTML in their boxes, the redaction being the page layer's own `RedactMark`, so a held one
 * and a drawn one are one component.
 */

const points = (list: readonly (readonly [number, number])[]): string => list.map(([x, y]) => `${String(x)},${String(y)}`).join(' ');

function strokeOf(stroke: LookStroke): { stroke: string; strokeWidth: number; strokeOpacity: number } {
  return { stroke: hexFromColour(stroke.colour), strokeWidth: stroke.width, strokeOpacity: stroke.opacity };
}

/** A closed arrowhead at the end of `list`, pointing along its last segment, sized from the stroke. */
function arrowHead(list: readonly (readonly [number, number])[], width: number): string | undefined {
  const tip = list[list.length - 1];
  const before = list[list.length - 2];
  if (tip === undefined || before === undefined) return undefined;
  const length = Math.hypot(tip[0] - before[0], tip[1] - before[1]);
  if (length === 0) return undefined;
  const ux = (tip[0] - before[0]) / length;
  const uy = (tip[1] - before[1]) / length;
  // SIZED AS MUPDF SIZES `/ClosedArrow`: about six widths long and as wide, with a floor so a hairline's head shows.
  const reach = Math.max(6 * width, 6);
  const back: readonly [number, number] = [tip[0] - ux * reach, tip[1] - uy * reach];
  const spread = reach / 2;
  return points([tip, [back[0] - uy * spread, back[1] + ux * spread], [back[0] + uy * spread, back[1] - ux * spread]]);
}

/** A cloud's border: arcs bulging out of each edge, as `/BE /S /C` draws them. */
function cloudPath(list: readonly (readonly [number, number])[], width: number): string {
  const radius = Math.max(4 * width, 5);
  let d = '';
  for (const [at, from] of list.entries()) {
    const to = list[(at + 1) % list.length] ?? from;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const bumps = Math.max(1, Math.round(length / (radius * 2)));
    for (let bump = 0; bump < bumps; bump += 1) {
      const a: readonly [number, number] = [from[0] + ((to[0] - from[0]) * bump) / bumps, from[1] + ((to[1] - from[1]) * bump) / bumps];
      const b: readonly [number, number] = [from[0] + ((to[0] - from[0]) * (bump + 1)) / bumps, from[1] + ((to[1] - from[1]) * (bump + 1)) / bumps];
      const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
      d += `${d === '' ? 'M' : 'L'}${String(a[0])},${String(a[1])} A${String(r)},${String(r)} 0 0 1 ${String(b[0])},${String(b[1])} `;
    }
  }
  return `${d}Z`;
}

function boxStyle(box: LookBox): { left: number; top: number; width: number; height: number } {
  return { left: box.x, top: box.y, width: box.width, height: box.height };
}

/** One vector part, or `null` for a part the HTML half draws. */
function VectorPart({ part }: { readonly part: LookPart }): ReactElement | null {
  switch (part.part) {
    case 'outline':
      return part.shape === 'rect' ? (
        <rect className="m-mark-look__line" {...strokeOf(part.stroke)} height={part.box.height} width={part.box.width} x={part.box.x} y={part.box.y} />
      ) : (
        <ellipse
          className="m-mark-look__line"
          {...strokeOf(part.stroke)}
          cx={part.box.x + part.box.width / 2}
          cy={part.box.y + part.box.height / 2}
          rx={part.box.width / 2}
          ry={part.box.height / 2}
        />
      );
    case 'poly': {
      const head = part.arrow === true ? arrowHead(part.points, part.stroke.width) : undefined;
      return (
        <>
          {part.cloudy === true ? (
            <path className="m-mark-look__line" {...strokeOf(part.stroke)} d={cloudPath(part.points, part.stroke.width)} />
          ) : part.closed ? (
            <polygon className="m-mark-look__line" {...strokeOf(part.stroke)} points={points(part.points)} />
          ) : (
            <polyline className="m-mark-look__line" {...strokeOf(part.stroke)} points={points(part.points)} />
          )}
          {head === undefined ? null : (
            <polygon className="m-mark-look__head" fill={hexFromColour(part.stroke.colour)} fillOpacity={part.stroke.opacity} points={head} />
          )}
        </>
      );
    }
    case 'fill':
      return (
        <>
          {part.boxes.map((box, at) => (
            <rect
              className="m-mark-look__fill"
              fill={hexFromColour(part.paint.colour)}
              fillOpacity={part.paint.opacity}
              height={box.height}
              key={at}
              width={box.width}
              x={box.x}
              y={box.y}
            />
          ))}
        </>
      );
    case 'swash':
      return (
        <>
          {part.paths.map((d, at) => (
            <path className="m-mark-look__fill" d={d} fill={hexFromColour(part.paint.colour)} fillOpacity={part.paint.opacity} key={at} />
          ))}
        </>
      );
    case 'rule':
      return (
        <>
          {part.lines.map((line, at) => (
            <line
              className="m-mark-look__line"
              {...strokeOf({ ...part.paint, width: line.width })}
              key={at}
              x1={line.x1}
              x2={line.x2}
              y1={line.y}
              y2={line.y}
            />
          ))}
        </>
      );
    case 'caption':
      return (
        <text
          className="m-mark-look__caption"
          fill={hexFromColour(part.paint.colour)}
          fillOpacity={part.paint.opacity}
          fontSize={part.caption.placed?.size}
          transform={part.caption.placed === undefined ? undefined : `rotate(${String(part.caption.placed.angle)} ${String(part.caption.x)} ${String(part.caption.y)})`}
          x={part.caption.x}
          y={part.caption.y}
        >
          {part.caption.text}
        </text>
      );
    case 'sign': {
      const { x, y, width, height } = part.box;
      const fill = hexFromColour(part.paint.colour);
      // A NOTE IS A SPEECH BUBBLE IN ITS COLOUR, OUTLINED; A CARET IS AN UPWARD WEDGE AT ITS POINT.
      return part.sign === 'note' ? (
        <path
          className="m-mark-look__sign"
          d={`M${String(x)},${String(y)} h${String(width)} v${String(height * 0.75)} h${String(-width * 0.55)} l${String(-width * 0.25)},${String(height * 0.25)} v${String(-height * 0.25)} h${String(-width * 0.2)} Z`}
          fill={fill}
          fillOpacity={part.paint.opacity}
        />
      ) : (
        <path
          className="m-mark-look__sign"
          d={`M${String(x)},${String(y + height)} L${String(x + width / 2)},${String(y)} L${String(x + width)},${String(y + height)} Z`}
          fill={fill}
          fillOpacity={part.paint.opacity}
        />
      );
    }
    case 'stamp': {
      // MUPDF'S RUBBER STAMP IN ITS OWN UNITS (`rubberStamp`): a 190 by 50 box whose y runs up, turned 0.6 degrees about
      // its bottom-left corner, a 2-wide border at (2, 2, 186, 44), and the word centred on its baseline. Drawn here with
      // y running down, so a PDF y is 50 less it, and the turn is the other way.
      const { width, height } = RUBBER_STAMP;
      const colour = hexFromColour(part.paint.colour);
      return (
        <svg height={part.box.height} viewBox={`0 0 ${String(width)} ${String(height)}`} width={part.box.width} x={part.box.x} y={part.box.y}>
          <g transform={`rotate(-0.6 0 ${String(height)})`}>
            <rect className="m-mark-look__stamp" height={44} stroke={colour} strokeOpacity={part.paint.opacity} strokeWidth={2} width={186} x={2} y={height - 46} />
            <text
              className="m-mark-look__stamp-word"
              fill={colour}
              fillOpacity={part.paint.opacity}
              fontSize={part.size}
              textAnchor="middle"
              x={width / 2}
              y={height - part.baseline}
            >
              {part.word}
            </text>
          </g>
        </svg>
      );
    }
    case 'strokes':
      return (
        // THE VIEWBOX IS THE BOX IN POINTS, the same shape as the box on screen, so it maps without fitting again.
        <svg height={part.box.height} preserveAspectRatio="none" viewBox={part.viewBox} width={part.box.width} x={part.box.x} y={part.box.y}>
          {part.pen === 'fill' ? (
            // A TYPED NAME'S OUTLINE, filled by the nonzero rule, as the writers fill it (`f`).
            <path d={part.d} fill={hexFromColour(part.paint.colour)} fillOpacity={part.paint.opacity} />
          ) : (
            // DRAWN INK with the writers' round caps and joins (`1 J`, `1 j`) and their pen.
            <path
              className="m-mark-look__line"
              d={part.d}
              stroke={hexFromColour(part.paint.colour)}
              strokeLinecap="round"
              strokeOpacity={part.paint.opacity}
              strokeWidth={part.pen}
            />
          )}
        </svg>
      );
    case 'selection':
      return (
        <g data-reshaped-selection={String(part.mark.of)}>
          <rect className="m-selection-box" height={part.mark.box.height} width={part.mark.box.width} x={part.mark.box.x} y={part.mark.box.y} />
          {part.mark.handles.map(([x, y], at) => (
            <rect
              className="m-selection-handle"
              data-reshaped-handle={`point-${String(at)}`}
              height={CORNER_REACH}
              key={`point-${String(at)}`}
              width={CORNER_REACH}
              x={x - CORNER_REACH / 2}
              y={y - CORNER_REACH / 2}
            />
          ))}
        </g>
      );
    case 'words':
    case 'redact':
    case 'picture':
    case 'link':
      return null;
    default: {
      const unhandled: never = part;
      return unhandled;
    }
  }
}

/** One HTML part, or `null` for a part the SVG half draws. */
function BoxPart({ part }: { readonly part: LookPart }): ReactElement | null {
  switch (part.part) {
    case 'words':
      return (
        <div
          className={`m-mark-look__words m-mark-look__words--${part.font}${part.border === undefined ? '' : ' m-mark-look__words--bordered'}`}
          data-mark-look="words"
          dir={part.direction === 'right-to-left' ? 'rtl' : 'ltr'}
          style={{
            ...boxStyle(part.box),
            padding: part.inset,
            fontSize: part.size,
            ...(part.family === undefined ? {} : { fontFamily: `"${part.family}", var(--m-kind-face)` }),
            color: hexFromColour(part.paint.colour),
            opacity: part.paint.opacity,
            ...(part.border === undefined ? {} : { borderColor: hexFromColour(part.border.colour), borderWidth: part.border.width }),
          }}
        >
          {part.text}
        </div>
      );
    case 'redact':
      return (
        <>
          {part.boxes.map((box, at) => (
            <div className="m-mark-look__box" data-mark-look="redact" key={at} style={boxStyle(box)}>
              <RedactMark />
            </div>
          ))}
        </>
      );
    case 'picture':
      return <img alt="" className="m-mark-look__picture" data-mark-look="picture" src={part.src} style={boxStyle(part.box)} />;
    case 'link':
      return <div className="m-mark-look__link" data-mark-look="link" style={boxStyle(part.box)} />;
    case 'outline':
    case 'poly':
    case 'fill':
    case 'swash':
    case 'rule':
    case 'caption':
    case 'sign':
    case 'stamp':
    case 'strokes':
    case 'selection':
      return null;
    default: {
      const unhandled: never = part;
      return unhandled;
    }
  }
}

/** The parts drawn as HTML in their boxes; every other part is the SVG's. */
const IN_BOXES: ReadonlySet<LookPart['part']> = new Set(['words', 'redact', 'picture', 'link']);

export function MarkLookLayer({ looks }: { readonly looks: readonly MarkLook[] }): ReactElement | null {
  const parts = looks.flatMap((look) => look.parts);
  if (parts.length === 0) return null;
  return (
    <div aria-hidden className="m-mark-looks" data-mark-looks={String(looks.length)}>
      <svg className="m-mark-looks__vectors">
        {parts
          .filter((part) => !IN_BOXES.has(part.part))
          .map((part, at) => (
            // POSITION IS THE IDENTITY: a held look is one moment's list, replaced whole when it changes.
            <g data-mark-look={part.part} key={at}>
              <VectorPart part={part} />
            </g>
          ))}
      </svg>
      {parts
        .filter((part) => IN_BOXES.has(part.part))
        .map((part, at) => (
          <BoxPart key={at} part={part} />
        ))}
    </div>
  );
}
