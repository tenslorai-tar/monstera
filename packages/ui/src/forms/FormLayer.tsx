import { useLingui } from '@lingui/react';
import type { FieldFill } from '@monstera/contract';
import { type CSSProperties, type MouseEvent, type ReactElement, useEffect, useRef, useState } from 'react';

import { type OverlayPage, pdfRectOnScreen } from '../annotations/annotationSpace.js';
import { FORM_FIELD_FILL_IN } from '../messages/en.js';
import { ChoiceOptions, FieldTextBox } from './FieldControls.js';
import { type ListedField, fieldFill } from './fieldFill.js';
import { type SelectMode, modeOf } from './fieldSelection.js';

/** No place on the page is selected. */
const NO_SELECTION: ReadonlySet<number> = new Set();

/** Whether a press carries a modifier that extends a selection rather than acts on the field. */
function modified(event: MouseEvent): boolean {
  return modeOf(event) !== 'replace';
}

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
  selected = NO_SELECTION,
  reveal,
  onSelect,
}: {
  readonly page: number;
  readonly fields: readonly ListedField[];
  readonly geometry: OverlayPage;
  readonly onFill: (fill: PageFill) => void;
  /** The places in this page's walk that are selected, drawn as an outline over each, fillable or not. */
  readonly selected?: ReadonlySet<number>;
  /** A request to bring one selected field into view, stamped so asking twice scrolls twice. */
  readonly reveal?: { readonly index: number; readonly stamp: number } | undefined;
  /** A press on a field's control selects it, the way a click on its row in the Fields list does. */
  readonly onSelect?: ((index: number, mode: SelectMode) => void) | undefined;
}): ReactElement | null {
  const { i18n } = useLingui();
  // THE TEXT FIELD BEING TYPED IN, by its place in the walk. One at a time: leaving one fills it and closes it.
  const [typing, setTyping] = useState<number | undefined>(undefined);
  const root = useRef<HTMLDivElement | null>(null);

  // BROUGHT INTO VIEW WHEN ASKED, once the outline is drawn: the Fields list names a field on a page that may be off
  // the screen, and a highlight nobody can see is no highlight.
  const stamp = reveal?.stamp;
  const wanted = reveal?.index;
  useEffect(() => {
    if (wanted === undefined) return;
    const outline = root.current?.querySelector<HTMLElement>(`[data-form-selected="${String(wanted)}"]`);
    if (outline !== null && outline !== undefined && typeof outline.scrollIntoView === 'function') {
      outline.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }, [stamp, wanted]);

  const placed = fields.flatMap((field) => {
    if (field.rect === null) return [];
    const offer = fieldFill(field);
    return offer.kind === 'none' ? [] : [{ field, offer, box: pdfRectOnScreen(field.rect, geometry) }];
  });
  // THE OUTLINES, for every selected field with a place on this page: a field nobody can fill here is still one a person
  // selected in the list, and is still the one the page must show.
  const outlined = fields.flatMap((field) =>
    field.rect !== null && selected.has(field.index) ? [{ field, box: pdfRectOnScreen(field.rect, geometry) }] : [],
  );
  // NOTHING OVER A PAGE WITH NOTHING TO FILL, `TextLayer`'s rule: an empty layer is something that can go wrong quietly.
  if (placed.length === 0 && outlined.length === 0) return null;

  return (
    <div className="m-form-layer" data-form-layer={String(page)} ref={root}>
      {outlined.map(({ field, box }) => (
        <div
          aria-hidden="true"
          className="m-page-field-selected"
          data-form-selected={String(field.index)}
          key={`selected-${String(field.index)}`}
          style={{
            left: `${String(box.left)}px`,
            top: `${String(box.top)}px`,
            width: `${String(box.width)}px`,
            height: `${String(box.height)}px`,
          }}
        />
      ))}
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
              onClick={(event) => {
                // CTRL AND SHIFT EXTEND THE SELECTION and fill nothing, as they do in the list.
                if (modified(event)) return;
                // A RADIO'S CHOSEN OPTION CLEARS on a press, the panel's rule: a PDF group deselects when its lit
                // widget is toggled (measured), so an option that could not be cleared would hide a state it allows.
                fill({ set: 'button', on: !offer.on });
              }}
              onPointerDown={(event) => {
                onSelect?.(field.index, modeOf(event));
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
              onPointerDown={(event) => {
                onSelect?.(field.index, modeOf(event));
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
            onClick={(event) => {
              if (modified(event)) return;
              setTyping(field.index);
            }}
            onPointerDown={(event) => {
              onSelect?.(field.index, modeOf(event));
            }}
            style={at}
            type="button"
          />
        );
      })}
    </div>
  );
}
