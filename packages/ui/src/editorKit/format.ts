import {
  type Alignment,
  type Edited,
  type Model,
  type Paragraph,
  type ParagraphSetting,
  type RunStyle,
  type Selection,
  type StylePatch,
  applyParagraph,
  applyStyle,
  formatState,
  isCollapsed,
  ordered,
  paragraphText,
  replaceRange,
  restoreStyle,
  styleAt,
} from './model.js';
import type { EditorStore } from './store.js';

/**
 * What a format control asks of an open kit editor
 * ([ADR-0271](../../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md) section 3), and the one
 * function that does it, so a chord, the ribbon and the Properties panel change the words through one path (B3a).
 *
 * ## With a caret, a style is for the NEXT letters
 *
 * A word processor's Bold with nothing selected changes nothing on the page and makes the letters typed next bold. So a
 * letter style asked at a caret becomes the store's pending style, shown at once by every control subscribed to the
 * format state, and taken by the next letter typed; moving the caret drops it. A paragraph's setting has no such
 * pending form: it applies to the caret's paragraph.
 *
 * ## `null` takes the person's change off
 *
 * A value control's *none* — no highlight, no spacing, the face as on the page — puts each letter's property back to its
 * base, the page's, rather than to one value for all: three runs in three fonts given one font and then *As on the page*
 * are three fonts again.
 */
export type FormatAction =
  | { readonly kind: 'toggle'; readonly property: 'bold' | 'italic' | 'underline' | 'strike' }
  | { readonly kind: 'rise'; readonly rise: 'superscript' | 'subscript' }
  | { readonly kind: 'set'; readonly change: { readonly [K in StyleValue]?: RunStyle[K] | null } }
  | { readonly kind: 'align'; readonly align: Alignment }
  | { readonly kind: 'indent'; readonly steps: number }
  | { readonly kind: 'list'; readonly list: 'bullet' | 'number' }
  | { readonly kind: 'spacing'; readonly lineSpacing: number | null }
  | { readonly kind: 'space-after'; readonly points: number | null };

/** The letter properties a value control sets. */
export type StyleValue = 'face' | 'size' | 'colour' | 'highlight' | 'spacing';

/** Points a list's hanging indent and one step of indent move a paragraph. */
export const INDENT_STEP = 18;

const BULLET = /^•\s/u;
const NUMBER = /^\d+\.\s/u;

/** Does `action` to the open editor in `store`, answering whether anything changed. */
export function format(store: EditorStore, action: FormatAction): boolean {
  const { model, selection, pending } = store.get();
  const collapsed = isCollapsed(selection);
  const letters = (patch: StylePatch, restore: readonly (keyof RunStyle)[] = []): boolean => {
    if (collapsed) {
      const next = { ...(pending ?? styleAt(model, selection.focus)), ...patch };
      store.setPending(next);
      return true;
    }
    let edited = applyStyle(model, selection, patch);
    if (restore.length > 0) edited = restoreStyle(edited.model, selection, restore);
    store.change(edited, 'other');
    return true;
  };
  const paragraphs = (patch: (paragraph: Paragraph) => Partial<ParagraphSetting>): boolean => {
    store.change(eachParagraph(model, selection, patch), 'other');
    return true;
  };
  switch (action.kind) {
    case 'toggle': {
      const now = formatState(model, selection, pending)[action.property];
      return letters({ [action.property]: now !== 'on' });
    }
    case 'rise': {
      const now = formatState(model, selection, pending)[action.rise];
      return letters({ rise: now === 'on' ? 'none' : action.rise });
    }
    case 'set': {
      const patch: Record<string, unknown> = {};
      const restore: (keyof RunStyle)[] = [];
      for (const [key, value] of Object.entries(action.change) as [StyleValue, unknown][]) {
        // A HIGHLIGHT'S `null` IS A VALUE, *none*; every other `null` is the base's.
        if (value === null && key !== 'highlight') restore.push(key);
        else if (value !== undefined) patch[key] = value;
      }
      if (collapsed && restore.length > 0) {
        const here = model.paragraphs[selection.focus.paragraph]?.runs[0]?.base;
        for (const key of restore) if (here !== undefined) patch[key] = here[key];
      }
      return letters(patch, restore);
    }
    case 'align':
      return paragraphs(() => ({ align: action.align }));
    case 'indent':
      return paragraphs((paragraph) => ({ leftIndent: Math.max(0, paragraph.leftIndent + action.steps * INDENT_STEP) }));
    case 'spacing':
      return paragraphs((paragraph) => ({ lineSpacing: action.lineSpacing ?? paragraph.base?.lineSpacing ?? 1 }));
    case 'space-after':
      return paragraphs((paragraph) => ({ spaceAfter: action.points ?? paragraph.base?.spaceAfter ?? 0 }));
    case 'list':
      store.change(toggleList(model, selection, action.list), 'other');
      return true;
  }
}

/** Each paragraph the selection touches set by `patch` of itself. */
function eachParagraph(model: Model, selection: Selection, patch: (paragraph: Paragraph) => Partial<ParagraphSetting>): Edited {
  const { from, to } = ordered(selection);
  let edited: Edited = { model, selection };
  for (let index = from.paragraph; index <= to.paragraph; index += 1) {
    const paragraph = edited.model.paragraphs[index];
    if (paragraph === undefined) continue;
    const one = { anchor: { paragraph: index, offset: 0 }, focus: { paragraph: index, offset: 0 } };
    edited = { model: applyParagraph(edited.model, one, patch(paragraph)).model, selection };
  }
  return edited;
}

/**
 * The selected paragraphs made a list of `kind` — each begun with a bullet or its number and hung by one step — or taken
 * out of one where every one already is. Another kind of list is replaced, not stacked on. The selection moves with the
 * words the markers shift.
 */
export function toggleList(model: Model, selection: Selection, kind: 'bullet' | 'number'): Edited {
  const { from, to } = ordered(selection);
  const marker = kind === 'bullet' ? BULLET : NUMBER;
  const touched = model.paragraphs.slice(from.paragraph, to.paragraph + 1);
  const listed = touched.every((paragraph) => marker.test(paragraphText(paragraph)));
  let edited: Edited = { model, selection };
  const shift = new Map<number, number>();
  for (let index = from.paragraph; index <= to.paragraph; index += 1) {
    const paragraph = edited.model.paragraphs[index];
    if (paragraph === undefined) continue;
    const text = paragraphText(paragraph);
    const had = (BULLET.exec(text) ?? NUMBER.exec(text))?.[0] ?? '';
    const prefix = listed ? '' : kind === 'bullet' ? '• ' : `${String(index - from.paragraph + 1)}. `;
    const start = { paragraph: index, offset: 0 };
    const replaced = replaceRange(edited.model, start, { paragraph: index, offset: had.length }, prefix, styleAt(edited.model, { paragraph: index, offset: had.length > 0 ? had.length : 0 }));
    const indents = listed
      ? { leftIndent: paragraph.base?.leftIndent ?? 0, firstIndent: paragraph.base?.firstIndent ?? 0 }
      : { leftIndent: INDENT_STEP, firstIndent: -INDENT_STEP };
    edited = { model: applyParagraph(replaced.model, { anchor: start, focus: start }, indents).model, selection };
    shift.set(index, prefix.length - had.length);
  }
  const moved = (position: Selection['anchor']): Selection['anchor'] => ({
    paragraph: position.paragraph,
    offset: Math.max(0, position.offset + (shift.get(position.paragraph) ?? 0)),
  });
  return { model: edited.model, selection: { anchor: moved(selection.anchor), focus: moved(selection.focus) } };
}
