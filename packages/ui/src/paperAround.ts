/** How the paper round a box is painted: one colour, or a shading from its top to its bottom. */
export type PaperPaint = { readonly backgroundColor: string } | { readonly backgroundImage: string };

/**
 * The page's own colour around a box, in the box's own pixels: the most common of four points just OUTSIDE its corners.
 * The one reading of the paper for every surface that lays paper over the page: Edit text's editor and a block it moved,
 * and the place an object Edit object moved left.
 *
 * Outside, because a block's box is the union of its glyphs' ink — measured 2026-09-23 in the running build, a point one
 * pixel inside the top-left corner landed on the first letter and set the editor's paper to the text's colour. Four,
 * because one point outside can land on a neighbouring rule or a line of another block; the page's paper is the answer
 * most of them agree on.
 *
 * @param paperAt the drawn page's colour at a point in the same pixels as `box`, or `undefined` where none is drawn
 */
export function paperAround(
  box: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  paperAt: (x: number, y: number) => string | undefined,
): PaperPaint | undefined {
  const margin = 3;
  const at = [
    paperAt(box.left - margin, box.top - margin),
    paperAt(box.left + box.width + margin, box.top - margin),
    paperAt(box.left - margin, box.top + box.height + margin),
    paperAt(box.left + box.width + margin, box.top + box.height + margin),
  ];
  const samples = at.filter((sample): sample is string => sample !== undefined);
  let best: string | undefined;
  let most = 0;
  for (const sample of samples) {
    const count = samples.filter((other) => other === sample).length;
    if (count > most) {
      best = sample;
      most = count;
    }
  }
  if (best === undefined) return undefined;
  // THREE OF FOUR AGREEING is flat paper with a stray neighbour at the fourth. PAPER THAT IS NOT ONE COLOUR is shading,
  // and a flat patch of its commonest sample would be a visible rectangle over it: where no three agree, the paper is the
  // gradient between the top pair and the bottom pair, which is how a page shades (a fill that varies across the box's
  // height), and it ends at the same colours.
  if (most >= Math.min(3, samples.length)) return { backgroundColor: best };
  const top = averageColour(at[0], at[1]) ?? averageColour(at[2], at[3]);
  const bottom = averageColour(at[2], at[3]) ?? top;
  if (top === undefined || bottom === undefined) return { backgroundColor: best };
  return { backgroundImage: `linear-gradient(to bottom, ${top}, ${bottom})` };
}

/** The mean of two sampled `rgb(r, g, b)` colours, or of the one there is; `undefined` where neither reads. */
function averageColour(a: string | undefined, b: string | undefined): string | undefined {
  const read = (sample: string | undefined): readonly number[] | undefined => {
    const found = /^rgb\((\d+), (\d+), (\d+)\)$/u.exec(sample ?? '');
    return found === null ? undefined : [Number(found[1]), Number(found[2]), Number(found[3])];
  };
  const x = read(a);
  const y = read(b);
  const mixed = x === undefined ? y : y === undefined ? x : x.map((value, at) => (value + (y[at] ?? value)) / 2);
  if (mixed === undefined) return undefined;
  return `rgb(${mixed.map((value) => String(Math.round(value))).join(', ')})`;
}
