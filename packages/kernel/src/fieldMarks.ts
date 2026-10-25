import type { FIELD_BORDER_STYLES, FIELD_CHECK_STYLES } from '@monstera/contract';

/**
 * A field's border by its style and a tick box's mark by its check style, drawn by Monstera
 * ([ADR-0230](../../../docs/DECISIONS/0230-a-fields-border-style-and-check-style-are-drawn-by-monstera.md)): neither engine
 * draws either (measured), so this is the one place their shapes are defined.
 *
 * Pure, and the drawing is DATA: a list of content-stream operators that the MuPDF-side step writes as text
 * ({@link opsText}) and the pdf-lib button provider turns into its own operators, so the two writers draw one shape (B3a).
 * Coordinates are the box's own, origin at its lower left.
 */

export type FieldBorderStyle = (typeof FIELD_BORDER_STYLES)[number];
export type FieldCheckStyle = (typeof FIELD_CHECK_STYLES)[number];

/** One operator and its numeric operands; `d` (a dash) carries its array beside them. */
export interface Op {
  readonly op: string;
  readonly args: readonly number[];
  readonly dash?: readonly number[];
}

/** A colour as the file states one: one gray, three RGB or four CMYK components. */
export type Components = readonly number[];

/** The operator that sets `colour` for stroking or filling, by how many components it has. */
function colourOp(colour: Components, stroke: boolean): Op {
  const name = colour.length === 1 ? 'g' : colour.length === 4 ? 'k' : 'rg';
  return { op: stroke ? name.toUpperCase() : name, args: colour };
}

const polygon = (points: readonly (readonly [number, number])[]): Op[] => [
  ...points.map(([x, y], at): Op => ({ op: at === 0 ? 'm' : 'l', args: [x, y] })),
  { op: 'h', args: [] },
];

/** The two shades a bevelled or inset border lays inside its edge, the lit side first: the look widely used PDF editors give it, by their grays. */
const BEVEL: Readonly<Record<'beveled' | 'inset', readonly [number, number]>> = {
  beveled: [1, 0.75],
  inset: [0.5, 0.75],
};

/**
 * The border a widget `width` by `height` draws, `borderWidth` thick in `colour`, by `style`; nothing where there is no
 * colour or no width, as both engines draw none.
 */
export function borderOps(style: FieldBorderStyle, width: number, height: number, borderWidth: number, colour: Components | null): Op[] {
  if (colour === null || colour.length === 0 || borderWidth <= 0) return [];
  const half = borderWidth / 2;
  const line: Op[] = [{ op: 'q', args: [] }, colourOp(colour, true), { op: 'w', args: [borderWidth] }];
  if (style === 'underline') return [...line, { op: 'm', args: [0, half] }, { op: 'l', args: [width, half] }, { op: 'S', args: [] }, { op: 'Q', args: [] }];
  const frame: Op[] = [
    ...line,
    ...(style === 'dashed' ? [{ op: 'd', args: [0], dash: [3] }] : []),
    { op: 're', args: [half, half, width - borderWidth, height - borderWidth] },
    { op: 'S', args: [] },
    { op: 'Q', args: [] },
  ];
  if (style !== 'beveled' && style !== 'inset') return frame;
  const [lit, shade] = BEVEL[style];
  const a = borderWidth;
  const b = 2 * borderWidth;
  return [
    ...frame,
    { op: 'q', args: [] },
    colourOp([lit], false),
    ...polygon([[a, a], [a, height - a], [width - a, height - a], [width - b, height - b], [b, height - b], [b, b]]),
    { op: 'f', args: [] },
    colourOp([shade], false),
    ...polygon([[width - a, height - a], [width - a, a], [a, a], [b, b], [width - b, b], [width - b, height - b]]),
    { op: 'f', args: [] },
    { op: 'Q', args: [] },
  ];
}

/** A circle as four Bézier quarters, centred at (cx, cy). */
function circle(cx: number, cy: number, r: number): Op[] {
  const k = 0.5523 * r;
  return [
    { op: 'm', args: [cx + r, cy] },
    { op: 'c', args: [cx + r, cy + k, cx + k, cy + r, cx, cy + r] },
    { op: 'c', args: [cx - k, cy + r, cx - r, cy + k, cx - r, cy] },
    { op: 'c', args: [cx - r, cy - k, cx - k, cy - r, cx, cy - r] },
    { op: 'c', args: [cx + k, cy - r, cx + r, cy - k, cx + r, cy] },
    { op: 'h', args: [] },
  ];
}

/** The mark a tick box or a radio shows when on, `style`, in `colour`, centred in a box `width` by `height`. */
export function checkOps(style: FieldCheckStyle, width: number, height: number, colour: Components): Op[] {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.3;
  const at = (x: number, y: number): readonly [number, number] => [cx + x * r, cy + y * r];
  const thick = Math.max(0.5, Math.min(width, height) * 0.1);
  const fill = (ops: Op[]): Op[] => [{ op: 'q', args: [] }, colourOp(colour, false), ...ops, { op: 'f', args: [] }, { op: 'Q', args: [] }];
  const strokeOf = (ops: Op[]): Op[] => [
    { op: 'q', args: [] },
    colourOp(colour, true),
    { op: 'w', args: [thick] },
    { op: 'J', args: [1] },
    { op: 'j', args: [1] },
    ...ops,
    { op: 'S', args: [] },
    { op: 'Q', args: [] },
  ];
  switch (style) {
    case 'check':
      return strokeOf([{ op: 'm', args: [...at(-0.85, 0)] }, { op: 'l', args: [...at(-0.3, -0.6)] }, { op: 'l', args: [...at(0.85, 0.7)] }]);
    case 'circle':
      return fill(circle(cx, cy, r * 0.85));
    case 'cross':
      return strokeOf([
        { op: 'm', args: [...at(-0.75, -0.75)] },
        { op: 'l', args: [...at(0.75, 0.75)] },
        { op: 'm', args: [...at(-0.75, 0.75)] },
        { op: 'l', args: [...at(0.75, -0.75)] },
      ]);
    case 'diamond':
      return fill(polygon([at(0, 1), at(1, 0), at(0, -1), at(-1, 0)]));
    case 'square':
      return fill(polygon([at(-0.75, -0.75), at(-0.75, 0.75), at(0.75, 0.75), at(0.75, -0.75)]));
    case 'star': {
      const points: (readonly [number, number])[] = [];
      for (let point = 0; point < 10; point += 1) {
        const angle = Math.PI / 2 + (point * Math.PI) / 5;
        const radius = point % 2 === 0 ? 1 : 0.4;
        points.push(at(Math.cos(angle) * radius, Math.sin(angle) * radius));
      }
      return fill(polygon(points));
    }
    default: {
      const unhandled: never = style;
      return unhandled;
    }
  }
}

const fixed = (value: number): string => {
  const text = value.toFixed(3).replace(/\.?0+$/u, '');
  return text === '-0' || text === '' ? '0' : text;
};

/** The operators as content-stream text, one to a line. */
export function opsText(ops: readonly Op[]): string {
  return ops
    .map((each) => (each.dash === undefined ? [...each.args.map(fixed), each.op] : [`[${each.dash.map(fixed).join(' ')}]`, ...each.args.map(fixed), each.op]).join(' '))
    .join('\n');
}
