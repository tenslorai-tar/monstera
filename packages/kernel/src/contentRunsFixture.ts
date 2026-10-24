import type { PageRun, PageRuns } from './operatorEdit.js';
import { showOperators, textObjectCount } from './textOperators.js';

/**
 * PDFium's reading of a page as the operator writer's cases need it (`editTextOperators`' pre-read, ADR-0176): each text
 * object one run of what its literal strings say, boxed near enough for an anchor. PDFium itself reads the page only in
 * the engine host, which a kernel case does not start, so the cases that apply the command take the page's runs from
 * here — one reading, so two cases cannot disagree about what a run is.
 *
 * The box runs from a fifth of the size below the baseline to four fifths above, and from the origin to where
 * Helvetica's average advance ends the run: the fixtures that use this set Helvetica.
 */
export function runsOfContent(content: Uint8Array): PageRuns {
  const ops = showOperators(content);
  const runs: PageRun[] = [];
  for (const textObject of new Set(ops.map((op) => op.textObject))) {
    const line = ops.filter((op) => op.textObject === textObject && op.object !== null);
    const first = line[0]?.object;
    if (first === undefined || first === null) continue;
    const text = line.map((op) => new TextDecoder('latin1').decode(op.codes)).join('');
    const lead = line[0];
    const [, , , , x = 0, y = 0] = lead?.state.matrix ?? [];
    const size = lead?.state.size ?? 0;
    runs.push({ index: first, members: line.map((op) => op.object ?? -1), text, left: x, right: x + 0.5 * size * text.length, bottom: y - 0.2 * size, top: y + 0.8 * size });
  }
  return { textObjects: Array.from({ length: textObjectCount(ops) }, (_, at) => at), runs };
}
