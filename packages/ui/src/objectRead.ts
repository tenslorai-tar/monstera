import type { AnnotationRect, ChannelResult, ContractClient, ListedObject } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import type { reportProblem } from './commands/documentCommands.js';
import type { EditableObject, PageObjects } from './objectEditing.js';
import { readWholeList } from './readWholeList.js';
import { wordsOfBlock } from './textBlockOps.js';

/** One object as `document.pageObjects` answers it. */
type ReadObject = ChannelResult<'document.pageObjects'>['objects'][number];

/** What SHOWS of an object: its box cut to its clip where a clip narrows it, the engine's own box where nothing does. */
export function shownOf(object: ReadObject): AnnotationRect {
  return object.shown === undefined
    ? { x0: object.left, y0: object.bottom, x1: object.right, y1: object.top }
    : { x0: object.shown.left, y0: object.shown.bottom, x1: object.shown.right, y1: object.shown.top };
}

/** A box as the contract's listing carries one. */
function listedBox(box: AnnotationRect): ListedObject['box'] {
  return { left: box.x0, bottom: box.y0, right: box.x1, top: box.y1 };
}

/**
 * One page's objects for Edit object's mode
 * ([ADR-0264](../../../docs/DECISIONS/0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md)
 * Decision 9): PDFium's walk of the page's content, the page's text blocks read AS IT IS (never unpacked, because the
 * operator writer names the page as it is), and the pictures placed with Comment › Image — at ONE version.
 *
 * - A drawn object is named by its kind and its place among its kind, counted over the whole walk, which is how the
 *   writer finds it.
 * - A text object is selectable only as the block holding it; one in no block (a run Edit text does not edit in place) is
 *   not offered, since no writer here edits a lone text object.
 * - `filter` decides only whether the blocks are read: under Images or Shapes no text is outlined, and the read is not
 *   paid for.
 *
 * `refused` is a read's own failure; `undefined` where the reads answered at different versions, which is the document
 * moving between them, read again at the next version.
 */
export async function readPageObjects(
  client: ContractClient,
  docId: DocId,
  page: number,
  withText: boolean,
): Promise<
  | { readonly ok: true; readonly objects: PageObjects }
  | { readonly ok: false; readonly refused: Parameters<typeof reportProblem>[1] | undefined }
> {
  // EVERY PART, read whole at one version (ADR-0130): a page drawn one glyph per object is thousands of objects.
  const [content, marks, blocks] = await Promise.all([
    readWholeList(
      (from) => client['document.pageObjects']({ docId, page, from }),
      (part) => part.objects,
    ),
    readWholeList(
      (from) => client['document.annotations']({ docId, from }),
      (part) => part.annotations,
    ),
    withText
      ? readWholeList(
          (from) => client['document.textBlocks']({ docId, page, from, asItIs: true }),
          (part) => part.blocks,
        )
      : Promise.resolve(undefined),
  ]);
  if (!content.ok) return { ok: false, refused: content.error };
  if (!marks.ok) return { ok: false, refused: marks.error };
  const version = content.value.version;
  if (marks.value.version !== version) return { ok: false, refused: undefined };
  // A BLOCK READ THAT WAS REFUSED leaves the page's pictures and shapes selectable, never the mode refused.
  if (blocks?.ok === true && blocks.value.version !== version) return { ok: false, refused: undefined };

  const listed: ListedObject[] = content.value.items.map((object) => ({ index: object.index, kind: object.kind, box: listedBox(shownOf(object)) }));
  const objects: EditableObject[] = [];
  const counted = new Map<string, number>();
  for (const object of content.value.items) {
    if (object.kind === 'unknown' || object.kind === 'text') continue;
    const ordinal = counted.get(object.kind) ?? 0;
    counted.set(object.kind, ordinal + 1);
    const { fill } = object;
    objects.push({
      source: 'drawn',
      index: object.index,
      kind: object.kind,
      ordinal,
      box: shownOf(object),
      drawn: { x0: object.left, y0: object.bottom, x1: object.right, y1: object.top },
      fill: fill === null ? null : { r: fill.red, g: fill.green, b: fill.blue },
    });
  }
  if (blocks?.ok === true) {
    for (const block of blocks.value.items) {
      const indices = block.lines.flatMap((line) => line.runs.map((run) => run.index)).sort((a, b) => a - b);
      const [first] = indices;
      if (first === undefined) continue;
      objects.push({
        source: 'text',
        kind: 'text',
        index: first,
        indices,
        box: block.box,
        block: { lines: block.lines.map((line) => line.runs.map((run) => run.index)), soft: block.lines.map((line) => line.soft), text: wordsOfBlock(block) },
        fill: block.style.colour,
      });
    }
  }
  // THE DRAWING ORDER, which the picking order keeps: a block stands where its first run is drawn.
  objects.sort((a, b) => a.index - b.index);
  for (const mark of marks.value.items) {
    // A PICTURE A PERSON PLACED, on this page and drawn in a region: what the content walk cannot see, and over it.
    if (mark.page === page && mark.pictured === true && mark.rect !== null) objects.push({ source: 'stamp', kind: 'picture', index: mark.index, box: mark.rect });
  }
  return { ok: true, objects: { version, objects, listed, truncated: content.value.last.truncated || marks.value.last.truncated } };
}
