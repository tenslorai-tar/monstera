import { PAGE_TEXT_SCALE } from './textStructure.js';

/**
 * A test's hand-written page text, in POINTS, as MuPDF's serialiser writes it at {@link PAGE_TEXT_SCALE}
 * ([ADR-0280](../../../docs/DECISIONS/0280-the-text-layer-places-each-letter-where-the-engine-reads-it.md), its fifth
 * correction): each field `as_json` multiplies, multiplied and cut toward zero as `(int)` cuts it, and every other value
 * as written. So a case states its geometry in the units it means and hands the parser what the engine would send.
 *
 * {@link scaledField} is the ONE statement for tests of which fields those are, and `pageTextScale.test.ts` holds it to
 * MuPDF's own output: every number it leaves alone is unchanged between scale 1 and the product's, and every number it
 * scales moves by less than the old whole-point cut.
 */
export function engineJson(payload: unknown): string {
  return JSON.stringify(scaledCopy(payload, null, null));
}

/**
 * Whether a number in the JSON is one MuPDF's `as_json` multiplies by its scale (1.28.0, `source/fitz/stext-output.c`):
 * a `bbox`'s x, y, w and h (1139-1142, 1151-1154, 1196-1199), a line's origin, the `x` and `y` of the object carrying
 * `wmode` (1174, 1175), and its font's `size` (1173). A grid's `w` and `h` are counts (1254, 1255) and its `xpos` and
 * `ypos` are written unscaled (1235, 1247).
 *
 * @param holderKey the key the object holding the number sits under
 * @param holder that object
 * @param key the number's own key
 */
export function scaledField(holderKey: string | null, holder: Readonly<Record<string, unknown>>, key: string): boolean {
  if (holderKey === 'bbox') return ['x', 'y', 'w', 'h'].includes(key);
  if (holderKey === 'font') return key === 'size';
  return ('wmode' in holder || isLine(holderKey)) && (key === 'x' || key === 'y');
}

/**
 * A hand-written line may leave out `wmode`, which MuPDF always writes; it is still a line when it sits in `lines`.
 * Real output carries `wmode` on every line, so the two tests agree on everything MuPDF produces.
 */
function isLine(holderKey: string | null): boolean {
  return holderKey === 'lines';
}

function scaledCopy(value: unknown, ownKey: string | null, holder: { node: Readonly<Record<string, unknown>>; key: string | null } | null): unknown {
  if (typeof value === 'number') {
    return holder !== null && ownKey !== null && scaledField(holder.key, holder.node, ownKey) ? Math.trunc(value * PAGE_TEXT_SCALE) : value;
  }
  if (Array.isArray(value)) return value.map((entry: unknown) => scaledCopy(entry, ownKey, holder));
  if (typeof value === 'object' && value !== null) {
    const node = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(Object.entries(node).map(([key, entry]) => [key, scaledCopy(entry, key, { node, key: ownKey })]));
  }
  return value;
}
