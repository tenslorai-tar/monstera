import { useLingui } from '@lingui/react';
import { pdfPoint, toViewport } from '@monstera/shared';
import type React from 'react';
import { type ReactElement, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { hexFromColour } from './annotations/annotationStyle.js';
import { overlayTransform } from './annotations/annotationSpace.js';
import { TEXT_INSET } from './markLook.js';
import { WRITE_TOO_MANY_STYLES } from './messages/en.js';
import { type Draft, type TypedRun, type WriteEnd, type WriteRequest, runsFit, settle } from './pageWriting.js';
import { composing } from './surfaces/shortcuts.js';
import { formatRange, stateAt, toggleChord, toggled, typedRunsOf } from './textFormatting.js';

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

/**
 * Fills a styled block with the words it starts from: the runs the request kept where they make those words — an editor
 * drawn again when its document returns — and the words plain otherwise. Each run's style goes on through the formatting's
 * own writer, so what is drawn and what is read back are one reading of the spans.
 */
function fillStyled(root: HTMLElement, words: string, runs: readonly TypedRun[], zoom: number): void {
  root.replaceChildren();
  const kept = runs.length > 0 && runs.map((run) => run.text).join('') === words ? runs : [{ text: words }];
  for (const run of kept) {
    const text = root.ownerDocument.createTextNode(run.text);
    root.append(text);
    const change = {
      ...(run.bold === true ? { bold: true } : {}),
      ...(run.italic === true ? { italic: true } : {}),
      ...(run.underline === true ? { underline: true } : {}),
      ...(run.strike === true ? { strike: true } : {}),
    };
    if (Object.keys(change).length === 0) continue;
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(text);
    formatRange(root, range, change, zoom);
  }
}

export function InlineWriter({ request, draft, geometry, onDone }: InlineWriterProps): ReactElement {
  const { _ } = useLingui();
  const [words, setWords] = useState(draft.read);
  const [refused, setRefused] = useState(false);
  const field = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  /** A styled block's editable words, where the request keeps runs (B5.8); `null` for every other request. */
  const editor = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  /** Whether this request has been answered, so a blur after Escape cannot answer it twice. */
  const ended = useRef(false);
  const messageId = useId();
  /** The styles a chord turned on or off at a caret with nothing chosen: what the next words typed are set in. */
  const pending = useRef<Partial<Record<'bold' | 'italic' | 'underline', boolean>>>({});
  /** A chord whose style would have made more runs than one box carries, said until the words change. */
  const [tooMany, setTooMany] = useState(false);
  // WORDS STYLED ONE BY ONE are a block's alone, typed where the page draws them: a line and a card are the application's
  // own fields.
  const styled = request.shape === 'block' && request.style !== undefined ? request.styled : undefined;
  // THE RUNS' BOUND IS PART OF THE WORDS' RULE, so a box whose styles a text box cannot carry stays open saying so, as one
  // whose words are too long does, rather than ending with the styles dropped: preserve, never drop.
  const asked = useMemo<WriteRequest>(
    () =>
      styled === undefined
        ? request
        : { ...request, check: (text) => request.check?.(text) ?? (runsFit(styled.read()) ? undefined : WRITE_TOO_MANY_STYLES) },
    [request, styled],
  );

  const end = (how: WriteEnd, typed: string): void => {
    if (ended.current) return;
    const settled = settle(asked, typed, how);
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

  // ONCE, AS IT IS DRAWN: after that the words are the person's, and a render that put the draft back would type over them
  // (`TextEditLayer`'s rule for its own editable).
  const drawn = useEffectEvent(() => {
    const words = editor.current;
    if (words !== null && styled !== undefined) {
      fillStyled(words, draft.read(), styled.read(), geometry.zoom);
      words.focus();
      // THE CARET AT THE END, as a field's below.
      words.ownerDocument.getSelection()?.selectAllChildren(words);
      words.ownerDocument.getSelection()?.collapseToEnd();
      return;
    }
    field.current?.focus();
    // THE CARET AT THE END of words being edited, where a person continues them.
    const length = field.current?.value.length ?? 0;
    field.current?.setSelectionRange(length, length);
  });
  useEffect(() => {
    drawn();
  }, []);

  /** Reads the styled words after any change to them: the words, and the runs the request keeps. */
  const readStyled = (): void => {
    const words = editor.current;
    if (words === null || styled === undefined) return;
    const read = typedRunsOf(words);
    styled.keep(read.runs);
    setWords(read.text);
    setRefused(false);
    setTooMany(false);
    draft.keep(read.text);
  };

  /** A chord's style over the words chosen, or for the words typed next at a caret; refused where it would make too many runs. */
  const toggleStyle = (property: 'bold' | 'italic' | 'underline'): void => {
    const words = editor.current;
    if (words === null) return;
    const selection = words.ownerDocument.getSelection();
    if (selection === null || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!words.contains(range.commonAncestorContainer)) return;
    if (range.collapsed) {
      // AT A CARET, the style is the next words': turned on where the words there are not, off where they are — off as a
      // value, `toggled`'s rule, so words typed inside a styled span are not that style.
      const now = pending.current[property] ?? stateAt(range.startContainer, words)[property];
      pending.current = { ...pending.current, [property]: !now };
      return;
    }
    const before = Array.from(words.childNodes, (node) => node.cloneNode(true));
    formatRange(words, range, toggled(words, range, property), geometry.zoom);
    if (!runsFit(typedRunsOf(words).runs)) {
      words.replaceChildren(...before);
      setTooMany(true);
      return;
    }
    readStyled();
  };

  // THE NEXT WORDS IN THE STYLE A CHORD SET AT A CARET: the typed text is put in a span of its own in that style, and the
  // caret left inside it, so the words after it continue there as a person typing after Ctrl+B expects. `beforeinput`
  // rather than a key, since only it carries what an input method or a key actually inserts.
  useEffect(() => {
    const words = editor.current;
    if (words === null) return undefined;
    const typed = (event: InputEvent): void => {
      const change = pending.current;
      if (event.inputType !== 'insertText' || event.data === null || Object.keys(change).length === 0) return;
      const selection = words.ownerDocument.getSelection();
      if (selection === null || selection.rangeCount === 0) return;
      event.preventDefault();
      pending.current = {};
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const text = words.ownerDocument.createTextNode(event.data);
      range.insertNode(text);
      range.selectNodeContents(text);
      formatRange(words, range, change, geometry.zoom);
      // ONE RUN TOO MANY: the style comes off again and the words stay, typed in the style around them, with the box
      // saying why. The words are never what is dropped.
      const tooManyRuns = !runsFit(typedRunsOf(words).runs);
      if (tooManyRuns) formatRange(words, range, Object.fromEntries(Object.keys(change).map((key) => [key, null])), geometry.zoom);
      selection.collapse(range.endContainer, range.endOffset);
      readStyled();
      if (tooManyRuns) setTooMany(true);
    };
    // A CARET MOVED is a different place to type at, and the chord was about the place it was pressed.
    const moved = (): void => {
      pending.current = {};
    };
    words.addEventListener('beforeinput', typed);
    words.addEventListener('pointerdown', moved);
    return () => {
      words.removeEventListener('beforeinput', typed);
      words.removeEventListener('pointerdown', moved);
    };
  });

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

  // A BOX THAT HAS REACHED THE PAGE'S FOOT scrolls, and its message would hang below the page, out of sight; it goes
  // above the box instead. Measured after each change and written to the node, like `useOnColor`, so no render waits
  // on it.
  useLayoutEffect(() => {
    const element = editor.current ?? field.current;
    if (element === null || root.current === null) return;
    root.current.dataset['atFoot'] = String(element.scrollHeight > element.clientHeight);
  }, [words]);

  const box = placed(request, geometry);
  // WHAT IS TYPED BEING WRONG is said at once; NOTHING TYPED only once the person has tried to finish — the dialogs'
  // rule (`attempt.ts`), so a field does not open already complaining.
  const failing = tooMany ? WRITE_TOO_MANY_STYLES : asked.check?.(words);
  const message = refused || tooMany || words.trim() !== '' ? failing : undefined;

  const onKeyDown = (event: React.KeyboardEvent): void => {
    // THE PAGE'S KEYS STAY OUT: Delete, the arrows and the tool chords belong to what is being typed here.
    event.stopPropagation();
    // A COMPOSITION'S ENTER AND ESCAPE are the input method's: confirming a candidate did not end the writing.
    if (composing(event)) return;
    if (styled !== undefined) {
      const property = toggleChord(event);
      if (property !== undefined) {
        event.preventDefault();
        toggleStyle(property);
        return;
      }
      // A CARET MOVED BY A KEY is a different place to type at, as one moved by a press is.
      if (/^(Arrow|Home$|End$|Page)/u.test(event.key)) pending.current = {};
    }
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
  const blockStyle: React.CSSProperties = {
    // THE BOX THE WORDS GO IN, never smaller: a drag's keeps its width and lengthens with the words; a click's starts where
    // it was and widens with them up to the page's edge, then wraps — `clickedRect`'s rule. NEVER PAST THE PAGE'S FOOT
    // either: past it the box scrolls, so it and its message stay on the page.
    minBlockSize: box.height,
    maxBlockSize: Math.max(box.height, box.pageHeight - box.top),
    ...(request.grows === true
      ? { minInlineSize: box.width, maxInlineSize: Math.max(box.width, box.pageWidth - box.left) }
      : { inlineSize: box.width }),
    padding: TEXT_INSET * geometry.zoom,
    fontSize: style.fontSize * geometry.zoom,
    // THE FAMILY THE PAGE WILL DRAW, by name, the font picker's way; the class's generic face where it is absent.
    ...(style.family === undefined ? {} : { fontFamily: `"${style.family}", var(--m-kind-face)` }),
    color: hexFromColour(style.colour),
  };
  const className = `m-inline-writer__block m-inline-writer__block--${style.font}`;
  const dir = style.direction === 'right-to-left' ? 'rtl' : 'ltr';

  return (
    <div className="m-inline-writer" data-inline-writer="block" ref={root} style={{ left: box.left, top: box.top }}>
      {styled === undefined ? (
        <textarea {...fieldProps} className={className} dir={dir} style={blockStyle} />
      ) : (
        // WORDS STYLED ONE BY ONE (B5.8): an editable that takes no markup a paste brings in, as the page's own editor is,
        // with the styles a chord gives held as the formatting's spans (`textFormatting.ts`). Filled once, as it is drawn.
        <div
          aria-describedby={message === undefined ? undefined : messageId}
          aria-invalid={message !== undefined}
          aria-label={_(request.label)}
          aria-multiline
          className={className}
          contentEditable="plaintext-only"
          data-styled-words=""
          dir={dir}
          onBlur={() => {
            end('outside', words);
          }}
          onInput={readStyled}
          onKeyDown={onKeyDown}
          ref={editor}
          role="textbox"
          style={blockStyle}
          suppressContentEditableWarning
          tabIndex={0}
        />
      )}
      {message === undefined ? null : (
        <p className="m-inline-writer__problem" id={messageId}>
          {_(message)}
        </p>
      )}
    </div>
  );
}
