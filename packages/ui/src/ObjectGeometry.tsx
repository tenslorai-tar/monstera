import { useLingui } from '@lingui/react';
import type { AnnotationRect } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, useId } from 'react';

import {
  PROPERTIES_OBJECT_BOTTOM,
  PROPERTIES_OBJECT_HEIGHT,
  PROPERTIES_OBJECT_LEFT,
  PROPERTIES_OBJECT_ROTATION,
  PROPERTIES_OBJECT_TEXT_FAMILY,
  PROPERTIES_OBJECT_TEXT_SIZE,
  PROPERTIES_OBJECT_TEXT_STYLE,
  PROPERTIES_OBJECT_WIDTH,
  TEXT_FAMILY_MONO,
  TEXT_FAMILY_SANS,
  TEXT_FAMILY_SERIF,
  TEXT_STYLE_BOLD,
  TEXT_STYLE_BOLD_ITALIC,
  TEXT_STYLE_ITALIC,
  TEXT_STYLE_REGULAR,
} from './messages/en.js';
import { type ObjectPick, type ObjectTextLook, turnable } from './objectEditing.js';

/** A number as a field shows it: to a hundredth, with no trailing zeros. */
function shown(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** One number a person may type over, sent when they leave it or press Enter, put back when they press Escape. */
function NumberRow({
  label,
  value,
  min,
  onCommit,
  name,
}: {
  readonly label: MessageKey;
  readonly value: number;
  readonly min?: number;
  readonly onCommit: (value: number) => void;
  readonly name: string;
}): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  const commit = (input: HTMLInputElement): void => {
    const typed = Number(input.value);
    // NOTHING SENT for what is no number, below the least, or what was already there: a field left as it was must not
    // bump the document's version.
    if (input.value.trim() === '' || !Number.isFinite(typed) || (min !== undefined && typed < min) || shown(typed) === shown(value)) {
      input.value = shown(value);
      return;
    }
    onCommit(typed);
  };
  return (
    <div className="m-properties__row m-properties__row--inline">
      <label className="m-properties__label" htmlFor={id}>
        {i18n._(label)}
      </label>
      <input
        className="m-properties__number"
        data-object-field={name}
        // KEYED BY THE VALUE BELOW, so a document that moved shows its new number rather than a stale draft.
        defaultValue={shown(value)}
        id={id}
        min={min}
        onBlur={(event) => {
          commit(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(event.currentTarget);
          if (event.key === 'Escape') event.currentTarget.value = shown(value);
        }}
        step={0.1}
        type="number"
      />
    </div>
  );
}

const STYLE_WORDS: Readonly<Record<'regular' | 'bold' | 'italic' | 'bold-italic', MessageKey>> = {
  regular: TEXT_STYLE_REGULAR,
  bold: TEXT_STYLE_BOLD,
  italic: TEXT_STYLE_ITALIC,
  'bold-italic': TEXT_STYLE_BOLD_ITALIC,
};

const FAMILY_WORDS: Readonly<Record<ObjectTextLook['family'], MessageKey>> = {
  serif: TEXT_FAMILY_SERIF,
  sans: TEXT_FAMILY_SANS,
  mono: TEXT_FAMILY_MONO,
};

/**
 * Where the selected object is and how big, in PDF points from the page's lower-left corner, and how far it is turned
 * (the owner's E6). Each number typed is a placement, the command a drag or the rotate handle sends, so the fields and
 * the handles cannot place an object two ways. A block of text also shows how it is set, read-only: its words are Edit
 * text's to change.
 */
export function ObjectGeometry({
  pick,
  onPlace,
  onTurn,
}: {
  readonly pick: ObjectPick;
  readonly onPlace: (target: AnnotationRect) => void;
  readonly onTurn: (degrees: number) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const { box, look } = pick.object;
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const turn = pick.object.turn ?? 0;
  // ONE KEY FOR THE ROWS, so every draft is dropped when the object or the document changes under them.
  const key = `${String(pick.version)}:${pick.object.source}:${String(pick.object.index)}`;
  return (
    <div className="m-properties__geometry" data-object-geometry="">
      <NumberRow key={`l${key}`} label={PROPERTIES_OBJECT_LEFT} name="left" onCommit={(left) => { onPlace({ ...box, x0: left, x1: left + width }); }} value={box.x0} />
      <NumberRow key={`b${key}`} label={PROPERTIES_OBJECT_BOTTOM} name="bottom" onCommit={(bottom) => { onPlace({ ...box, y0: bottom, y1: bottom + height }); }} value={box.y0} />
      <NumberRow key={`w${key}`} label={PROPERTIES_OBJECT_WIDTH} min={0.1} name="width" onCommit={(next) => { onPlace({ ...box, x1: box.x0 + next }); }} value={width} />
      <NumberRow key={`h${key}`} label={PROPERTIES_OBJECT_HEIGHT} min={0.1} name="height" onCommit={(next) => { onPlace({ ...box, y1: box.y0 + next }); }} value={height} />
      {turnable(pick.object) ? (
        <NumberRow
          key={`r${key}`}
          label={PROPERTIES_OBJECT_ROTATION}
          name="rotation"
          // THE TURN TYPED, less the one it has: the command turns BY an angle, the field says the angle it stands at.
          onCommit={(degrees) => {
            onTurn(((((degrees - turn + 180) % 360) + 360) % 360) - 180);
          }}
          value={turn}
        />
      ) : null}
      {look === undefined ? null : (
        <>
          <p className="m-properties__meta" data-object-text-size="">
            {i18n._(PROPERTIES_OBJECT_TEXT_SIZE)}: {shown(look.size)}
          </p>
          <p className="m-properties__meta" data-object-text-style="">
            {i18n._(PROPERTIES_OBJECT_TEXT_STYLE)}: {i18n._(STYLE_WORDS[look.bold ? (look.italic ? 'bold-italic' : 'bold') : look.italic ? 'italic' : 'regular'])}
          </p>
          <p className="m-properties__meta" data-object-text-family="">
            {i18n._(PROPERTIES_OBJECT_TEXT_FAMILY)}: {i18n._(FAMILY_WORDS[look.family])}
          </p>
        </>
      )}
    </div>
  );
}
