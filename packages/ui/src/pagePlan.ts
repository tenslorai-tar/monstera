import { type DispatchableCommand, pagesOfSet } from '@monstera/contract';
import { type DocVersion, keptPermutation, movePermutation, swapPermutation } from '@monstera/shared';

import type { PageRotation } from './renderPage.js';

/**
 * A document's page PLAN: the pages a person will see once the page commands sent and not yet drawn are drawn,
 * each named as a page of the view already on screen and turned from the rotation that view draws it at
 * ([ADR-0261](../../../docs/DECISIONS/0261-a-page-command-is-shown-at-once-from-the-pages-already-drawn.md)).
 *
 * The main view, the thumbnail strip and Organize draw a plan from the view they hold, in the update the command is
 * sent in, and draw the new version once the page has it — the handover ADR-0257 gave held looks.
 *
 * ## One reorder rule, the kernel's
 *
 * A move, a swap and a delete are the permutations the page-tree writer itself applies (`movePermutation`,
 * `swapPermutation`, `keptPermutation` in `@monstera/shared`): `permutation[d] = s`, the page at `s` is at `d`
 * afterwards. A second spelling of where a moved page lands, here, is the one a plan and the saved page would one
 * day disagree on (B3a).
 */

/** One page of a plan: which page of the view on screen it is, and how many quarter turns clockwise from how that view draws it. */
export interface PlannedPage {
  readonly source: number;
  readonly turn: number;
}

/** A page command, as a plan reads it. */
export type PageOp =
  | { readonly kind: 'rotate'; readonly pages: readonly number[]; readonly quarterTurns: number }
  | { readonly kind: 'move'; readonly from: number; readonly to: number }
  | { readonly kind: 'swap'; readonly a: number; readonly b: number }
  | { readonly kind: 'delete'; readonly pages: readonly number[] };

/** The page op `command` is, against a document of `pageCount` pages; `null` for any other command, or one naming a page it does not have. */
export function pageOpOf(command: DispatchableCommand, pageCount: number): PageOp | null {
  const outside = (): never => {
    throw new RangeError('outside');
  };
  const inside = (page: number): boolean => Number.isInteger(page) && page >= 0 && page < pageCount;
  try {
    // FOUR KINDS OF THE MANY, so a test per kind rather than a switch that would have to name every other one.
    if (command.kind === 'rotatePages') {
      return { kind: 'rotate', pages: pagesOfSet(command.pages, pageCount, outside), quarterTurns: command.quarterTurns };
    }
    if (command.kind === 'movePage') {
      return inside(command.from) && inside(command.to) ? { kind: 'move', from: command.from, to: command.to } : null;
    }
    if (command.kind === 'swapPages') {
      return inside(command.a) && inside(command.b) ? { kind: 'swap', a: command.a, b: command.b } : null;
    }
    if (command.kind === 'deletePages') return { kind: 'delete', pages: pagesOfSet(command.pages, pageCount, outside) };
    return null;
  } catch {
    // A PAGE THE DOCUMENT DOES NOT HAVE is main's refusal to give; the plan shows nothing ahead of it.
    return null;
  }
}

/** The pages after `op`, from the pages before it. */
export function afterOp(pages: readonly PlannedPage[], op: PageOp): readonly PlannedPage[] {
  const reordered = (permutation: readonly number[]): readonly PlannedPage[] =>
    permutation.map((source) => {
      const page = pages[source];
      // NEVER, since a permutation of `pages.length` names only its indices; said rather than cast, so it cannot be silent.
      if (page === undefined) throw new RangeError(`the permutation names page ${String(source)} of ${String(pages.length)}`);
      return page;
    });
  switch (op.kind) {
    case 'rotate': {
      const turned = new Set(op.pages);
      return pages.map((page, at) => (turned.has(at) ? { source: page.source, turn: (page.turn + op.quarterTurns) % 4 } : page));
    }
    case 'move':
      return reordered(movePermutation(pages.length, op.from, op.to));
    case 'swap':
      return reordered(swapPermutation(pages.length, op.a, op.b));
    case 'delete':
      return reordered(keptPermutation(pages.length, op.pages));
  }
}

/**
 * The op that puts `op` back, as an undo of it is planned; `null` for a delete, whose pages no view still holds once
 * it is drawn (ADR-0261 Decision 4).
 */
export function inverseOf(op: PageOp): PageOp | null {
  switch (op.kind) {
    case 'rotate':
      return { kind: 'rotate', pages: op.pages, quarterTurns: (4 - op.quarterTurns) % 4 };
    case 'move':
      return { kind: 'move', from: op.to, to: op.from };
    case 'swap':
      // A NEW OBJECT, though a swap is its own inverse: the holder tells pending ops apart by identity.
      return { kind: 'swap', a: op.a, b: op.b };
    case 'delete':
      return null;
  }
}

/** An op sent and not yet drawn: what it does, and the version its command produced once main has answered. */
export interface PendingOp {
  readonly op: PageOp;
  readonly produced: DocVersion | undefined;
}

/**
 * The pages to draw over a view at `viewVersion` with `pageCount` pages, or `null` when nothing planned is ahead of
 * that view: every pending op whose version the view does not have yet, in the order sent.
 */
export function plannedPages(pending: readonly PendingOp[], viewVersion: DocVersion, pageCount: number): readonly PlannedPage[] | null {
  const ahead = pending.filter((each) => each.produced === undefined || each.produced > viewVersion);
  if (ahead.length === 0) return null;
  let pages: readonly PlannedPage[] = Array.from({ length: pageCount }, (_unused, source) => ({ source, turn: 0 }));
  for (const { op } of ahead) {
    if (!fits(op, pages.length)) return null;
    pages = afterOp(pages, op);
  }
  return pages;
}

/** Whether `op` names only pages a layout of `count` pages has: an op planned against another layout draws nothing ahead. */
function fits(op: PageOp, count: number): boolean {
  const inside = (page: number): boolean => page >= 0 && page < count;
  switch (op.kind) {
    case 'rotate':
    case 'delete':
      return op.pages.every(inside);
    case 'move':
      return inside(op.from) && inside(op.to);
    case 'swap':
      return inside(op.a) && inside(op.b);
  }
}

/**
 * The rotation to draw a planned page at: the rotation the model gave its source AT THE VIEW'S VERSION, turned by the
 * plan. Not the view's own `/Rotate`: a rotate is a view-model command that writes no new bytes in main (ADR-0032), so
 * after one the view's bytes still carry the rotation from before it, and the model is what the page was drawn with.
 * Nor the model's answer at the STORE's version, which describes the pages after the commands (ADR-0261, fact 2). The
 * page's own rotation, turned, only where the model never answered for that version — which is what the page was drawn
 * with then too.
 *
 * @param base the model's rotation of the source at the view's version, where it answered
 */
export function plannedRotation(page: PlannedPage, base: number | undefined): PageRotation {
  return base === undefined ? TURNS[page.turn % 4] : (base + page.turn * 90) % 360;
}

/** ONE value per turn: a slot redraws when its rotation changes identity, so a fresh object per render redraws every render. */
const TURNS: readonly PageRotation[] = [undefined, { turnedFromOwn: 1 }, { turnedFromOwn: 2 }, { turnedFromOwn: 3 }];

/**
 * A document's ONE holder of page ops sent and not yet drawn (ADR-0261 Decision 1), and of what each answered op
 * would be undone and redone by. A store of its own beside the document's, for ADR-0257's reason: only the surfaces
 * that draw pages subscribe, so a plan renders them and not the shell.
 */
export interface PagePlans {
  readonly getSnapshot: () => readonly PendingOp[];
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Plans `op`, sent over a document whose version is `storeVersion` while the view on screen is at `viewVersion`,
   * and answers a handle for {@link answered} and {@link refused} — or `null`, not planned, when the view is behind
   * the store with nothing planned between them (ADR-0261 Decision 2).
   */
  readonly propose: (op: PageOp, storeVersion: DocVersion, viewVersion: DocVersion) => object | null;
  /** The planned op's command moved the document to `version`. */
  readonly answered: (handle: object, version: DocVersion) => void;
  /** A planned op's command was refused, or moved nothing: every pending op is dropped (Decision 5). */
  readonly refused: () => void;
  /**
   * The document's view on screen is now at `version` with `pageCount` pages: every op it has is drawn and leaves, and a
   * command sent from now is planned over it. Told by the page pane that holds the view, in a layout effect.
   */
  readonly viewShown: (version: DocVersion, pageCount: number) => void;
  /** The view on screen, as last told, or `undefined` before one is: then nothing is planned. */
  readonly view: () => { readonly version: DocVersion; readonly pageCount: number } | undefined;
  /** The op an undo from `version` is planned with, if the op that produced it was planned. */
  readonly undoOf: (version: DocVersion) => PageOp | null;
  /** The op a redo from `version` is planned with, if an undo of a planned op produced it. */
  readonly redoOf: (version: DocVersion) => PageOp | null;
  /** An undo of `op` moved the document to `version`: a redo from there is planned with `op`. */
  readonly undone: (op: PageOp, version: DocVersion) => void;
}

export function createPagePlans(): PagePlans {
  let pending: readonly PendingOp[] = [];
  let shown: { readonly version: DocVersion; readonly pageCount: number } | undefined;
  /** The op each answered planned command was, by the version it produced. */
  const producedBy = new Map<DocVersion, PageOp>();
  /** The op a redo from each version would repeat. */
  const redoFrom = new Map<DocVersion, PageOp>();
  const handles = new WeakMap<object, PageOp>();
  const listeners = new Set<() => void>();
  const changed = (next: readonly PendingOp[]): void => {
    pending = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => pending,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    propose: (op, storeVersion, viewVersion) => {
      if (pending.length === 0 && viewVersion !== storeVersion) return null;
      const handle = {};
      handles.set(handle, op);
      changed([...pending, { op, produced: undefined }]);
      return handle;
    },
    answered: (handle, version) => {
      const op = handles.get(handle);
      if (op === undefined) return;
      producedBy.set(version, op);
      changed(pending.map((each) => (each.op === op && each.produced === undefined ? { op, produced: version } : each)));
    },
    refused: () => {
      if (pending.length > 0) changed([]);
    },
    viewShown: (version, pageCount) => {
      shown = { version, pageCount };
      const left = pending.filter((each) => each.produced === undefined || each.produced > version);
      if (left.length !== pending.length) changed(left);
    },
    view: () => shown,
    undoOf: (version) => {
      const op = producedBy.get(version);
      return op === undefined ? null : inverseOf(op);
    },
    redoOf: (version) => redoFrom.get(version) ?? null,
    undone: (op, version) => {
      redoFrom.set(version, op);
    },
  };
}
