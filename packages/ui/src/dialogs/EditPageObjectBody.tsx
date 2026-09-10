import { useLingui } from '@lingui/react';
import { MAX_OBJECT_SCALE, MIN_OBJECT_SCALE } from '@monstera/contract';
import { type ReactElement, useState } from 'react';

import {
  EDIT_PAGE_OBJECT_COLOUR,
  EDIT_PAGE_OBJECT_DELETE,
  EDIT_PAGE_OBJECT_EXPLAINS,
  EDIT_PAGE_OBJECT_MOVE_X,
  EDIT_PAGE_OBJECT_MOVE_Y,
  EDIT_PAGE_OBJECT_NONE,
  EDIT_PAGE_OBJECT_NO_FILL,
  EDIT_PAGE_OBJECT_PLACE,
  EDIT_PAGE_OBJECT_RECOLOR,
  EDIT_PAGE_OBJECT_SCALE_X,
  EDIT_PAGE_OBJECT_SCALE_Y,
  EDIT_PAGE_OBJECT_TRUNCATED,
  EDIT_PAGE_OBJECT_WHICH,
  OBJECT_KIND_FORM,
  OBJECT_KIND_IMAGE,
  OBJECT_KIND_PATH,
  OBJECT_KIND_SHADING,
  OBJECT_KIND_TEXT,
  OBJECT_KIND_UNKNOWN,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { EditPageObjectAnswer } from './editPageObjectResult.js';

/** One object as the dialog is handed it. */
interface OfferedObject {
  readonly index: number;
  readonly kind: 'unknown' | 'text' | 'path' | 'image' | 'shading' | 'form';
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
  readonly fill: {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
    readonly alpha: number;
  } | null;
}

/**
 * A message key per kind, so no kind reaches a person as PDFium's word either.
 *
 * The channel already turned `FPDFPageObj_GetType`'s 0–5 into `'path'`, which is
 * what a **program** needs. A person reading a list of rows needs *Shape*, and
 * needs it in their own language — so the second translation is this map and
 * not a `kind[0].toUpperCase()`, which would ship English into every locale.
 */
const KIND_LABELS = {
  unknown: OBJECT_KIND_UNKNOWN,
  text: OBJECT_KIND_TEXT,
  path: OBJECT_KIND_PATH,
  image: OBJECT_KIND_IMAGE,
  shading: OBJECT_KIND_SHADING,
  form: OBJECT_KIND_FORM,
} as const;

/** A colour input's `#rrggbb`, from the channel's three channels. */
function toHex(fill: NonNullable<OfferedObject['fill']>): string {
  const pair = (value: number): string => value.toString(16).padStart(2, '0');
  return `#${pair(fill.red)}${pair(fill.green)}${pair(fill.blue)}`;
}

/**
 * What the colour input shows when there is nothing to show.
 *
 * A colour input cannot express *no colour*, so one is needed — and it is
 * COMPUTED rather than written as `#000000`. `monstera/no-raw-hex` refuses a hex
 * literal in a component and is right to: §10.2 makes components consume tokens.
 * This is neither a token nor a design decision, it is the shape an `<input
 * type="color">` insists on for a control that cannot be operated, and
 * `hexFromColour` carries the same note for the same reason one module along.
 *
 * The input is disabled whenever this is what it holds, which is the honest
 * arrangement `StylePanel` reaches for too: a control that cannot say *none*
 * must not be operable while none is the answer.
 */
const NO_COLOUR = toHex({ red: 0, green: 0, blue: 0, alpha: 255 });

/** The three channels, from a colour input's `#rrggbb`. */
function fromHex(hex: string): { red: number; green: number; blue: number } {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * Reads a number a person typed, or `null` where they typed something else.
 *
 * `null` rather than `0` or `NaN`, and the difference is what the buttons are
 * disabled on: a field holding `abc` must not dispatch a move of zero, which is
 * a command that regenerates a page for no change.
 */
function numberFrom(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Picking one of the page's objects and moving, resizing, recolouring or
 * removing it.
 *
 * ## THREE ACTIONS, ONE CHOICE OF OBJECT
 *
 * All three commands need the same question answered first — *which object?* —
 * so asking it once and offering three verbs is the arrangement that does not
 * make a person pick the same thing three times. The answer is a discriminated
 * union, so what leaves here is exactly one intent.
 *
 * ## NOTHING IS PRESELECTED
 *
 * `ReplaceTextObjectBody`'s rule and its reason: every option is equally likely
 * and two of the three actions are destructive, so an apply that landed on
 * whichever object happened to be first would be one keystroke from changing
 * something the reader never looked at.
 *
 * ## Only the PLACEMENT is the primary button
 *
 * `Button` offers `primary` and `default`, so *less prominent* is the default
 * and the two that are not primary are the recolour and the removal. The
 * removal is the one that earns it: it is the only action here with no inverse —
 * PDFium cannot rebuild a removed object, so undo restores a checkpoint rather
 * than putting it back — and the filled treatment would make the costliest
 * mistake the easiest button to reach for.
 *
 * ## Recolour is disabled where PDFium would not describe the fill
 *
 * A `null` fill is *this engine will not say*, not black. Starting a colour
 * picker at a guess would offer a person a change to something nobody has been
 * told anything about — and the recolour would then set a colour where the
 * capture found none, which is an edit whose undo has no prior.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function EditPageObjectBody({
  objects,
  truncated,
  resolve,
}: {
  readonly objects: readonly OfferedObject[];
  readonly truncated: boolean;
} & DialogAnswering<EditPageObjectAnswer>): ReactElement {
  const { _ } = useLingui();
  const [chosen, setChosen] = useState<number | null>(null);
  const [moveX, setMoveX] = useState('0');
  const [moveY, setMoveY] = useState('0');
  const [scaleX, setScaleX] = useState('1');
  const [scaleY, setScaleY] = useState('1');
  const [colour, setColour] = useState(NO_COLOUR);

  const object = chosen === null ? undefined : objects.find((each) => each.index === chosen);
  const move = { x: numberFrom(moveX), y: numberFrom(moveY) };
  const scale = { x: numberFrom(scaleX), y: numberFrom(scaleY) };
  const scaleInRange = (value: number | null): boolean =>
    value !== null && value >= MIN_OBJECT_SCALE && value <= MAX_OBJECT_SCALE;
  // A PLACEMENT THAT CHANGES NOTHING IS NOT DISPATCHED: no move and a scale of
  // one regenerates the page's content stream for no change, which is the whole
  // cost of an edit paid for nothing.
  const placeable =
    object !== undefined &&
    move.x !== null &&
    move.y !== null &&
    scaleInRange(scale.x) &&
    scaleInRange(scale.y) &&
    !(move.x === 0 && move.y === 0 && scale.x === 1 && scale.y === 1);

  return (
    <div className="m-edit-page-object">
      <p className="m-edit-page-object__explains">{_(EDIT_PAGE_OBJECT_EXPLAINS)}</p>
      {truncated ? (
        <p className="m-edit-page-object__truncated" role="status">
          {_(EDIT_PAGE_OBJECT_TRUNCATED)}
        </p>
      ) : null}
      {objects.length === 0 ? (
        <p className="m-edit-page-object__none">{_(EDIT_PAGE_OBJECT_NONE)}</p>
      ) : (
        <>
          <fieldset className="m-edit-page-object__choice">
            <legend className="m-edit-page-object__legend">{_(EDIT_PAGE_OBJECT_WHICH)}</legend>
            {objects.map((offered) => (
              <label className="m-edit-page-object__option" key={offered.index}>
                <input
                  checked={chosen === offered.index}
                  name="m-edit-page-object"
                  onChange={() => {
                    setChosen(offered.index);
                    // THE PICKER STARTS AT THE OBJECT'S OWN COLOUR, so the
                    // default action is *leave it as it is*. An input that stayed
                    // black would make opening the picker and closing it a
                    // recolour to black on anything that was not.
                    setColour(offered.fill === null ? NO_COLOUR : toHex(offered.fill));
                  }}
                  type="radio"
                />
                <span className="m-edit-page-object__kind">{_(KIND_LABELS[offered.kind])}</span>
                {/* THE BOX, ROUNDED TO WHOLE POINTS. A person matches this
                    against what they can see on the page, and a tenth of a
                    point is below what anybody can compare by eye — the extra
                    digits would make two rows look different when they are not. */}
                <span className="m-edit-page-object__box">
                  {Math.round(offered.left)}, {Math.round(offered.bottom)} –{' '}
                  {Math.round(offered.right)}, {Math.round(offered.top)}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="m-edit-page-object__numbers">
            <Input label={EDIT_PAGE_OBJECT_MOVE_X} onValueChange={setMoveX} value={moveX} />
            <Input label={EDIT_PAGE_OBJECT_MOVE_Y} onValueChange={setMoveY} value={moveY} />
            <Input label={EDIT_PAGE_OBJECT_SCALE_X} onValueChange={setScaleX} value={scaleX} />
            <Input label={EDIT_PAGE_OBJECT_SCALE_Y} onValueChange={setScaleY} value={scaleY} />
          </div>
          <Button
            disabled={!placeable}
            label={EDIT_PAGE_OBJECT_PLACE}
            onClick={() => {
              // GUARDED AGAIN rather than trusting the disabled attribute, for
              // `FlatFieldsBody`'s reason: the result schema refuses a scale
              // outside its bounds, and a resolve that reached it would surface
              // as an internal error over a button the reader could press.
              if (
                object === undefined ||
                move.x === null ||
                move.y === null ||
                scale.x === null ||
                scale.y === null ||
                !placeable
              ) {
                return;
              }
              resolve({
                action: 'place',
                index: object.index,
                moveBy: { x: move.x, y: move.y },
                scaleBy: { x: scale.x, y: scale.y },
              });
            }}
            variant="primary"
          />

          <label className="m-edit-page-object__colour">
            {_(EDIT_PAGE_OBJECT_COLOUR)}
            <input
              disabled={object?.fill == null}
              onChange={(event) => {
                setColour(event.target.value);
              }}
              type="color"
              value={colour}
            />
          </label>
          {object?.fill === null ? (
            <p className="m-edit-page-object__no-fill" role="status">
              {_(EDIT_PAGE_OBJECT_NO_FILL)}
            </p>
          ) : null}
          <Button
            disabled={object?.fill == null}
            label={EDIT_PAGE_OBJECT_RECOLOR}
            onClick={() => {
              if (object?.fill == null) return;
              resolve({
                action: 'recolor',
                index: object.index,
                // THE ALPHA IS THE OBJECT'S OWN, not 255. A colour input has no
                // opacity, so taking one would mean this control silently made
                // every translucent object opaque — a second change nobody asked
                // for, riding on the one they did.
                colour: { ...fromHex(colour), alpha: object.fill.alpha },
              });
            }}
          />

          {/* NO `variant`, so the default bounded button rather than the filled
              one. `Button` offers `primary` and `default` and nothing between —
              so *less prominent than the placement* is the default, which is
              what this needs: removal is the only action here with no inverse,
              and the filled treatment would make the costliest mistake the
              easiest button to reach for. */}
          <Button
            disabled={object === undefined}
            label={EDIT_PAGE_OBJECT_DELETE}
            onClick={() => {
              if (object === undefined) return;
              resolve({ action: 'delete', index: object.index });
            }}
          />
        </>
      )}
    </div>
  );
}
