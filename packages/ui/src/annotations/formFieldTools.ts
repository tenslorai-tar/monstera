import type { CreatedField, DispatchableCommand } from '@monstera/contract';
import type { PageTransform, ViewportPoint } from '@monstera/shared';
import { nextFieldName, viewportPoint } from '@monstera/shared';

import { localDatePattern } from '../forms/datePattern.js';
import { HINT_FORM_FIELD } from '../messages/en.js';
import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';
import { draggedRect } from './annotationSpace.js';
import type { TextToolDeps } from './textTools.js';

/**
 * The create-field tools: a CLICK puts a field of the kind's own size where it lands, and a DRAG puts one the size of
 * the box (ADR-0226 Decisions 11 to 13, the owner's K1 and K6).
 *
 * ## Nothing is asked
 *
 * A new field is named the way the forms people already know name them — `Text1`, `Check Box1`, `Group1` — and a person
 * renames it in Properties. It was asked for a name in a line on the page and, for a choice, in a dialog, until
 * 2026-10-10: the owner placed fields faster than any of that let them, and what a dialog asked first is what
 * Properties asks anyway. A choice field starts with three choices a person edits there.
 *
 * ## A radio group is ONE RUN of the tool
 *
 * The first press starts `GroupN` with `Choice1`; every press after it joins the same group with the next free choice,
 * until the tool ends (Escape or another tool). That is K6, and it is what a group is on paper: a row of circles, one of
 * which is on.
 *
 * ## The gesture is a rectangle and the payload is a rectangle, with nothing between
 *
 * Measured 2026-09-08: pdf-lib writes `/Rect` in raw PDF user space verbatim, so `draggedRect`'s output reaches the
 * document unchanged. A click's box is built ON SCREEN — the click and the corner its size in points away, at this zoom —
 * and converted the same way, so it opens down and to the right on a turned page as on an upright one; a box built in
 * user space would open in whichever direction the page's `/Rotate` points, which is document state this surface does
 * not hold.
 */

/**
 * How far the pointer must travel before a gesture is a drag rather than a click. In CSS pixels, because it is about the
 * hand: a press that wobbles three pixels is a click, and a click places the kind's own size.
 */
const MINIMUM_DRAG = 4;

/** What each tool builds, keyed by nothing — read at construction. */
interface FieldToolShape {
  readonly id: string;
  /** The word a new field's name starts with, before its number (K1). */
  readonly word: string;
  /** The size a click places, in points (ADR-0226 Decision 9). */
  readonly size: { readonly width: number; readonly height: number };
  /**
   * The smallest a drag may make it, in points: a drag at a high zoom can be a few points across, and a field that small
   * is a control nobody can click and nothing on the page finds again. Smaller than {@link size}, so a drag can still
   * make a field smaller than a click does.
   */
  readonly least: { readonly width: number; readonly height: number };
  /** The payload's discriminated member. A radio's is built by its run, so it has none here. */
  readonly build?: (deps: TextToolDeps) => CreatedField;
}

/** The id of the tool that places a text field. */
export const FORM_FIELD_TEXT_TOOL_ID = 'forms.field-text';
/** The id of the tool that places a tick box. */
export const FORM_FIELD_CHECKBOX_TOOL_ID = 'forms.field-checkbox';
/** The id of the tool that places the options of a radio group. */
export const FORM_FIELD_RADIO_TOOL_ID = 'forms.field-radio';
/** The id of the tool that places a dropdown. */
export const FORM_FIELD_DROPDOWN_TOOL_ID = 'forms.field-dropdown';
/** The id of the tool that places a list box. */
export const FORM_FIELD_LISTBOX_TOOL_ID = 'forms.field-listbox';
/** The id of the tool that places a push button. */
export const FORM_FIELD_BUTTON_TOOL_ID = 'forms.field-button';
/** The id of the tool that places a signature field. */
export const FORM_FIELD_SIGNATURE_TOOL_ID = 'forms.field-signature';
/** The id of the tool that places a date field. */
export const FORM_FIELD_DATE_TOOL_ID = 'forms.field-date';

/** The smallest a field holding one line of words is made by a drag: room for a few characters at a readable size. */
const LINE = { width: 24, height: 12 };
/** The smallest a tick box or a radio is made by a drag: a mark a pointer can still find. */
const MARK = { width: 8, height: 8 };

/** The choices a new dropdown or list box starts with, edited in Properties. */
const STARTING_CHOICES = ['Choice1', 'Choice2', 'Choice3'];

const SHAPES: readonly FieldToolShape[] = [
  {
    id: FORM_FIELD_TEXT_TOOL_ID,
    word: 'Text',
    size: { width: 180, height: 20 },
    least: LINE,
    build: () => ({ type: 'text' }),
  },
  {
    id: FORM_FIELD_CHECKBOX_TOOL_ID,
    word: 'Check Box',
    size: { width: 12, height: 12 },
    least: MARK,
    build: () => ({ type: 'checkbox' }),
  },
  { id: FORM_FIELD_RADIO_TOOL_ID, word: 'Group', size: { width: 12, height: 12 }, least: MARK },
  {
    id: FORM_FIELD_DROPDOWN_TOOL_ID,
    word: 'Dropdown',
    size: { width: 150, height: 20 },
    least: LINE,
    build: () => ({ type: 'dropdown', options: STARTING_CHOICES }),
  },
  {
    id: FORM_FIELD_LISTBOX_TOOL_ID,
    word: 'List',
    size: { width: 150, height: 60 },
    least: { width: 24, height: 24 },
    build: () => ({ type: 'listbox', options: STARTING_CHOICES }),
  },
  {
    id: FORM_FIELD_BUTTON_TOOL_ID,
    word: 'Button',
    size: { width: 80, height: 24 },
    least: LINE,
    // THE WORDS ON A NEW BUTTON ARE THE DOCUMENT'S, like its name, so they are the kind's word and not a message in the
    // application's language: a form made here and sent abroad would otherwise carry the maker's interface language.
    build: () => ({ type: 'button', label: 'Button' }),
  },
  {
    id: FORM_FIELD_SIGNATURE_TOOL_ID,
    word: 'Signature',
    size: { width: 180, height: 40 },
    least: { width: 48, height: 16 },
    build: () => ({ type: 'signature' }),
  },
  {
    id: FORM_FIELD_DATE_TOOL_ID,
    word: 'Date',
    size: { width: 100, height: 20 },
    least: LINE,
    // THE COMPUTER'S DATE ORDER, as the tool's tooltip says, and never the application language's (the owner's F10).
    build: (deps) => ({ type: 'date', pattern: localDatePattern(deps.dateLocale) }),
  },
];

/** Whether a tool id is one of those that place a form field. */
export function isFormFieldTool(id: string): boolean {
  return SHAPES.some((shape) => shape.id === id);
}

/**
 * THE RADIO GROUP A RUN OF PRESSES IS BUILDING, remembered until the tool ends (the owner, 2026-10-07, and K6). NOT in
 * the tool's closure, because the registry is rebuilt whenever one of its inputs moves (`App.tsx`) and a group held in
 * a tool would be lost to a rebuild in the middle of a run; keyed by the application's `ask`, which is stable across a
 * rebuild, so a run belongs to the application that is placing it and not to a module every test would share. `ended`
 * is what clears it.
 */
interface RadioRun {
  group: string | undefined;
  used: readonly string[];
}
const RADIO_RUNS = new WeakMap<TextToolDeps['ask'], RadioRun>();

function radioRunOf(deps: TextToolDeps): RadioRun {
  const held = RADIO_RUNS.get(deps.ask);
  if (held !== undefined) return held;
  const fresh: RadioRun = { group: undefined, used: [] };
  RADIO_RUNS.set(deps.ask, fresh);
  return fresh;
}

/** Whether a gesture moved far enough in both directions to be a drag. */
function dragged(gesture: Gesture): boolean {
  const from = startOf(gesture);
  const to = endOf(gesture);
  return Math.abs(to.x - from.x) >= MINIMUM_DRAG && Math.abs(to.y - from.y) >= MINIMUM_DRAG;
}

/**
 * The box a gesture places, on screen: the dragged box grown to the smallest side, or the kind's own size opening down
 * and to the right of a click and moved back inside the page where it would run off it.
 */
function placedBox(gesture: Gesture, shape: FieldToolShape, transform: PageTransform): { from: ViewportPoint; to: ViewportPoint } {
  const from = startOf(gesture);
  if (dragged(gesture)) {
    const to = endOf(gesture);
    const x = Math.min(from.x, to.x);
    const y = Math.min(from.y, to.y);
    const width = Math.max(Math.abs(to.x - from.x), shape.least.width * transform.scale);
    const height = Math.max(Math.abs(to.y - from.y), shape.least.height * transform.scale);
    return { from: viewportPoint(x, y), to: viewportPoint(x + width, y + height) };
  }
  const width = shape.size.width * transform.scale;
  const height = shape.size.height * transform.scale;
  const x = Math.max(0, Math.min(from.x, transform.viewport.width - width));
  const y = Math.max(0, Math.min(from.y, transform.viewport.height - height));
  return { from: viewportPoint(x, y), to: viewportPoint(x + width, y + height) };
}

function fieldTool(shape: FieldToolShape, deps: TextToolDeps): UiTool {
  const run = radioRunOf(deps);
  // THE PREVIEW IS THE DRAG ONLY: a click's box appears as the field itself a moment later, and a preview drawn for a
  // press that has not moved would flash the kind's box under every pointer that goes down.
  const drawn = (gesture: Gesture): ToolPreview | undefined => {
    if (!dragged(gesture)) return undefined;
    const from = startOf(gesture);
    const to = endOf(gesture);
    return {
      shape: 'rect',
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
    };
  };

  const controller: ToolController = {
    ...pointerPath,
    commit: async (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): Promise<DispatchableCommand | undefined> => {
      // THE RECTANGLE IS BUILT BEFORE THE READ, from the transform the overlay read at pointer-up: the read is a round
      // trip, and the page may be at another zoom when it answers.
      const box = placedBox(gesture, shape, transform);
      const rect = draggedRect(box.from, box.to, transform);

      // THE FIELDS THE DOCUMENT HAS, read now and not when the tool was chosen: a field placed a moment ago is in it.
      // A form that cannot be read names from an empty one, and the writer's own refusal (`fieldNameClash`) still
      // stands behind the name.
      const known = (await deps.fields?.()) ?? [];
      const names = known.map((field) => field.name);

      let name: string;
      let field: CreatedField;
      if (shape.build === undefined) {
        // K6: THE FIRST PRESS STARTS A GROUP, every later one joins it with the next choice its group does not hold.
        const group = run.group ?? nextFieldName(names, shape.word);
        const held = [
          ...known.filter((entry) => entry.kind === 'radio' && entry.name === group).flatMap((entry) => entry.options),
          ...(run.group === undefined ? [] : run.used),
        ];
        let number = 1;
        while (held.includes(`Choice${String(number)}`)) number += 1;
        const option = `Choice${String(number)}`;
        run.used = [...(run.group === undefined ? [] : run.used), option];
        run.group = group;
        name = group;
        field = { type: 'radio', option };
      } else {
        name = nextFieldName(names, shape.word);
        field = shape.build(deps);
      }

      // ONE FIELD IN A LIST, because a press is one field and the payload became plural for a different caller —
      // flat-field detection, where accepting a page of candidates is one decision.
      return { kind: 'createFormField', page, fields: [{ rect, name, field }] };
    },
    preview: drawn,
  };

  // A RADIO GROUP IS SEVERAL PRESSES of one tool, so it ends on Escape alone; every other field is one press.
  return {
    id: shape.id,
    controller,
    hint: HINT_FORM_FIELD,
    ...(shape.id === FORM_FIELD_RADIO_TOOL_ID
      ? {
          // THE GROUP IS FORGOTTEN WITH THE TOOL: the next time the radio tool is chosen it starts a group of its own.
          ended: (): void => {
            run.group = undefined;
            run.used = [];
          },
        }
      : { endsAfterOne: true as const }),
  };
}

/** The field tools, for the composition root. */
export function formFieldTools(deps: TextToolDeps): readonly UiTool[] {
  return SHAPES.map((shape) => fieldTool(shape, deps));
}
