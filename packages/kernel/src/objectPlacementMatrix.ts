/**
 * THE ONE PLACEMENT MATRIX an object command means, in PAGE space and the row-vector order a PDF matrix composes in:
 * scaled about the box's lower-left corner, then turned about the centre of the box that scale left, then moved. Both
 * engines apply it (PDFium's `FPDFPageObj_Transform` and the MuPDF writer's `q M cm … Q`), so a command means one
 * placement whichever writer holds the object (B3a).
 *
 * The turn is in degrees, counter-clockwise as PDF measures them, and absent is none: the commands carried no turn
 * before the owner's E6 asked for a rotate handle, and a placement written then means what it meant.
 */
export type PageMatrix = readonly [number, number, number, number, number, number];

export interface PlacementIntent {
  readonly box: { readonly left: number; readonly bottom: number; readonly right: number; readonly top: number };
  readonly moveBy: { readonly x: number; readonly y: number };
  readonly scaleBy: { readonly x: number; readonly y: number };
  readonly rotateBy?: number | undefined;
}

/** `first` followed by `second`. */
function then(first: PageMatrix, second: PageMatrix): PageMatrix {
  const [a, b, c, d, e, f] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [a * a2 + b * c2, a * b2 + b * d2, c * a2 + d * c2, c * b2 + d * d2, e * a2 + f * c2 + e2, e * b2 + f * d2 + f2];
}

export function placementMatrix(intent: PlacementIntent): PageMatrix {
  const { x: sx, y: sy } = intent.scaleBy;
  const { left, bottom, right, top } = intent.box;
  const scaling: PageMatrix = [sx, 0, 0, sy, left * (1 - sx), bottom * (1 - sy)];
  const degrees = intent.rotateBy ?? 0;
  const moving: PageMatrix = [1, 0, 0, 1, intent.moveBy.x, intent.moveBy.y];
  if (degrees === 0) return then(scaling, moving);
  // THE CENTRE OF THE SCALED BOX: its lower-left corner stays, so its far corner moved by the scale.
  const cx = left + ((right - left) * sx) / 2;
  const cy = bottom + ((top - bottom) * sy) / 2;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const turning: PageMatrix = [cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos];
  return then(then(scaling, turning), moving);
}
