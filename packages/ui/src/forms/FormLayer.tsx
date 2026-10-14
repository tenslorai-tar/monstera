import { useLingui } from '@lingui/react';
import type { AnnotationRect, FieldFill, FieldLook } from '@monstera/contract';
import { type CSSProperties, type ReactElement, useEffect, useId, useRef, useState } from 'react';

import { type OverlayPage, pdfRectOnScreen } from '../annotations/annotationSpace.js';
import {
  FORM_BUTTON_NO_SCRIPTS,
  FORM_FIELD_FILL_IN,
  FORM_FIELD_PRESS,
  FORM_FIELD_SIGN,
  FORM_SIGN_CERTIFICATE,
  FORM_SIGN_MARK,
  FORM_SIGN_OFFER,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Problem } from '../primitives/Problem.js';
import { FieldTextBox } from './FieldControls.js';
import { PageChoiceList, PageDropdown } from './PageChoice.js';
import { type FieldProblem, leftFieldProblem, storedText } from './fieldCheck.js';
import { fieldPressArea } from './fieldHoles.js';
import { type FillOffer, type ListedField, fieldFill } from './fieldFill.js';

/** No place on the page is selected. */
const NO_SELECTION: ReadonlySet<number> = new Set();

/** The text field being typed in: its place in the walk, and where the press that opened it landed, if a press did. */
interface Typing {
  readonly index: number;
  readonly pressedAt: { readonly x: number; readonly y: number } | undefined;
}

/**
 * One field to fill, named as every fill names it: page, place in the page's widget walk, and the value. Or a Reset form
 * button pressed, named the same way (the owner's F7): it travels the fill's path to the one place a command is sent,
 * which sends `resetForm` for it.
 */
export type PageFill =
  | { readonly page: number; readonly index: number; readonly value: FieldFill }
  | { readonly page: number; readonly index: number; readonly reset: true }
  /**
   * An empty signature field to sign (the owner's F8), with the application's own signing: a typed, drawn or picture
   * mark, or a certificate. It carries the field's place on the page and its full name, which is where the signature
   * goes and which field it fills.
   */
  | {
      readonly page: number;
      readonly index: number;
      readonly sign: 'mark' | 'certificate';
      readonly rect: AnnotationRect;
      readonly name: string;
    };

/**
 * How much of a one-line field's height its text takes. MuPDF's automatic size, measured 2026-10-05: 15 points in a
 * field 21 high (0.71), so the editor's words stand where the field's will.
 */
const LINE_FILL = 0.7;

/** The size a box for line breaks types at, in points before the zoom: MuPDF's default for a field with no size. */
const LINES_POINTS = 12;

/** How wide a monospaced character is, as a fraction of its size: Courier's 600 units of 1000. */
const MONO_ADVANCE = 0.6;

/**
 * A comb field's cells (ADR-0226 Decision 4): one character to a cell, `maxLength` cells across the field, as a reader
 * draws it. The box types in a monospaced face, so every character is one advance wide, and the spacing after each is
 * what is left of its cell; the first is set in half a gap, so each character stands in the middle of its cell.
 */
function combCells(offer: Extract<FillOffer, { kind: 'text' }>, width: number, size: number): CSSProperties {
  if (!offer.comb || offer.maxLength === null) return {};
  const cell = width / offer.maxLength;
  const gap = Math.max(0, cell - size * MONO_ADVANCE);
  return { letterSpacing: `${String(gap)}px`, paddingLeft: `${String(gap / 2)}px`, paddingRight: 0 };
}

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
  comments,
  focus,
  onFocused,
  onTab,
  highlight = true,
}: {
  readonly page: number;
  readonly fields: readonly ListedField[];
  readonly geometry: OverlayPage;
  readonly onFill: (fill: PageFill) => void;
  /** The places in this page's walk that are selected, drawn as an outline over each, fillable or not. */
  readonly selected?: ReadonlySet<number>;
  /** A request to bring one selected field into view, stamped so asking twice scrolls twice. */
  readonly reveal?: { readonly index: number; readonly stamp: number } | undefined;
  /**
   * The comments on this page while a tool that picks is on (ADR-0226 Decision 1): the layer is then above that tool's
   * surface, and a press on a comment over a field is the tool's, so each comment is taken out of the field's press
   * area. Absent while no tool is on, when the layer is under every surface and nothing is taken out.
   */
  readonly comments?: readonly { readonly rect: ListedField['rect'] }[] | undefined;
  /** A field to take the focus, stamped so asking twice focuses twice: where Tab from another field sent it. */
  readonly focus?: { readonly index: number; readonly stamp: number; readonly say?: FieldProblem | undefined } | undefined;
  /** Told once a focus request has been taken, so it is not taken again by a layer drawn later. */
  readonly onFocused?: ((stamp: number) => void) | undefined;
  /** Tab or Shift+Tab in a field, which has been left and filled: the form's order decides where the focus goes next. */
  readonly onTab?: ((index: number, backwards: boolean, filled: boolean) => void) | undefined;
  /**
   * Fields drawn with a light tint and required ones outlined in red, as PDF-XChange shows a form (`forms.highlight`,
   * on by default). Off, a field shows only the document's own appearance until the pointer is over it.
   */
  readonly highlight?: boolean;
}): ReactElement | null {
  const { i18n } = useLingui();
  // THE TEXT FIELD BEING TYPED IN, by its place in the walk. One at a time: leaving one fills it and closes it.
  const [typing, setTyping] = useState<Typing | undefined>(undefined);
  const root = useRef<HTMLDivElement | null>(null);
  // WHAT THE PERSON IS TOLD ABOUT ONE FIELD, beside it (ADR-0226): a value its format does not read, a required field
  // left empty, a button that does nothing here. One at a time; a press on another field puts it away.
  const [problem, setProblem] = useState<{ readonly index: number; readonly said: FieldProblem } | undefined>(undefined);
  // THE SIGNATURE FIELD WHOSE OFFER IS OPEN (the owner's F8), by its place in the walk; one at a time. Its first choice
  // takes the focus when it opens, so the keyboard is where the offer is.
  const [offering, setOffering] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (offering !== undefined) root.current?.querySelector<HTMLElement>('.m-page-sign-offer button')?.focus();
  }, [offering]);
  const idBase = useId();
  const controlId = (index: number): string => `${idBase}-field-${String(index)}`;
  // A FIELD THE FORM'S ORDER SENT THE FOCUS TO (Tab from another field, perhaps on another page), taken once per stamp
  // while rendering, React's form for state that follows a prop: a text field opens with its words selected, as a
  // tabbed-into box is.
  const [focusTaken, setFocusTaken] = useState<number | undefined>(undefined);
  const wantsFocus = focus !== undefined && focus.stamp !== focusTaken ? focus : undefined;
  const target = wantsFocus === undefined ? undefined : fields.find((field) => field.index === wantsFocus.index);
  if (wantsFocus !== undefined && target !== undefined) {
    setFocusTaken(wantsFocus.stamp);
    if (fieldFill(target).kind === 'text') setTyping({ index: target.index, pressedAt: undefined });
    // A SENTENCE THE REQUEST CARRIES is shown beside the field it focuses: a required field left empty at a save.
    if (wantsFocus.say !== undefined) setProblem({ index: target.index, said: wantsFocus.say });
  }
  // ANY OTHER KIND IS FOCUSED WHERE IT IS once it is drawn, and told back so the request is spent.
  useEffect(() => {
    if (focus === undefined || !fields.some((field) => field.index === focus.index)) return;
    const control = root.current?.querySelector<HTMLElement>(`[data-form-field="${String(focus.index)}"]`);
    if (control !== null && control !== undefined && document.activeElement !== control) {
      control.focus();
      if (typeof control.scrollIntoView === 'function') control.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    onFocused?.(focus.stamp);
  }, [fields, focus, onFocused]);

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

  const covering = (comments ?? []).flatMap((comment) => (comment.rect === null ? [] : [pdfRectOnScreen(comment.rect, geometry)]));
  const placed = fields.flatMap((field) => {
    if (field.rect === null) return [];
    const offer = fieldFill(field);
    if (offer.kind === 'none') return [];
    const box = pdfRectOnScreen(field.rect, geometry);
    const area = fieldPressArea(box, covering);
    // A FIELD A COMMENT COVERS WHOLE takes no press: every point of it is the comment's.
    return area === 'none' ? [] : [{ field, offer, box, clip: area === 'whole' ? undefined : area.clipPath }];
  });
  // THE OUTLINES, for every selected field with a place on this page: a field nobody can fill here is still one a person
  // selected in the list, and is still the one the page must show.
  const outlined = fields.flatMap((field) =>
    field.rect !== null && selected.has(field.index) ? [{ field, box: pdfRectOnScreen(field.rect, geometry) }] : [],
  );
  // NOTHING OVER A PAGE WITH NOTHING TO FILL, `TextLayer`'s rule: an empty layer is something that can go wrong quietly.
  if (placed.length === 0 && outlined.length === 0) return null;
  // HOW TALL THE PAGE IS ON SCREEN, so a dropdown near its foot opens upwards rather than past the paper.
  const [x0, y0, x1, y1] = geometry.crop;
  const pageHeight = (geometry.rotation % 180 === 0 ? y1 - y0 : x1 - x0) * geometry.zoom;
  // A CHOICE'S TYPE SIZE on screen: the field's own at the zoom, or for *automatic* the size a list is drawn at.
  const listPx = (choiceLook: FieldLook | undefined): number =>
    (choiceLook !== undefined && choiceLook.size > 0 ? choiceLook.size : LINES_POINTS) * geometry.zoom;

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
      {placed.map(({ field, offer, box, clip }) => {
        const at: CSSProperties = {
          left: `${String(box.left)}px`,
          top: `${String(box.top)}px`,
          width: `${String(box.width)}px`,
          height: `${String(box.height)}px`,
          ...(clip === undefined ? {} : { clipPath: clip }),
        };
        const fill = (value: FieldFill): void => {
          onFill({ page, index: field.index, value });
        };
        // THE PLACE IN THE WALK IS THE KEY AND THE IDENTITY, the fill's own handle; and the mark a case finds it by.
        const marks = { 'data-form-field': String(field.index) };

        // THE TINT AND THE RED OUTLINE (`forms.highlight`): where a person can write, and where they must.
        const required = 'required' in offer && offer.required;
        const look = [
          'm-page-field',
          highlight ? 'm-page-field--tint' : '',
          highlight && required ? 'm-page-field--required' : '',
        ].filter((name) => name !== '').join(' ');
        const id = controlId(field.index);
        const said = problem?.index === field.index ? problem.said : undefined;
        // WHERE THE SENTENCE GOES: under the field, at its left edge, on the page's own paper.
        const beside = said === undefined ? null : (
          <div
            className="m-page-field-problem"
            key={`problem-${String(field.index)}`}
            style={{ left: `${String(box.left)}px`, top: `${String(box.top + box.height)}px` }}
          >
            <Problem about={{ field: id }} message={i18n._(said.message, said.values)} />
          </div>
        );
        const tell = (next: FieldProblem | undefined): void => {
          setProblem(next === undefined ? undefined : { index: field.index, said: next });
        };
        // A PRESS ONLY FILLS (ADR-0226 Decision 7): selecting a field is *Edit fields*' and the Fields list's.
        const pressed = (): void => {
          if (problem !== undefined && problem.index !== field.index) setProblem(undefined);
        };

        if (offer.kind === 'button') {
          return [
            <button
              {...marks}
              id={id}
              key={field.index}
              aria-label={i18n._(FORM_FIELD_PRESS, { name: field.name })}
              className={look}
              onClick={() => {
                // RESET FORM IS CARRIED OUT, a standard action and not a script (the owner's F7), as one undo step.
                if (offer.resets) {
                  onFill({ page, index: field.index, reset: true });
                  return;
                }
                // SAID, NOT RUN (invariant 24): any other action is the document's content.
                tell({ message: FORM_BUTTON_NO_SCRIPTS, values: {} });
              }}
              onPointerDown={pressed}
              style={at}
              type="button"
            />,
            beside,
          ];
        }

        if (offer.kind === 'sign') {
          const rect = field.rect;
          const sign = (how: 'mark' | 'certificate'): void => {
            setOffering(undefined);
            if (rect !== null) onFill({ page, index: field.index, sign: how, rect, name: field.name });
          };
          const offerId = `${id}-sign`;
          return [
            <button
              {...marks}
              id={id}
              key={field.index}
              aria-controls={offering === field.index ? offerId : undefined}
              aria-expanded={offering === field.index}
              aria-haspopup="true"
              aria-label={i18n._(FORM_FIELD_SIGN, { name: field.name })}
              className={look}
              onClick={() => {
                setOffering((open) => (open === field.index ? undefined : field.index));
              }}
              onPointerDown={pressed}
              style={at}
              type="button"
            />,
            // WHAT SIGNING IS OFFERED, under the field on the page: the application's own two ways, each placed in it.
            offering === field.index ? (
              <div
                aria-label={i18n._(FORM_SIGN_OFFER)}
                className="m-page-field-problem m-page-sign-offer"
                id={offerId}
                key={`sign-${String(field.index)}`}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  setOffering(undefined);
                  document.getElementById(id)?.focus();
                }}
                role="group"
                style={{ left: `${String(box.left)}px`, top: `${String(box.top + box.height)}px` }}
              >
                <Button
                  label={FORM_SIGN_MARK}
                  onClick={() => {
                    sign('mark');
                  }}
                />
                <Button
                  label={FORM_SIGN_CERTIFICATE}
                  onClick={() => {
                    sign('certificate');
                  }}
                />
              </div>
            ) : null,
          ];
        }

        if (offer.kind === 'toggle') {
          return [
            <button
              {...marks}
              id={id}
              key={field.index}
              aria-checked={offer.on}
              // A RADIO SAYS WHICH OPTION IT IS, as the Fields list does: every widget of a group shares the name (F9).
              aria-label={field.option === undefined ? field.name : `${field.name}: ${field.option}`}
              className={look}
              onClick={() => {
                // A RADIO'S CHOSEN OPTION CLEARS on a press, the panel's rule: a PDF group deselects when its lit
                // widget is toggled (measured), so an option that could not be cleared would hide a state it allows.
                fill({ set: 'button', on: !offer.on });
              }}
              onPointerDown={pressed}
              role={offer.radio ? 'radio' : 'checkbox'}
              style={at}
              type="button"
            />,
            beside,
          ];
        }

        // A LIST BOX IS ITS ROWS AT THE FIELD (the owner's F1, F2), in the document's size and colours, whether it takes
        // one value or several: a press chooses the row pressed.
        if (offer.kind === 'choices' || (offer.kind === 'choice' && offer.list)) {
          const several = offer.kind === 'choices';
          return [
            <PageChoiceList
              key={field.index}
              box={at}
              className={look}
              fontPx={listPx(field.look)}
              held={several ? offer.held : offer.held === '' ? [] : [offer.held]}
              id={id}
              look={field.look}
              marks={marks}
              multiple={several}
              name={field.name}
              onChoose={(chosen) => {
                // EVERY OPTION NOW CHOSEN, in one fill: a list that takes several is filled with what it holds.
                fill(several ? { set: 'choices', options: [...chosen] } : { set: 'choice', option: chosen[0] ?? '' });
              }}
              onPointerDown={pressed}
              // THE EMPTY CHOICE IS NOT A ROW of a list: a list shows the document's options, as the document draws it.
              options={several ? offer.options : offer.choices.slice(1)}
            />,
            beside,
          ];
        }

        if (offer.kind === 'choice' && offer.editable && typing?.index === field.index) {
          // A DROPDOWN THAT TAKES TYPING: a box offering the document's options, whose words are the value.
          const listId = `${id}-options`;
          return [
            <FieldTextBox
              key={field.index}
              marks={marks}
              autoFocus
              className="m-page-field-editor"
              name={field.name}
              offer={{ kind: 'text', held: offer.held, lines: false, maxLength: null, comb: false, masked: false, required: offer.required, format: null, range: null }}
              list={listId}
              pressedAt={typing.pressedAt}
              selectsAll={typing.pressedAt === undefined}
              onCancel={() => {
                setTyping(undefined);
              }}
              onCommit={(text) => {
                fill({ set: 'choice', option: text });
              }}
              onDone={() => {
                setTyping(undefined);
              }}
              style={{ ...at, fontSize: `${String(box.height * LINE_FILL)}px` }}
            />,
            <datalist id={listId} key={`options-${String(field.index)}`}>
              {offer.choices.filter((choice) => choice !== '').map((choice, place) => (
                <option key={place} value={choice} />
              ))}
            </datalist>,
          ];
        }

        if (offer.kind === 'choice' && offer.editable) {
          return [
            <button
              {...marks}
              id={id}
              key={field.index}
              aria-label={i18n._(FORM_FIELD_FILL_IN, { name: field.name })}
              className={`${look} m-page-field--text`}
              onClick={(event) => {
                setTyping({ index: field.index, pressedAt: event.detail === 0 ? undefined : { x: event.clientX, y: event.clientY } });
              }}
              onPointerDown={pressed}
              style={at}
              type="button"
            />,
            beside,
          ];
        }

        if (offer.kind === 'choice') {
          return [
            <PageDropdown
              key={field.index}
              at={box}
              choices={offer.choices}
              className={look}
              fontPx={Math.min(listPx(field.look), box.height * LINE_FILL)}
              held={offer.held}
              id={id}
              look={field.look}
              marks={marks}
              name={field.name}
              onChoose={(choice) => {
                fill({ set: 'choice', option: choice });
              }}
              onPointerDown={pressed}
              room={pageHeight}
            />,
            beside,
          ];
        }

        if (typing?.index === field.index) {
          const size = offer.lines ? Math.min(box.height * LINE_FILL, LINES_POINTS * geometry.zoom) : box.height * LINE_FILL;
          return [
            <FieldTextBox
              key={field.index}
              id={id}
              marks={marks}
              autoFocus
              className={offer.comb ? 'm-page-field-editor m-page-field-editor--comb' : 'm-page-field-editor'}
              name={field.name}
              offer={offer}
              pressedAt={typing.pressedAt}
              selectsAll={typing.pressedAt === undefined}
              onTab={
                onTab === undefined
                  ? undefined
                  : (backwards, filled) => {
                      onTab(field.index, backwards, filled);
                    }
              }
              onCancel={() => {
                setTyping(undefined);
              }}
              onCommit={(text) => {
                fill({ set: 'text', text: storedText(text, offer) });
              }}
              onLeave={(text) => {
                tell(leftFieldProblem(field.name, text, offer));
              }}
              onDone={() => {
                setTyping(undefined);
              }}
              style={{ ...at, fontSize: `${String(size)}px`, ...combCells(offer, box.width, size) }}
            />,
            beside,
          ];
        }

        return [
          <button
            {...marks}
            id={id}
            key={field.index}
            aria-label={i18n._(FORM_FIELD_FILL_IN, { name: field.name })}
            className={`${look} m-page-field--text`}
            onClick={(event) => {
              // A PRESS OPENS THE BOX WITH THE CARET WHERE IT LANDED; a keyboard's Enter or Space on the control is a
              // click with no place (`detail` 0), and opens it with the words selected, as Tab does.
              setTyping({ index: field.index, pressedAt: event.detail === 0 ? undefined : { x: event.clientX, y: event.clientY } });
            }}
            onPointerDown={pressed}
            style={at}
            type="button"
          />,
          beside,
        ];
      })}
    </div>
  );
}
