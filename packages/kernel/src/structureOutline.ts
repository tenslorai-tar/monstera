import type { PageStructure, StructureNode } from './textStructure.js';

/**
 * One page's tagging, bounded to cross a channel.
 *
 * ## Why this is separate from the substrate
 *
 * `textStructure.ts` owns MuPDF's format and answers with whatever the page holds.
 * What crosses to the renderer has to be small enough to cross, and the bounding is
 * the whole of the difference — `textLayer.ts`' split, for its reason.
 */
export interface StructureOutline {
  /** The elements in tree order, at most the caller's limit. */
  readonly nodes: readonly StructureNode[];
  /**
   * Whether anything was left out — **either bound**, the element count or a name's
   * length. One flag for `TextLayer.truncated`'s reason: a caller's question is *is
   * this the whole page*, and an outline quietly short of its last elements reads as
   * a page tagged that far.
   */
  readonly truncated: boolean;
  /** Lines inside no tagged element, for the WHOLE page rather than the kept slice. */
  readonly untaggedLines: number;
  /** Image blocks, for the whole page. */
  readonly images: number;
}

/**
 * Bounds a parsed page's structure.
 *
 * ## Both bounds are the caller's, and neither is optional
 *
 * An element count and a role's name are both chosen by whoever made the document —
 * the raw name is the document's own string — so an unbounded answer is a payload a
 * hostile file sets. `textLayerOf` takes its bounds the same way, for the same reason.
 *
 * @param structure the parsed page, in tree order
 * @param limit the most elements to return
 * @param maxNameLength the most characters of a role or raw name to return
 */
export function structureOutlineOf(
  structure: PageStructure,
  limit: number,
  maxNameLength: number,
): StructureOutline {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError(
      `An outline's element limit must be a positive integer; got ${String(limit)}. A limit of ` +
        'zero would answer with no elements, which is what an untagged page looks like.',
    );
  }
  if (!Number.isInteger(maxNameLength) || maxNameLength <= 0) {
    throw new RangeError(
      `An outline's name length cap must be a positive integer; got ${String(maxNameLength)}.`,
    );
  }

  const kept = structure.nodes.slice(0, limit);
  // DERIVED FROM THE NODES, not accumulated while mapping them, for `textLayerOf`'s
  // reason: a flag mutated in a callback narrows to `false` at the return.
  const clipped = kept.some(
    (node) => node.role.length > maxNameLength || node.raw.length > maxNameLength,
  );
  const clip = (name: string): string =>
    name.length > maxNameLength ? name.slice(0, maxNameLength) : name;

  return {
    nodes: kept.map((node) => ({ ...node, role: clip(node.role), raw: clip(node.raw) })),
    truncated: clipped || structure.nodes.length > limit,
    untaggedLines: structure.untaggedLines,
    images: structure.images,
  };
}
