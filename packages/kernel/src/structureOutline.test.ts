import { describe, expect, it } from 'vitest';

import { structureOutlineOf } from './structureOutline.js';
import type { PageStructure } from './textStructure.js';

/** Three elements with DIFFERENT names and depths, so a case can say which survived. */
const PAGE: PageStructure = {
  nodes: [
    { role: 'Document', raw: 'Document', depth: 0, lines: 0 },
    { role: 'H1', raw: 'Heading1', depth: 1, lines: 1 },
    { role: 'P', raw: 'Body', depth: 1, lines: 3 },
  ],
  untaggedLines: 2,
  images: 1,
};

describe('structureOutlineOf', () => {
  it('keeps every element, in order, when the page fits', () => {
    const outline = structureOutlineOf(PAGE, 3, 64);
    expect(outline.nodes).toStrictEqual(PAGE.nodes);
    // EXACTLY AT THE LIMIT is not truncated: `>` against `>=` is the off-by-one
    // this case exists to separate.
    expect(outline.truncated).toBe(false);
  });

  it('cuts at the limit, says so, and keeps the FIRST elements', () => {
    const outline = structureOutlineOf(PAGE, 2, 64);
    expect(outline.nodes.map((node) => node.raw)).toStrictEqual(['Document', 'Heading1']);
    expect(outline.truncated).toBe(true);
  });

  it('clips a long name and says so, though no element was dropped', () => {
    const outline = structureOutlineOf(PAGE, 3, 4);
    expect(outline.nodes.map((node) => node.raw)).toStrictEqual(['Docu', 'Head', 'Body']);
    expect(outline.nodes.map((node) => node.role)).toStrictEqual(['Docu', 'H1', 'P']);
    expect(outline.truncated).toBe(true);
  });

  it('reports the WHOLE page’s untagged lines and images, not the kept slice’s', () => {
    const outline = structureOutlineOf(PAGE, 1, 64);
    expect(outline.untaggedLines).toBe(2);
    expect(outline.images).toBe(1);
  });

  it('refuses a limit that would answer like an untagged page', () => {
    expect(() => structureOutlineOf(PAGE, 0, 64)).toThrow(RangeError);
    expect(() => structureOutlineOf(PAGE, 3, 0)).toThrow(RangeError);
  });
});
