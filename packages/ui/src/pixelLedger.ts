/**
 * The one count of the page pixels this window holds, against the one limit (ADR-0247, the owner's 13d).
 *
 * ## Every page canvas is sized here and given back here
 *
 * A canvas's backing store is its width times its height times four bytes, held from the moment it is sized until it is
 * sized to nothing (or collected, which is later and unknowable). So the ledger is not told about pixels after the fact:
 * it is the place that sizes a canvas to a drawing ({@link holdPixels}, which `renderPage`'s `present` calls) and the
 * place that gives a canvas's pixels back ({@link givePixelsBack}, which every surface's release calls). A count kept
 * beside the sizing would be a second opinion about what is held, and would agree until the first surface forgot it.
 *
 * ## What the limit decides
 *
 * The pages on screen are drawn whatever it says: they are in use, and a blank page is not a saving a person asked for.
 * What it decides is what is held beyond them, which is the one page ahead: {@link mayHoldAhead}.
 */

const held = new Map<HTMLCanvasElement, number>();
let total = 0;
let limit = Number.POSITIVE_INFINITY;
const listeners = new Set<() => void>();

/**
 * Tells `listener` whenever the count or the limit changes, so a decision taken against them is taken again. Subscribe
 * with the DECISION as the snapshot (`mayHoldAhead`), never the count: every canvas sized anywhere changes the count.
 */
export function subscribePixels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function changed(): void {
  for (const listener of listeners) listener();
}

/** Sizes `canvas` to `width` by `height`, which clears it, and counts its backing store. */
export function holdPixels(canvas: HTMLCanvasElement, width: number, height: number): void {
  canvas.width = width;
  canvas.height = height;
  const before = total;
  total -= held.get(canvas) ?? 0;
  const bytes = width * height * 4;
  if (bytes === 0) held.delete(canvas);
  else held.set(canvas, bytes);
  total += bytes;
  if (total !== before) changed();
}

/** Sizes `canvas` to nothing, which gives its backing store back now rather than at collection, and stops counting it. */
export function givePixelsBack(canvas: HTMLCanvasElement): void {
  holdPixels(canvas, 0, 0);
}

/** The bytes of page pixels held now, across every canvas the ledger sized. */
export function pixelsHeld(): number {
  return total;
}

/** Sets the limit, in bytes, from the *Memory for pages* setting (`pageMemoryLimit`). */
export function setPixelLimit(bytes: number): void {
  if (bytes === limit) return;
  limit = bytes;
  changed();
}

/**
 * Whether the page ahead of the screen, of `bytes` when drawn, may be held within the limit. `holding` says whether it
 * is held already, and then its bytes are in the count: asked about itself it must not be counted twice, or a page
 * ahead that fits would be drawn, counted, refused, released and drawn again for ever.
 */
export function mayHoldAhead(bytes: number, holding: boolean): boolean {
  return holding ? total <= limit : total + bytes <= limit;
}
