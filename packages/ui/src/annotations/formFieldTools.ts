import type { CreatedField, RenderableCommand } from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';

import {
  FORM_FIELD_CHECKBOX_DIALOG_ID,
  FORM_FIELD_DROPDOWN_DIALOG_ID,
  FORM_FIELD_LISTBOX_DIALOG_ID,
  FORM_FIELD_RADIO_DIALOG_ID,
  FORM_FIELD_TEXT_DIALOG_ID,
} from '../dialogs/formField.js';
import { FORM_FIELD_RESULT } from '../dialogs/formFieldResult.js';
import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';
import { draggedRect } from './annotationSpace.js';
import type { TextToolDeps } from './textTools.js';

/**
 * The five create-field tools — Stage 4's *create fields by drawing*.
 *
 * ## Why these are tools and not a panel control
 *
 * *By drawing* is the row's own wording, and it is the right one: a field's
 * rectangle is the whole of what a person is deciding, and there is no honest
 * way to type one. So this is `shapeTools`' gesture — one drag, two points —
 * with a dialog after it, which is `textTools`' shape.
 *
 * ## FIVE, and the sixth is a measurement rather than a scoping choice
 *
 * The D5 row names six types. Measured 2026-09-08
 * (`scripts/research/formFieldCreate.mjs`), `@cantoo/pdf-lib` declares no
 * signature factory — so a signature field cannot be created without this build
 * writing a field dictionary itself, which is a second writer for the concern
 * §3's matrix assigns to pdf-lib. There is no signature tool here and there is
 * no control that renders and refuses either; the limit is stated in the
 * FEATURES row, where a person can find it.
 *
 * ## One factory, because what differs between them is two values
 *
 * `shapeTools`' rule about when a second factory is warranted: a box tool and a
 * line tool differ in what counts as *too small to be meant*, and these five do
 * not — every one of them is a box, and a box 3 pixels across is a click
 * whichever field it was going to be. What differs is the dialog opened and the
 * `field` member built from its answer.
 *
 * ## The gesture is a rectangle and the payload is a rectangle, with nothing between
 *
 * Measured 2026-09-08: pdf-lib writes `/Rect` in raw PDF user space verbatim, so
 * `draggedRect`'s output reaches the document unchanged. What the kernel adds is
 * the **turn** — a field on a rotated page needs its content rotated to match,
 * and the pre-image of that rotation as its argument. None of that is expressible
 * here, deliberately: the page's `/Rotate` is document state, and a surface that
 * computed a placement from it would be the renderer holding geometry the kernel
 * owns.
 */

/**
 * How far the pointer must travel before a drag is a field.
 *
 * `shapeTools`' `MINIMUM_DRAG` in both axes, and the reason to check both is
 * sharper here than it is for a rectangle annotation: a field 40 by 1 is not a
 * thin box, it is a control nobody can click, and unlike an annotation there is
 * no eraser tool that finds it. In CSS pixels, because it is about the hand.
 */
const MINIMUM_BOX = 4;

/** What each tool asks for and builds, keyed by nothing — read at construction. */
interface FieldToolShape {
  readonly id: string;
  readonly dialog: string;
  /** Turns the dialog's answer into the payload's discriminated member. */
  readonly build: (answer: {
    readonly option?: string | undefined;
    readonly options?: readonly string[] | undefined;
  }) => CreatedField | undefined;
}

/** The id of the tool that draws a text field. */
export const FORM_FIELD_TEXT_TOOL_ID = 'forms.field-text';
/** The id of the tool that draws a tick box. */
export const FORM_FIELD_CHECKBOX_TOOL_ID = 'forms.field-checkbox';
/** The id of the tool that draws one option of a radio group. */
export const FORM_FIELD_RADIO_TOOL_ID = 'forms.field-radio';
/** The id of the tool that draws a dropdown. */
export const FORM_FIELD_DROPDOWN_TOOL_ID = 'forms.field-dropdown';
/** The id of the tool that draws a list box. */
export const FORM_FIELD_LISTBOX_TOOL_ID = 'forms.field-listbox';

const SHAPES: readonly FieldToolShape[] = [
  {
    id: FORM_FIELD_TEXT_TOOL_ID,
    dialog: FORM_FIELD_TEXT_DIALOG_ID,
    build: () => ({ type: 'text' }),
  },
  {
    id: FORM_FIELD_CHECKBOX_TOOL_ID,
    dialog: FORM_FIELD_CHECKBOX_DIALOG_ID,
    build: () => ({ type: 'checkbox' }),
  },
  {
    id: FORM_FIELD_RADIO_TOOL_ID,
    dialog: FORM_FIELD_RADIO_DIALOG_ID,
    // `undefined` WHEN THE ANSWER LACKS WHAT THIS KIND NEEDS, which is the same
    // outcome a dismissed dialog produces. One result schema serves five
    // dialogs, so `option` is optional there and it is the tool — the one thing
    // that knows which kind it is creating — that narrows it. A cast would make
    // a dialog answering the wrong shape into a command carrying `undefined`.
    build: (answer) => (answer.option === undefined ? undefined : { type: 'radio', option: answer.option }),
  },
  {
    id: FORM_FIELD_DROPDOWN_TOOL_ID,
    dialog: FORM_FIELD_DROPDOWN_DIALOG_ID,
    build: (answer) =>
      answer.options === undefined || answer.options.length === 0
        ? undefined
        : { type: 'dropdown', options: answer.options },
  },
  {
    id: FORM_FIELD_LISTBOX_TOOL_ID,
    dialog: FORM_FIELD_LISTBOX_DIALOG_ID,
    build: (answer) =>
      answer.options === undefined || answer.options.length === 0
        ? undefined
        : { type: 'listbox', options: answer.options },
  },
];

function fieldTool(shape: FieldToolShape, deps: TextToolDeps): UiTool {
  const drawn = (gesture: Gesture): ToolPreview | undefined => {
    const from = startOf(gesture);
    const to = endOf(gesture);
    const width = Math.abs(to.x - from.x);
    const height = Math.abs(to.y - from.y);
    if (width < MINIMUM_BOX || height < MINIMUM_BOX) return undefined;
    return { shape: 'rect', x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width, height };
  };

  const controller: ToolController = {
    ...pointerPath,
    commit: async (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): Promise<RenderableCommand | undefined> => {
      // THE SAME THRESHOLD AS THE PREVIEW, read from it rather than restated —
      // here it also decides whether a modal opens at all, so the two coming
      // apart would be a dialog appearing for a drag that showed no box.
      if (drawn(gesture) === undefined) return undefined;

      // THE RECTANGLE IS BUILT BEFORE THE ASK, from the transform the overlay
      // read at pointer-up. Building it after would convert a gesture using
      // whatever zoom the page is at when the person finishes typing.
      const rect = draggedRect(startOf(gesture), endOf(gesture), transform);

      const answered = FORM_FIELD_RESULT.safeParse(await deps.ask(shape.dialog, {}));
      // A DISMISSED DIALOG IS `undefined` AND SO IS A REFUSED ANSWER — the same
      // outcome a drag too small to see already produces. The gate is the
      // absence of a value rather than a flag.
      if (!answered.success) return undefined;

      const field = shape.build(answered.data);
      if (field === undefined) return undefined;

      return { kind: 'createFormField', page, rect, name: answered.data.name, field };
    },
    preview: drawn,
  };

  return { id: shape.id, controller };
}

/** The five, for the composition root. */
export function formFieldTools(deps: TextToolDeps): readonly UiTool[] {
  return SHAPES.map((shape) => fieldTool(shape, deps));
}
