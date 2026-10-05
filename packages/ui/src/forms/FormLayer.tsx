import { useLingui } from '@lingui/react';
import type { FieldFill } from '@monstera/contract';
import { type CSSProperties, type ReactElement, useState } from 'react';

import { type OverlayPage, pdfRectOnScreen } from '../annotations/annotationSpace.js';
import { FORM_FIELD_FILL_IN } from '../messages/en.js';
import { ChoiceOptions, FieldTextBox } from './FieldControls.js';
import { type ListedField, fieldFill } from './fieldFill.js';

/** One field to fill, named as every fill names it: page, place in the page's widget walk, and the value. */
export interface PageFill {
  readonly page: number;
  readonly index: number;
  readonly value: FieldFill;
}

/**
 * How much of a one-line field's height its text takes. MuPDF's automatic size, measured 2026-10-05: 15 points in a
 * field 21 high (0.71), so the editor's words stand where the field's will.
 */
const LINE_FILL = 0.7;

/** The size a box for line breaks types at, in points before the zoom: MuPDF's default for a field with no size. */
const LINES_POINTS = 12;

/**
 * A page's form fields, filled where they are (ADR-0168).
 *
 * ## The document draws the field; this only takes the press
 *
 * At rest nothing here is drawn but an edge under the pointer or the focus: the field's value is the appearance
 * PDF.js drew from the document, which MuPDF regenerates when a fill lands (measured 2026-10-05). A tick box or a radio
 * is filled by the press. A text field opens its editor over the field at the press, on the paper and in the field's
 * own size, filled when it is left (or by Enter on one line), kept as it was by Escape, and measured against what it
 * showed so a press that edits nothing sends nothing. A dropdown or a list is a list of its options at the field.
 *
 * ## What may be filled is `fieldFill`'s
 *
 * The Forms panel renders from the same answer, so a read-only field, a signature, a push button, a value listed as a
 * slice and a choice holding several values are refused by both or neither. A field nobody can fill here has no
 * control on the page; the panel's row says why.
 *
 * ## Named, and in the walk's order
 *
 * Each control is named by the field's own name, the panel's accessible name, and they follow the page's widget walk,
 * so the keyboard reaches a form's fields in the order the document lists them.
 */
export function FormLayer({
  page,
  fields,
  geometry,
  onFill,
}: {
  readonly page: number;
  readonly fields: readonly ListedField[];
  readonly geometry: OverlayPage;
  readonly onFill: (fill: PageFill) => void;
}): ReactElement | null {
  const { i18n } = useLingui();
  // THE TEXT FIELD BEING TYPED IN, by its place in the walk. One at a time: leaving one fills it and closes it.
  const [typing, setTyping] = useState<number | undefined>(undefined);

  const placed = fields.flatMap((field) => {
    if (field.rect === null) return [];
    const offer = fieldFill(field);
    return offer.kind === 'none' ? [] : [{ field, offer, box: pdfRectOnScreen(field.rect, geometry) }];
  });
  // NOTHING OVER A PAGE WITH NOTHING TO FILL, `TextLayer`'s rule: an empty layer is something that can go wrong quietly.
  if (placed.length === 0) return null;

  return (
    <div className="m-form-layer" data-form-layer={String(page)}>
      {placed.map(({ field, offer, box }) => {
        const at: CSSProperties = {
          left: `${String(box.left)}px`,
          top: `${String(box.top)}px`,
          width: `${String(box.width)}px`,
          height: `${String(box.height)}px`,
        };
        const fill = (value: FieldFill): void => {
          onFill({ page, index: field.index, value });
        };
        // THE PLACE IN THE WALK IS THE KEY AND THE IDENTITY, the fill's own handle; and the mark a case finds it by.
        const marks = { 'data-form-field': String(field.index) };

        if (offer.kind === 'toggle') {
          return (
            <button
              {...marks}
              key={field.index}
              aria-checked={offer.on}
              aria-label={field.name}
              className="m-page-field"
              onClick={() => {
                // A RADIO'S CHOSEN OPTION CLEARS on a press, the panel's rule: a PDF group deselects when its lit
                // widget is toggled (measured), so an option that could not be cleared would hide a state it allows.
                fill({ set: 'button', on: !offer.on });
              }}
              role={offer.radio ? 'radio' : 'checkbox'}
              style={at}
              type="button"
            />
          );
        }

        if (offer.kind === 'choice') {
          return (
            <select
              {...marks}
              key={field.index}
              aria-label={field.name}
              className="m-page-field m-page-field--choice"
              onChange={(event) => {
                fill({ set: 'choice', option: event.currentTarget.value });
              }}
              style={at}
              value={offer.held}
            >
              <ChoiceOptions offer={offer} />
            </select>
          );
        }

        if (typing === field.index) {
          const size = offer.lines ? Math.min(box.height * LINE_FILL, LINES_POINTS * geometry.zoom) : box.height * LINE_FILL;
          return (
            <FieldTextBox
              key={field.index}
              marks={marks}
              autoFocus
              className="m-page-field-editor"
              name={field.name}
              offer={offer}
              onCancel={() => {
                setTyping(undefined);
              }}
              onCommit={(text) => {
                fill({ set: 'text', text });
              }}
              onDone={() => {
                setTyping(undefined);
              }}
              style={{ ...at, fontSize: `${String(size)}px` }}
            />
          );
        }

        return (
          <button
            {...marks}
            key={field.index}
            aria-label={i18n._(FORM_FIELD_FILL_IN, { name: field.name })}
            className="m-page-field m-page-field--text"
            onClick={() => {
              setTyping(field.index);
            }}
            style={at}
            type="button"
          />
        );
      })}
    </div>
  );
}
