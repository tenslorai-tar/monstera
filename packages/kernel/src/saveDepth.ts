import type { Buffer as MupdfBuffer, PDFDocument } from './mupdfRaw.js';

/**
 * How deep MuPDF's collecting save will recurse on a document, worked out BEFORE the save rather than learnt from a
 * crash (the owner's decision of 2026-10-16), and the one place a MuPDF document is written.
 *
 * ## The mechanism it mirrors
 *
 * A save whose terms include `garbage` marks every object reachable from the trailer with `markobj` (`pdf-write.c`,
 * MuPDF 1.28.0), which is RECURSIVE: one C stack frame per call — a call for the trailer and one for every value of every
 * dictionary and array it reaches — with references followed in a loop inside the same frame and an object already
 * marked answered at once. So the stack a save needs is the deepest chain of nested calls in exactly that traversal, and
 * a chain of references that each lead somewhere new costs a frame a link; an outline's `/Next` chain is the plainest.
 * Past the thread's stack the process dies: in the engine host's own runtime on Windows (session 3, 2026-10-15,
 * `measure/session3/chain`), an outline of 10,882 links saved and 10,883 ended the process with 0xC0000005. That chain
 * reads 10,887 here, so the crash is at 10,888 frames.
 *
 * {@link saveDepth} is `markobj`'s traversal, frame for frame: the trailer first, a dictionary's values in index order
 * (the order `pdf_sprint_obj` prints them in), an array's in position, marks by object number, a reference out of range
 * or to nothing marking nothing, and a leaf counted as deep as a container. It reads each object once as MuPDF prints it
 * and walks an explicit stack, so measuring never needs the stack the save would. It measures DEPTH, never outlines: any
 * structure that nests new references reaches it. An incremental save marks nothing and is not measured.
 *
 * Its cost was measured 2026-10-16 on this machine: 522 ms for the 10,887-object chain and 0 to 42 ms for the 11
 * corpus documents (8 to 579 objects), about 48 µs an object, every depth equal to a frame-by-frame walk through the
 * object API (which cost four times as much).
 */

/**
 * The deepest a collecting save may recurse: 8,000 frames, 73% of the 10,888 that crashed the engine host on Windows.
 * From the Windows reading because its main thread's stack is the smaller (Linux saved 15,313 links in session 3), and
 * below it because a save is called from some way down the host's own stack, which nothing measured.
 */
export const SAVE_DEPTH_MAX = 8_000;

/** What a collecting save would need, and what its deepest chain runs through. */
export interface SaveDepth {
  /** The most `markobj` calls nested at once. */
  readonly depth: number;
  /** The first keys of the deepest chain, from the trailer: `Root/Outlines/First/Next/…`. */
  readonly path: readonly string[];
}

/** Whether a deepest chain runs through the document's outline (`/Root/Outlines`), which a copy can leave out. */
export function throughOutline(measured: SaveDepth): boolean {
  return measured.path[0] === 'Root' && measured.path[1] === 'Outlines';
}

/**
 * A collecting save refused because the document nests deeper than the engine's stack holds. Thrown where the depth was
 * measured, and rebuilt by `main` from the host's answer, which carries only whether the outline is the cause.
 */
export class StructureTooDeep extends Error {
  override readonly name = 'StructureTooDeep';

  constructor(
    /** Whether the deepest chain runs through the outline, so a copy without bookmarks can be written. */
    readonly throughOutline: boolean,
    /** The measurement, where this process took it. */
    readonly measured?: SaveDepth,
  ) {
    super(
      measured === undefined
        ? `the document's structure is deeper than a save can hold${throughOutline ? ', through its bookmarks' : ''}; nothing was written`
        : `the document's structure is ${String(measured.depth)} levels deep through /${measured.path.join('/')}, past the ` +
            `${String(SAVE_DEPTH_MAX)} a save can hold; nothing was written`,
    );
  }
}

/** A value as `markobj` meets it: a leaf, a reference by object number, or a container's values in order. */
type Value = { readonly kind: 'leaf' } | { readonly kind: 'ref'; readonly number: number } | Container;
interface Container {
  readonly kind: 'container';
  readonly values: readonly Value[];
  readonly keys: readonly string[];
}

const LEAF: Value = { kind: 'leaf' };

type Token = '[' | ']' | '<<' | '>>' | { readonly name: string } | { readonly number: string } | 'R' | 'leaf';

/** The tokens of one object as MuPDF prints it (`pdf_sprint_obj`, tight, ASCII). */
function tokens(text: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const c = text[at] ?? '';
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') at += 1;
    else if (c === '[' || c === ']') {
      out.push(c);
      at += 1;
    } else if (c === '<' && text[at + 1] === '<') {
      out.push('<<');
      at += 2;
    } else if (c === '>' && text[at + 1] === '>') {
      out.push('>>');
      at += 2;
    } else if (c === '<') {
      const end = text.indexOf('>', at);
      at = end < 0 ? text.length : end + 1;
      out.push('leaf');
    } else if (c === '(') {
      let depth = 1;
      at += 1;
      while (at < text.length && depth > 0) {
        const here = text[at];
        if (here === '\\') at += 2;
        else {
          if (here === '(') depth += 1;
          else if (here === ')') depth -= 1;
          at += 1;
        }
      }
      out.push('leaf');
    } else {
      const start = c === '/' ? at + 1 : at;
      let end = start;
      while (end < text.length && !/[\s/[\]<>()]/u.test(text[end] ?? '')) end += 1;
      const word = text.slice(start, end);
      if (c === '/') out.push({ name: word });
      else if (word === 'R') out.push('R');
      else if (/^-?\d+$/u.test(word)) out.push({ number: word });
      else out.push('leaf');
      at = end === at ? at + 1 : end;
    }
  }
  return out;
}

/** One object's printed text as the values `markobj` visits; `n g R` is one reference wherever it stands. */
export function parseObject(text: string): Value {
  const list = tokens(text);
  let at = 0;
  const isNumber = (token: Token | undefined): token is { readonly number: string } =>
    typeof token === 'object' && 'number' in token;
  const value = (): Value => {
    const token = list[at];
    if (token === '[') {
      at += 1;
      const values: Value[] = [];
      while (at < list.length && list[at] !== ']') values.push(value());
      at += 1;
      return { kind: 'container', values, keys: [] };
    }
    if (token === '<<') {
      at += 1;
      const values: Value[] = [];
      const keys: string[] = [];
      while (at < list.length && list[at] !== '>>') {
        const key = list[at];
        if (typeof key !== 'object' || !('name' in key)) throw new Error('a dictionary key that is not a name');
        at += 1;
        keys.push(key.name);
        values.push(value());
      }
      at += 1;
      return { kind: 'container', values, keys };
    }
    const second = list[at + 1];
    if (isNumber(token) && isNumber(second) && list[at + 2] === 'R') {
      at += 3;
      return { kind: 'ref', number: Number(token.number) };
    }
    at += 1;
    return LEAF;
  };
  return value();
}

/** How many keys of the deepest chain are kept to say what it runs through. */
const PATH_KEPT = 6;

/** {@link SaveDepth} for `document` as a collecting save would meet it now. */
export function saveDepth(document: PDFDocument): SaveDepth {
  const objects = document.countObjects();
  const marked = new Uint8Array(Math.max(objects, 1));
  interface Frame {
    readonly container: Container;
    next: number;
    readonly depth: number;
  }
  const stack: Frame[] = [];
  const route: string[] = [];
  let deepest = 0;
  let path: string[] = [];
  /** One `markobj` call at `depth` on `value`: the frame it opens, if any. */
  const call = (value: Value, depth: number): Frame | undefined => {
    if (depth > deepest) {
      deepest = depth;
      path = route.slice(0, PATH_KEPT);
    }
    let resolved = value;
    if (resolved.kind === 'ref') {
      const number = resolved.number;
      if (number <= 0 || number >= objects || marked[number] === 1) return undefined;
      const object = document.newIndirect(number).resolve();
      if (object.isNull()) return undefined;
      marked[number] = 1;
      resolved = parseObject(object.toString(true, true));
    }
    return resolved.kind === 'container' ? { container: resolved, next: 0, depth } : undefined;
  };
  const first = call(parseObject(document.getTrailer().toString(true, true)), 1);
  if (first !== undefined) stack.push(first);
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (top === undefined) break;
    if (top.next >= top.container.values.length) {
      stack.pop();
      route.pop();
      continue;
    }
    const at = top.next;
    top.next += 1;
    route.push(top.container.keys[at] ?? String(at));
    const opened = call(top.container.values[at] ?? LEAF, top.depth + 1);
    if (opened === undefined) route.pop();
    else stack.push(opened);
  }
  return { depth: deepest, path };
}

/**
 * The ONE way a MuPDF document is written: `saveToBuffer` with `terms`, measured first when the terms collect, and
 * refused as {@link StructureTooDeep} where the save would pass {@link SAVE_DEPTH_MAX}. `saveDepth.test.ts` holds every
 * other `saveToBuffer` in the kernel's source to this one.
 */
export function savedBuffer(document: PDFDocument, terms: string): MupdfBuffer {
  if (terms.split(',').some((term) => term.trim().startsWith('garbage'))) {
    const measured = saveDepth(document);
    if (measured.depth > SAVE_DEPTH_MAX) throw new StructureTooDeep(throughOutline(measured), measured);
  }
  return document.saveToBuffer(terms);
}

/**
 * {@link savedBuffer} of the document with its outline left out: `/Root/Outlines` taken away for the save and put back
 * after it, whatever the save did, so the open document keeps its bookmarks and only the copy has none. What *Save a
 * copy without bookmarks* writes when the outline is what made the document too deep to save.
 */
export function savedWithoutOutline(document: PDFDocument, terms: string): MupdfBuffer {
  const root = document.getTrailer().get('Root');
  const outlines = root.get('Outlines');
  if (outlines.isNull()) return savedBuffer(document, terms);
  root.delete('Outlines');
  try {
    return savedBuffer(document, terms);
  } finally {
    root.put('Outlines', outlines);
  }
}
