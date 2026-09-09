/**
 * The editor's visual lines, grouped from the editing engine's own runs.
 *
 * ## THE ONE INTERFACE
 *
 * [ADR-0049](../../../docs/DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)
 * permits a grouping of ours where no engine answers, and permits it **only
 * while its output reaches a dialog a person answers**. That is the rule, and it
 * is checkable rather than a judgement: *does this grouping's output reach any
 * consumer other than a dialog a person answers?* A second caller is the moment
 * it has become the second extraction path Part E2 bans, and this file's header
 * is where the next reader meets that.
 *
 * So nothing here is exported to the renderer's text layer, to search, to
 * extraction or to export. Those read MuPDF's structured text through
 * `textStructure.ts`, which owns the engine's options and implements no
 * clustering ([ADR-0034](../../../docs/DECISIONS/0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)),
 * and the two answers are never mixed on one surface.
 *
 * ## Why a grouping of ours exists at all, which is measured
 *
 * `scripts/research/pdfiumLines.mjs`, PDFium 155.0.8044.0, 2026-09-09:
 * `FPDFText_CountRects` answers **4 rects for four runs** whether the two
 * sharing a baseline sit 170pt apart or 3pt apart. PDFium's rects are per-RUN,
 * so there is no engine answer for a substrate to own options over — ADR-0034's
 * route 1 has nothing behind it, and this takes its route 2.
 *
 * The reading engine's lines are not available either, and that is refused on
 * evidence rather than on principle: `proof:lineagreement` scored **52.9%** of
 * our lines verbatim among an independent reader's, so a join between MuPDF's
 * lines and PDFium's objects would name the wrong run about half the time.
 *
 * ## OVERLAP, and there is no constant
 *
 * Two runs are on one line when their vertical extents **overlap**. That is a
 * relation, not a threshold, so Part E2's *"constants change only with a corpus
 * score in the commit message"* has nothing here to govern — which is the same
 * property ADR-0034 chose when it took options over an algorithm.
 *
 * Exact equality was tried first and rejected on the same measurement: two runs
 * drawn on one baseline in one font came back with tops of **237.9 and 238.0**,
 * so equality splits the very case the grouping exists for.
 */

/** One text run as the grouping needs it. `pdfiumFfi.ts`'s `TextRun`, structurally. */
export interface GroupableRun {
  readonly index: number;
  readonly text: string;
  readonly bottom: number;
  readonly top: number;
}

/**
 * One visual line: the runs it is made of, in reading order.
 *
 * ## NOT `TextLine`, and the collision is the reason
 *
 * `textStructure.ts` already exports a `TextLine`: MuPDF's structured text, the
 * reading engine's own lines, which feed the renderer's text layer, search and
 * extraction. This is PDFium's runs grouped by the editor for an edit, and the
 * two are different readings of the same page — `proof:lineagreement` scored
 * **52.9%** of ours verbatim among an independent reader's.
 *
 * One name for both would put that 52.9% inside a type, where a caller holding
 * either would compile. The name says which reading it is, and the collision
 * that forced it is a better guard than a comment saying not to mix them.
 */
export interface EditableLine {
  /**
   * The runs this line covers, in the order their text appears.
   *
   * ## The RUNS and not a concatenated string, which is a decision
   *
   * A line arriving as one string reads better and cannot be edited back: a run
   * is a text object with its own font, `replaceTextObject` names objects, and
   * something would have to work out which characters of the string belonged to
   * which object. That something would hold no run boundaries, so it would be
   * re-deriving what this function already knows and threw away.
   *
   * The display text is `runs.map((run) => run.text).join('')` and is derived
   * where it is shown. A field carrying it here would be a second copy of the
   * same fact, and the two could disagree only by a bug.
   *
   * The index is the engine's own numbering, unconverted — the whole of
   * ADR-0049's first decision is that no other index space reaches it.
   */
  readonly runs: readonly { readonly index: number; readonly text: string }[];
}

/**
 * Groups runs into visual lines.
 *
 * ## The order within a line is the RUNS' order, not a sort by position
 *
 * `textRuns` walks PDFium's text page, which is reading order — the order the
 * characters come back in — so the runs arrive already ordered and this
 * preserves it. Sorting by horizontal position here would be a second opinion
 * about reading order, held by the module least equipped to have one: it would
 * read right-to-left scripts backwards, and it would disagree with the text the
 * user is shown, which comes from the same walk.
 *
 * ## A run joins the line it overlaps, and the FIRST such line
 *
 * Runs are considered in order and each joins the first open line whose extent
 * it overlaps, extending that line's extent. Two lines that were separate and
 * are bridged by a third run stay separate — the bridging run joins the first —
 * and that is the conservative direction: a person sees the runs a line claims
 * and can pick the other one, where a merge would offer them a line they never
 * saw.
 *
 * @param runs the page's text runs, in reading order
 */
export function groupIntoLines(runs: readonly GroupableRun[]): readonly EditableLine[] {
  /** Lines under construction, each carrying the extent it has grown to. */
  const open: {
    runs: { index: number; text: string }[];
    bottom: number;
    top: number;
  }[] = [];

  for (const run of runs) {
    // OVERLAP IS `bottom < other.top && top > other.bottom`, strictly — two runs
    // that merely touch at an edge are on two lines. A `<=` here would join the
    // descender of one line to the ascender of the next on tightly set text,
    // which is the failure mode the conservative direction exists to avoid.
    const line = open.find((held) => run.bottom < held.top && run.top > held.bottom);
    if (line === undefined) {
      open.push({
        runs: [{ index: run.index, text: run.text }],
        bottom: run.bottom,
        top: run.top,
      });
      continue;
    }
    line.runs.push({ index: run.index, text: run.text });
    line.bottom = Math.min(line.bottom, run.bottom);
    line.top = Math.max(line.top, run.top);
  }

  // THE EXTENT DOES NOT LEAVE. It is what the grouping decided by, and a
  // consumer holding it would be one step from deciding something else with a
  // coordinate — which is the question ADR-0034's test asks of any second
  // reader. What leaves is the answer, not the working.
  return open.map((line) => ({ runs: line.runs }));
}
