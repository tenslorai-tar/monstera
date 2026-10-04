import { useLingui } from '@lingui/react';
import { pdfPoint, toViewport } from '@monstera/shared';
import type React from 'react';
import { type ReactElement, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { hexFromColour } from './annotations/annotationStyle.js';
import { overlayTransform } from './annotations/annotationSpace.js';
import { type Draft, type WriteEnd, type WriteRequest, settle } from './pageWriting.js';
import { useOnColor } from './primitives/useOnColor.js';

/**
 * Words typed where they go (ADR-0154): a request drawn over its own page.
 *
 * ## What it draws
 *
 * A **block** is a box over the place the words will be, set in the size and colour they will be drawn in at the zoom
 * on screen, with the caret in it. A **line** is a small field just below what was drawn — a link's address under the
 * link's box — with the rule's message under it when the words do not pass.
 *
 * ## How it ends
 *
 * `settle` decides, so the editor and its cases read one rule. A press elsewhere ON THE PAGE ends it and goes no
 * further: the press that finishes a typewriter's words must not also start the next one. A press anywhere else — the
 * ribbon, a panel — goes where it was aimed, and the box ends because its focus left.
 *
 * **Being taken off the page is not an ending.** The editor is drawn only while its document is on show, so another
 * document arriving removes it with the request still open; it is drawn again from the request's draft when its
 * document returns. Removing it does fire a blur — measured 2026-10-04 in Chromium 151.0.7922.34, a focused textarea
 * removed dispatches `blur` and a `focusout` that bubbles to its old ancestors — but React never delivers it: the
 * removal happens inside a commit, and React 19.2.8 switches its event dispatch off from `commitBeforeMutationEffects`
 * until the mutations are done. `pageWriting.pw.ts` holds that in a browser, with a control showing it sees an answer.
 */
export interface InlineWriterProps {
  readonly request: WriteRequest;
  /** The words typed so far, kept with the request: read as the editor is drawn, told at each change. */
  readonly draft: Draft;
  /** The page as drawn, for the transform. */
  readonly geometry: OverlayPage;
  readonly onDone: (words: string | undefined) => void;
}

/**
 * The room between a FreeText's edge and its words, in points: MuPDF sets them 2 in from the box, measured in its
 * appearance stream (`textTools.ts`' `INSET` adds the border's half point). The editor's words start where the page's
 * will.
 */
const TEXT_INSET = 2;

/** A request's PDF box on the page as drawn: its corners ordered, and the page's own size around it. */
interface Placed {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** The page as drawn, in CSS pixels. */
  readonly pageWidth: number;
  readonly pageHeight: number;
}

function placed(request: WriteRequest, geometry: OverlayPage): Placed {
  const transform = overlayTransform(geometry);
  const a = toViewport(pdfPoint(request.box.x0, request.box.y0), transform);
  const b = toViewport(pdfPoint(request.box.x1, request.box.y1), transform);
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
    pageWidth: transform.viewport.width,
    pageHeight: transform.viewport.height,
  };
}

/**
 * Where a line's field goes: beside what was drawn, on the side of it with more of the page — under it and from its left
 * edge, unless the page has more room above it or to its left — so a link drawn at the page's foot or its right edge
 * does not put its address off the page.
 */
function besideBox(box: Placed): React.CSSProperties {
  const below = box.pageHeight - (box.top + box.height);
  const right = box.pageWidth - box.left;
  return {
    ...(below >= box.top ? { top: box.top + box.height } : { bottom: box.pageHeight - box.top }),
    ...(right >= box.left + box.width ? { left: box.left } : { right: box.pageWidth - (box.left + box.width) }),
  };
}

export function InlineWriter({ request, draft, geometry, onDone }: InlineWriterProps): ReactElement {
  const { _ } = useLingui();
  const [words, setWords] = useState(draft.read);
  const [refused, setRefused] = useState(false);
  const field = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  /** Whether this request has been answered, so a blur after Escape cannot answer it twice. */
  const ended = useRef(false);
  const messageId = useId();

  const end = (how: WriteEnd, typed: string): void => {
    if (ended.current) return;
    const settled = settle(request, typed, how);
    if (settled.stays) {
      setRefused(true);
      return;
    }
    ended.current = true;
    onDone(settled.answer);
  };
  // THE WORDS AT THE PRESS, for the page-press listener below, which is installed once.
  const pressedOnThePage = useEffectEvent(() => {
    end('outside', words);
  });

  useEffect(() => {
    field.current?.focus();
    // THE CARET AT THE END of words being edited, where a person continues them.
    const length = field.current?.value.length ?? 0;
    field.current?.setSelectionRange(length, length);
  }, []);

  useEffect(() => {
    const pressed = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element) || root.current?.contains(target) === true) return;
      // ON THE PAGE, the press ends the words and goes no further; elsewhere it goes where it was aimed.
      if (target.closest('.m-page-slot') === null) return;
      event.preventDefault();
      event.stopPropagation();
      pressedOnThePage();
    };
    window.addEventListener('pointerdown', pressed, true);
    return () => {
      window.removeEventListener('pointerdown', pressed, true);
    };
  }, []);

  // THE OUTLINE AND THE CARET ARE ON THE PAPER, not on the application's surfaces, so they are solved against `--page`
  // where they are drawn: the accent itself is 3.30:1 on white in light, 2.54:1 in dark and 1.49:1 in high contrast
  // (measured 2026-10-04 with `contrast`), under the 3:1 a boundary needs in two of the three. A card sits on the
  // application's own surface and keeps the field's ring, so it solves nothing.
  const onPaper = request.shape === 'block' && request.style !== undefined ? ['--page'] : [];
  useOnColor(field, 'outline-color', '--accent', onPaper, 3);
  useOnColor(field, 'caret-color', '--accent', onPaper, 3);

  // A BOX THAT HAS REACHED THE PAGE'S FOOT scrolls, and its message would hang below the page, out of sight; it goes
  // above the box instead. Measured after each change and written to the node, like `useOnColor`, so no render waits
  // on it.
  useLayoutEffect(() => {
    const element = field.current;
    if (element === null || root.current === null) return;
    root.current.dataset['atFoot'] = String(element.scrollHeight > element.clientHeight);
  }, [words]);

  const box = placed(request, geometry);
  // WHAT IS TYPED BEING WRONG is said at once; NOTHING TYPED only once the person has tried to finish — the dialogs'
  // rule (`attempt.ts`), so a field does not open already complaining.
  const failing = request.check?.(words);
  const message = refused || words.trim() !== '' ? failing : undefined;

  const onKeyDown = (event: React.KeyboardEvent): void => {
    // THE PAGE'S KEYS STAY OUT: Delete, the arrows and the tool chords belong to what is being typed here.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      end('escape', words);
      return;
    }
    if (event.key !== 'Enter') return;
    if (request.shape === 'line' || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      end('enter', words);
    }
  };

  const change = (event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>): void => {
    setWords(event.target.value);
    setRefused(false);
    draft.keep(event.target.value);
  };

  /** What every field here shares: its name, its refusal, and how it ends. */
  const fieldProps = {
    'aria-describedby': message === undefined ? undefined : messageId,
    'aria-invalid': message !== undefined,
    'aria-label': _(request.label),
    onBlur: () => {
      end('outside', words);
    },
    onChange: change,
    onKeyDown,
    ref: field,
    value: words,
  };

  // WORDS THE PAGE DOES NOT DRAW WHERE THEY ARE TYPED — a field's name, a link's address, a note's comment — are typed
  // in the application's own field, on a card beside what was drawn rather than over it.
  if (request.shape === 'line' || request.style === undefined) {
    return (
      <div className="m-inline-writer m-inline-writer--card" data-inline-writer={request.shape} ref={root} style={besideBox(box)}>
        {request.shape === 'line' ? (
          // THE PLATFORM'S RULE FOR WHICH WAY TYPED TEXT RUNS, as the application's other text fields take it (ADR-0128).
          <input {...fieldProps} className="m-input m-inline-writer__line" dir="auto" type="text" />
        ) : (
          <textarea {...fieldProps} className="m-input m-textarea m-inline-writer__line" dir="auto" />
        )}
        {message === undefined ? null : (
          <p className="m-inline-writer__message" id={messageId}>
            {_(message)}
          </p>
        )}
      </div>
    );
  }
  const { style } = request;

  return (
    <div className="m-inline-writer" data-inline-writer="block" ref={root} style={{ left: box.left, top: box.top }}>
      <textarea
        {...fieldProps}
        className={`m-inline-writer__block m-inline-writer__block--${style.font}`}
        dir={style.direction === 'right-to-left' ? 'rtl' : 'ltr'}
        style={{
          // THE BOX THE WORDS GO IN, never smaller: a drag's keeps its width and lengthens with the words; a click's
          // starts where it was and widens with them up to the page's edge, then wraps — `clickedRect`'s rule. NEVER
          // PAST THE PAGE'S FOOT either: past it the box scrolls, so it and its message stay on the page.
          minBlockSize: box.height,
          maxBlockSize: Math.max(box.height, box.pageHeight - box.top),
          ...(request.grows === true
            ? { minInlineSize: box.width, maxInlineSize: Math.max(box.width, box.pageWidth - box.left) }
            : { inlineSize: box.width }),
          padding: TEXT_INSET * geometry.zoom,
          fontSize: style.fontSize * geometry.zoom,
          color: hexFromColour(style.colour),
        }}
      />
      {message === undefined ? null : (
        <p className="m-inline-writer__problem" id={messageId}>
          {_(message)}
        </p>
      )}
    </div>
  );
}
