/**
 * Turning one edited visual line back into the replacements a command carries.
 *
 * ## Why a diff exists at all, rather than "put the new text in the line"
 *
 * A visual line is several **text objects** — PDFium answers one rect per run,
 * measured, which is why the editor groups them at all
 * ([ADR-0049](../../../docs/DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md))
 * — and each object carries its own font, size and colour. `replaceTextObject`
 * names objects, so an edit has to say *which* object now says what.
 *
 * The naive answer is to put the whole new string in the first object and empty
 * the rest. It is one line of code and it silently discards the formatting of
 * every run after the first, on every edit, including the edits that never
 * touched them. A person changing one word at the end of a line would lose the
 * styling of the beginning.
 *
 * So the edit is diffed: the runs a person actually changed are the runs that
 * are rewritten, and the rest are not named at all. In the common case — a word
 * changed inside one run — exactly one object is touched and nothing else on
 * the page moves.
 *
 * ## The diff is a COMMON PREFIX and a COMMON SUFFIX, and nothing cleverer
 *
 * There is no attempt at a minimal edit script. A prefix/suffix diff finds the
 * one contiguous span a person's edit changed, which is what a text input
 * produces: someone types, deletes or pastes in one place. A multi-part diff
 * would be a better answer to a question nobody is asking here, and every extra
 * case it introduced would be another way to name the wrong object.
 *
 * Where the changed span crosses a run boundary the result is stated rather
 * than hidden: the FIRST touched run takes the new text, the runs between are
 * emptied, and the LAST touched run keeps whatever followed the change. That
 * loses the formatting of the middle of an edit that crossed a boundary, which
 * is unavoidable — the new characters have to belong to some object, and no
 * object's formatting is more right than another's. What it does not do is lose
 * formatting the edit never reached.
 *
 * ## This is not a second extraction path
 *
 * ADR-0034's test is *does it read a coordinate to decide grouping?* Nothing
 * here reads a coordinate at all: the input is the runs a channel answered and
 * a string a person typed, and the output is that command's payload. The
 * grouping happened in main and its output reaches this dialog and nothing
 * else, which is the rule ADR-0049 makes checkable.
 */

/** One run of a line, as `document.textLines` answers it. */
export interface LineRun {
  /** The object's index in the editing engine's own page-object order. */
  readonly index: number;
  /** What it currently says. */
  readonly text: string;
}

/** One entry of `replaceTextObject`'s payload. */
export interface RunReplacement {
  readonly index: number;
  readonly text: string;
}

/** What a line currently says: its runs' text, in order. */
export function lineText(runs: readonly LineRun[]): string {
  return runs.map((run) => run.text).join('');
}

/** How many leading characters `before` and `after` share. */
function sharedPrefix(before: string, after: string): number {
  const limit = Math.min(before.length, after.length);
  let at = 0;
  while (at < limit && before[at] === after[at]) at += 1;
  return at;
}

/**
 * How many trailing characters `before` and `after` share, without overlapping
 * the prefix already claimed.
 *
 * The cap matters: for `AA` → `AAA` the prefix claims 2 and an uncapped suffix
 * would claim 2 as well, describing a change of −1 characters. Capping at what
 * is left makes the changed span empty and the insertion land in one place.
 */
function sharedSuffix(before: string, after: string, prefix: number): number {
  const limit = Math.min(before.length, after.length) - prefix;
  let at = 0;
  while (
    at < limit &&
    before[before.length - 1 - at] === after[after.length - 1 - at]
  ) {
    at += 1;
  }
  return at;
}

/** Where each run starts and ends within the line's text. */
function spans(runs: readonly LineRun[]): { start: number; end: number }[] {
  let at = 0;
  return runs.map((run) => {
    const start = at;
    at += run.text.length;
    return { start, end: at };
  });
}

/**
 * The replacements that turn this line's runs into `next`.
 *
 * Answers an **empty list** when nothing changed, and the caller must not send
 * a command for one: `replaceTextObjectSchema` refuses an empty `replacements`,
 * because regenerating a page's content stream for no change is the whole cost
 * of an edit paid for nothing. An empty answer here is *there is nothing to
 * do*, which is a different thing from a refusal and is reported as a disabled
 * button rather than as an error.
 *
 * @param runs the line's runs, in reading order, as the read answered them
 * @param next what the person wants the line to say
 */
export function replacementsForLine(
  runs: readonly LineRun[],
  next: string,
): readonly RunReplacement[] {
  const before = lineText(runs);
  if (before === next) return [];
  if (runs.length === 0) return [];

  const prefix = sharedPrefix(before, next);
  const suffix = sharedSuffix(before, next, prefix);
  /** Where the change ends in the OLD text. Never before `prefix`. */
  const changedEnd = before.length - suffix;
  const middle = next.slice(prefix, next.length - suffix);

  const bounds = spans(runs);
  // THE RUN THE CHANGE STARTS IN. `end > prefix` rather than `end >= prefix`,
  // so an insertion exactly at a boundary joins the run that FOLLOWS it — the
  // one whose text the person was about to type into. Falling back to the last
  // run covers an append past the line's end, where no run's `end` is greater.
  const firstAt = bounds.findIndex((span) => span.end > prefix);
  const first = firstAt === -1 ? runs.length - 1 : firstAt;
  // THE RUN THE CHANGE ENDS IN, found from the LAST side for the mirror reason:
  // a deletion ending exactly at a boundary must not claim the untouched run
  // after it.
  const lastAt = bounds.findIndex((span) => span.end >= changedEnd && span.start <= changedEnd);
  const last = Math.max(first, lastAt === -1 ? runs.length - 1 : lastAt);

  const replacements: RunReplacement[] = [];
  for (let at = first; at <= last; at += 1) {
    const run = runs[at];
    const span = bounds[at];
    if (run === undefined || span === undefined) continue;
    // WHAT OF THIS RUN SURVIVES: the part before the change, and the part after
    // it. Both are clamped into this run, so a run wholly inside the changed
    // span contributes neither and is emptied.
    const head = run.text.slice(0, Math.max(0, Math.min(run.text.length, prefix - span.start)));
    const tail = run.text.slice(Math.max(0, Math.min(run.text.length, changedEnd - span.start)));
    // THE NEW CHARACTERS GO TO THE FIRST TOUCHED RUN, which is the only choice
    // that keeps them adjacent to the text they were typed next to.
    const text = at === first ? head + middle + (at === last ? tail : '') : (at === last ? tail : '');
    // A RUN WHOSE TEXT DID NOT CHANGE IS NOT NAMED. Sending it would be an
    // object rewritten for nothing, and it would make the undo entry claim a
    // run the person never touched.
    if (text !== run.text) replacements.push({ index: run.index, text });
  }
  return replacements;
}
