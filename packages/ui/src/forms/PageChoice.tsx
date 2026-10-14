import { useLingui } from '@lingui/react';
import type { FieldLook } from '@monstera/contract';
import { type CSSProperties, type KeyboardEvent, type ReactElement, useEffect, useRef, useState } from 'react';

import { FORMS_CHOICE_EMPTY } from '../messages/en.js';

/**
 * A choice field on the page — a list box or a dropdown's open list — drawn as the DOCUMENT draws it (the owner's F1):
 * in the field's own type size and colours at the zoom, on the field's own background or the paper, never in the
 * application's theme. Opaque, so it covers the document's drawing of the same field, and the field is drawn once.
 *
 * ONE CONTROL FOR EVERY CHOICE ON THE PAGE (B3a). A native `<select>` was two controls in one: its closed face took the
 * application's theme and its popup was the browser's own window, fixed to the screen, so a page that scrolled left it
 * floating over other rows (F4), and its first frame drew empty (F6). Here a list is rows in the page layer, and a
 * dropdown's list is the same rows opened under the field, inside the page, so it moves with the page.
 */

/** A row's height as a fraction of its type size: the line MuPDF's list appearance steps by. */
const ROW_PITCH = 1.15;

/** How many rows an open dropdown shows before it scrolls. */
const OPEN_ROWS = 8;

/** A colour from the document as CSS: a document value, which the token rule names as dynamic. */
function css(colour: readonly [number, number, number]): string {
  return `rgb(${colour.map((part) => String(Math.round(part * 255))).join(' ')})`;
}

/** The look's colours as style: the field's background where it has one, else the paper's (the stylesheet's). */
function painted(look: FieldLook | undefined): CSSProperties {
  return {
    color: css(look?.text ?? [0, 0, 0]),
    ...(look?.fill === null || look?.fill === undefined ? {} : { backgroundColor: css(look.fill) }),
  };
}

/** Which rows a press chooses, by the rules every list follows: a press one row, Ctrl one more or one fewer, Shift a run. */
export function chosenAfter(
  options: readonly string[],
  chosen: readonly string[],
  at: number,
  keys: { readonly add: boolean; readonly run: boolean },
  multiple: boolean,
  anchor: number | undefined,
): readonly string[] {
  const option = options[at];
  if (option === undefined) return chosen;
  if (!multiple) return keys.add && chosen.includes(option) ? [] : [option];
  if (keys.run && anchor !== undefined) {
    const [from, to] = anchor < at ? [anchor, at] : [at, anchor];
    return options.slice(from, to + 1);
  }
  if (keys.add) {
    // IN THE DOCUMENT'S ORDER, whatever order the presses came in: a list's value is a set the document lists in order.
    const next = chosen.includes(option) ? chosen.filter((each) => each !== option) : [...chosen, option];
    return options.filter((each) => next.includes(each));
  }
  return [option];
}

/** Two lists hold the same values in the same order. */
function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((each, at) => each === b[at]);
}

/**
 * The rows themselves, for a list box at rest and a dropdown open alike. What is chosen shows at once and is sent at
 * once; the next listing replaces it.
 */
function Rows({
  id,
  marks,
  name,
  options,
  labels,
  held,
  multiple,
  look,
  fontPx,
  className,
  style,
  autoFocus = false,
  arrowsChoose,
  onChoose,
  onKey,
  onPointerDown,
}: {
  /** Whether a list that takes one follows the arrows (a list box), or they only move and Enter chooses (an open list). */
  readonly arrowsChoose: boolean;
  readonly id: string;
  readonly marks?: Readonly<Record<string, string>>;
  readonly name: string;
  readonly options: readonly string[];
  /** What each row reads, where it is not the option itself: the empty choice's sentence. */
  readonly labels?: ReadonlyMap<number, string>;
  readonly held: readonly string[];
  readonly multiple: boolean;
  readonly look: FieldLook | undefined;
  readonly fontPx: number;
  readonly className: string;
  readonly style: CSSProperties;
  readonly autoFocus?: boolean;
  readonly onChoose: (chosen: readonly string[]) => void;
  readonly onKey?: (event: KeyboardEvent<HTMLDivElement>) => boolean;
  readonly onPointerDown?: () => void;
}): ReactElement {
  // WHAT IS CHOSEN HERE, following the document's answer: a new answer replaces what a press chose, React's form for
  // state that follows a prop.
  const [seen, setSeen] = useState(held);
  const [chosen, setChosen] = useState(held);
  if (!same(seen, held)) {
    setSeen(held);
    setChosen(held);
  }
  const [anchor, setAnchor] = useState<number | undefined>(undefined);
  const first = options.findIndex((option) => chosen.includes(option));
  const [active, setActive] = useState(Math.max(0, first === -1 ? (look?.top ?? 0) : first));
  const root = useRef<HTMLDivElement | null>(null);
  const pitch = fontPx * ROW_PITCH;

  // THE FIRST ROW SHOWN is the document's (`/TI`), or the chosen one's where it is further down. Taken once, when drawn:
  // a scroll the person made is theirs afterwards.
  const [opening] = useState(() => ({ top: look?.top ?? 0, chosen: first, pitch }));
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const shown = Math.max(1, Math.floor(element.clientHeight / opening.pitch));
    element.scrollTop = Math.max(opening.top, opening.chosen - shown + 1) * opening.pitch;
    if (autoFocus) element.focus();
  }, [autoFocus, opening]);

  const choose = (at: number, keys: { readonly add: boolean; readonly run: boolean }): void => {
    const next = chosenAfter(options, chosen, at, keys, multiple, anchor);
    setActive(at);
    if (!keys.run) setAnchor(at);
    setChosen(next);
    onChoose(next);
  };

  const rowId = (at: number): string => `${id}-row-${String(at)}`;
  return (
    <div
      {...marks}
      aria-activedescendant={rowId(active)}
      aria-label={name}
      aria-multiselectable={multiple}
      className={className}
      id={id}
      onKeyDown={(event) => {
        if (onKey?.(event) === true) return;
        const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (step !== 0 || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const next =
            event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.min(options.length - 1, Math.max(0, active + step));
          setActive(next);
          const row = root.current?.querySelector(`#${CSS.escape(rowId(next))}`);
          if (row !== null && row !== undefined && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
          // ONE VALUE FOLLOWS THE ARROWS in a list box that takes one, as a list does; several are chosen with Space,
          // and an open dropdown's row with Enter.
          if (!multiple && arrowsChoose) choose(next, { add: false, run: false });
          return;
        }
        if (event.key === 'Enter' && !arrowsChoose) {
          event.preventDefault();
          choose(active, { add: false, run: false });
          return;
        }
        if (event.key === ' ' && multiple) {
          event.preventDefault();
          choose(active, { add: true, run: false });
        }
      }}
      onPointerDown={onPointerDown}
      ref={root}
      role="listbox"
      style={{ ...style, ...painted(look), fontSize: `${String(fontPx)}px` }}
      tabIndex={0}
    >
      {options.map((option, at) => (
        <div
          aria-selected={chosen.includes(option)}
          className="m-page-choice-row"
          // THE POSITION IS THE KEY: a document's options can repeat.
          key={at}
          id={rowId(at)}
          onClick={(event) => {
            choose(at, { add: event.ctrlKey || event.metaKey, run: event.shiftKey });
          }}
          role="option"
          style={{ height: `${String(pitch)}px`, lineHeight: `${String(pitch)}px` }}
        >
          {labels?.get(at) ?? option}
        </div>
      ))}
    </div>
  );
}

/** Where a field is on the page layer, in pixels. */
export interface PageBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A LIST BOX, its rows at the field (F1, F2): a press chooses the row pressed, Ctrl adds or takes one away and Shift
 * chooses a run where the list takes several; a list that takes one is never a dropdown.
 */
export function PageChoiceList({
  id,
  marks,
  name,
  options,
  held,
  multiple,
  look,
  fontPx,
  box,
  className,
  onChoose,
  onPointerDown,
}: {
  readonly id: string;
  readonly marks: Readonly<Record<string, string>>;
  readonly name: string;
  readonly options: readonly string[];
  readonly held: readonly string[];
  readonly multiple: boolean;
  readonly look: FieldLook | undefined;
  readonly fontPx: number;
  readonly box: CSSProperties;
  readonly className: string;
  readonly onChoose: (chosen: readonly string[]) => void;
  readonly onPointerDown: () => void;
}): ReactElement {
  return (
    <Rows
      arrowsChoose
      className={`${className} m-page-choice m-page-choice--list`}
      fontPx={fontPx}
      held={held}
      id={id}
      look={look}
      marks={marks}
      multiple={multiple}
      name={name}
      onChoose={(chosen) => {
        // A PRESS THAT CHANGES NOTHING SENDS NOTHING: the row already chosen, pressed again.
        if (!same(chosen, held)) onChoose(chosen);
      }}
      onPointerDown={onPointerDown}
      options={options}
      style={box}
    />
  );
}

/**
 * A DROPDOWN: at rest the document's own drawing of the field, which a press opens into its rows under the field, in
 * the page, so they move with it (F4); choosing one fills the field and closes the list (F5). The empty choice is the
 * first row, always, with its sentence (F6). Escape, or a press anywhere else, closes it with nothing chosen.
 */
export function PageDropdown({
  id,
  marks,
  name,
  choices,
  held,
  look,
  fontPx,
  at,
  room,
  className,
  onChoose,
  onPointerDown,
}: {
  readonly id: string;
  readonly marks: Readonly<Record<string, string>>;
  readonly name: string;
  /** The empty choice first, then the options (`fieldFill`'s `choices`). */
  readonly choices: readonly string[];
  readonly held: string;
  readonly look: FieldLook | undefined;
  readonly fontPx: number;
  readonly at: PageBox;
  /** How far the page reaches below the top of the layer, so an open list near its foot opens upwards instead. */
  readonly room: number;
  readonly className: string;
  readonly onChoose: (choice: string) => void;
  readonly onPointerDown: () => void;
}): ReactElement {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const face = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const listId = `${id}-list`;

  // A PRESS ANYWHERE ELSE CLOSES IT, before that press does its own work.
  useEffect(() => {
    if (!open) return undefined;
    const elsewhere = (event: PointerEvent): void => {
      const target = event.target instanceof Node ? event.target : null;
      if (target !== null && (face.current?.contains(target) === true || list.current?.contains(target) === true)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', elsewhere, true);
    return () => {
      window.removeEventListener('pointerdown', elsewhere, true);
    };
  }, [open]);

  const close = (): void => {
    setOpen(false);
    face.current?.focus();
  };
  const height = Math.min(choices.length, OPEN_ROWS) * fontPx * ROW_PITCH;
  const below = at.top + at.height;
  const upwards = below + height > room && at.top - height >= 0;
  const labels = new Map([[0, i18n._(FORMS_CHOICE_EMPTY)]]);
  return (
    <>
      <button
        {...marks}
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={name}
        className={className}
        id={id}
        onClick={() => {
          setOpen((was) => !was);
        }}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        onPointerDown={onPointerDown}
        ref={face}
        style={{ left: `${String(at.left)}px`, top: `${String(at.top)}px`, width: `${String(at.width)}px`, height: `${String(at.height)}px` }}
        type="button"
      />
      {open ? (
        <div className="m-page-choice-open" ref={list}>
          <Rows
            arrowsChoose={false}
            autoFocus
            className="m-page-choice m-page-choice--open"
            fontPx={fontPx}
            held={held === '' ? [] : [held]}
            id={listId}
            labels={labels}
            look={look}
            multiple={false}
            name={name}
            onChoose={(chosen) => {
              const choice = chosen[0] ?? '';
              close();
              if (choice !== held) onChoose(choice);
            }}
            onKey={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                if (event.key === 'Escape') event.preventDefault();
                close();
                return true;
              }
              return false;
            }}
            options={choices}
            style={{
              left: `${String(at.left)}px`,
              top: `${String(upwards ? at.top - height : below)}px`,
              width: `${String(at.width)}px`,
              maxHeight: `${String(height)}px`,
            }}
          />
        </div>
      ) : null}
    </>
  );
}
