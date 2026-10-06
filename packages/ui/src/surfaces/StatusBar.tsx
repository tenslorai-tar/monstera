import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import { Fragment, type ReactElement, type ReactNode, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';

import {
  STATUS_PAGES,
  STATUS_CHROME_GROUP,
  STATUS_GO_TO,
  STATUS_GO_TO_OUTSIDE,
  STATUS_LABEL,
  STATUS_NAVIGATION,
  STATUS_PAGE_OF,
  STATUS_PAGE_TOTAL,
  STATUS_ZOOM,
  STATUS_ZOOM_GROUP,
  STATUS_TOOL_LINE,
  STATUS_ZOOM_SLIDER,
  TASK_CANCEL,
  TASK_PROGRESS,
} from '../messages/en.js';
import { byteSize } from '../byteSize.js';
import { kernelPageOf, pdfjsPageOf } from '../pageNumbering.js';
import { ICONS } from '../primitives/icons.js';
import { IconButton } from '../primitives/IconButton.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import type { RunningTask } from '../runningTask.js';
import type { SavedState } from '../savedState.js';
import { ZOOM_STEPS, type ZoomMode } from '../zoom.js';
import { statusBarModel, type OrderedEntry } from './projections.js';
import { type DocumentFact, FACT_ORDER, factsThatFit } from './statusFacts.js';

/**
 * The least the document's name is shortened to while it is shown, in ems of the line: about six characters, enough
 * for *Annual…* to say which document this is. Below it the name leaves the line whole (`statusFacts.ts`).
 */
const NAME_MIN_EM = 6;

/** The slider's ends: the zoom ladder's, so the slider offers no scale the ladder refuses. */
const SLIDER_MIN = ZOOM_STEPS[0];
const SLIDER_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? SLIDER_MIN;
/** Five percent a step: fine enough to aim, coarse enough that an arrow key visibly moves it. */
const SLIDER_STEP = 0.05;


/**
 * The strip along the bottom: which document this is, where the reader is and how to move, how
 * big the page is and how to change it (§10.3: *"page navigation: first / previous / an editable
 * "page ⁄ total" field / next / last"* and *"zoom-out button · slider · zoom-in button · current
 * percentage · fit mode, all real controls"*).
 *
 * ## THE BUTTONS ARE A PROJECTION, and the two value controls are the bar's own
 *
 * `statusBarModel` answers which commands sit before and after each cluster's value control
 * (ARCHITECTURE §7, ADR-0067), and this renders it and names no command — which is also what lets
 * `check:secondwiring` see this file, now that it lives in the surfaces directory. The page field
 * and the zoom slider each take a value, which a command's `run` cannot, so they are here, and each
 * writes the state the commands change: the page through `onGoTo` (`jumpTo`), the zoom through
 * `onZoom` (the zoom commands' own `changeZoom`). One owner of each.
 *
 * ## The name comes from MAIN, and could not come from anywhere else
 *
 * A renderer holds an opaque `DocId` and no filesystem path (invariant L2), so there is nothing
 * here to cut a file name out of. `document.open` carries the name, and what crosses is a name and
 * never a path.
 *
 * ## The page field SHOWS the page, and a hidden readout still ANNOUNCES it
 *
 * §10.3 asks for an editable "page ⁄ total" field. It read empty until 2026-09-14, beside a visible
 * "Page 4 of 10" readout, for a real reason: this footer is `role="status"`, and an `<input>` whose
 * value React updates fires no text mutation, so a field holding the page would stop the page being
 * announced. Both hold now: the field shows the current page until a person types, and the readout
 * is still text in the region — visually hidden, not removed — so it is still what a screen reader
 * hears change.
 *
 * ## A page outside the document is REFUSED, not clamped
 *
 * A typed 500 in a twelve-page document is not "the last page", and answering it with page 12
 * tells the reader their document has 500 pages. The navigation commands clamp, and are right to.
 *
 * ## §10.3's zoom order, exactly: zoom-out · slider · zoom-in · percentage · fit
 *
 * The slider and the percentage are both the bar's own, with a command between them, so the zoom
 * cluster has three gaps and the placement names one (ADR-0067's 2026-09-15 correction). Until then
 * the percentage sat beside the slider and zoom-in after it — a deviation from the approved design
 * that the type could not avoid.
 *
 * ## The chrome group renders only when something is in it
 *
 * It has no control of its own, so an empty group would be a named region holding nothing.
 */
export function StatusBar({
  name,
  page,
  pageCount,
  zoom,
  onGoTo,
  onZoom,
  registry,
  context,
  task,
  saved,
  byteLength,
  toolHint,
  tip,
}: {
  /** The document's name, as main stated it on `document.open`. */
  readonly name: string;
  /** Zero-based, as everything that crosses the contract is. */
  readonly page: number;
  readonly pageCount: number;
  /** The scale actually shown, which for a fit is what the scroller resolved. */
  readonly zoom: number;
  /** Takes the reader to a page. Zero-based, like every page that crosses. */
  readonly onGoTo: (page: number) => void;
  /** The zoom commands' own setter: from the scale shown to the mode wanted. */
  readonly onZoom: (next: (shown: number) => ZoomMode) => void;
  /** Where the bar's buttons are projected from. */
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  /** A long command reporting how far it has got, or nothing running. */
  readonly task: RunningTask | undefined;
  /**
   * Where this document stands against its file, already resolved.
   *
   * Computed by the caller rather than here, because `savedState` needs a clock and this
   * component must stay a function of its props — and because the tab's dot reads the same
   * answer, which is one comparison and not two (B3a).
   */
  readonly saved: SavedState;
  /** The document's size in bytes, as main stated it — v5-02 draws *"24 pages · 2.4 MB"*. */
  readonly byteLength: number;
  /**
   * What the tool that is on waits for (ADR-0154 Decision 4), or `undefined` for none. v5-02 draws the active tool's
   * line at the bar's start, so a person who pressed something can see what a press on the page does, and that Escape
   * stops it. The hint and not the tool's title: a title is written for its tooltip (*Hand — drag to move the pages*),
   * and the tool's own control already shows pressed.
   */
  readonly toolHint: MessageKey | undefined;
  /** The tip drawn in the start's free room (ADR-0159), or nothing. The bar places it and knows nothing of tips. */
  readonly tip?: ReactNode;
}): ReactElement {
  const { i18n } = useLingui();
  // `null` until a person types: the field then shows what they typed, and otherwise the page.
  const [typed, setTyped] = useState<string | null>(null);
  const [outside, setOutside] = useState(false);
  const fieldId = useId();
  const model = statusBarModel(registry, context);
  const end = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const ruler = useRef<HTMLSpanElement>(null);
  const [shownFacts, setShownFacts] = useState<ReadonlySet<DocumentFact>>(() => new Set(FACT_ORDER));

  /** The four facts as drawn — in the line, and the same elements in the ruler that measures them. */
  const facts: Readonly<Record<DocumentFact, ReactElement>> = {
    name: (
      <span className="m-status-name" title={name}>
        {name}
      </span>
    ),
    pages: <span>{i18n._(STATUS_PAGES, { count: pageCount })}</span>,
    size: <span>{byteSize(i18n, byteLength)}</span>,
    saved: (
      <span className="m-status-saved" data-dirty={saved.dirty ? 'true' : 'false'}>
        {i18n._(saved.message, saved.values)}
      </span>
    ),
  };

  // THE LINE'S ROOM, read after every render — a task's progress joining the end region takes from it without the
  // region changing size — and on every resize of the region or of the ruler, which a language or a name moves. The room
  // is the end region less its other controls and its gaps, so it does not depend on which facts are drawn.
  const measureFacts = useCallback((): void => {
    const region = end.current;
    const own = line.current;
    const names = ruler.current;
    if (region === null || own === null || names === null) return;
    const others = [...region.children].filter((child) => child !== own && child !== names);
    const regionGap = parseFloat(getComputedStyle(region).columnGap || '0');
    const room =
      region.clientWidth -
      others.reduce((sum, child) => sum + (child instanceof HTMLElement ? child.offsetWidth : 0), 0) -
      regionGap * others.length;
    const width = (fact: string): number => names.querySelector<HTMLElement>(`[data-ruler-fact="${fact}"]`)?.offsetWidth ?? 0;
    const style = getComputedStyle(own);
    const next = factsThatFit(
      { name: width('name'), pages: width('pages'), size: width('size'), saved: width('saved') },
      NAME_MIN_EM * parseFloat(style.fontSize),
      width('separator'),
      parseFloat(style.columnGap || '0'),
      room,
    );
    setShownFacts((was) => (was.size === next.size && [...next].every((fact) => was.has(fact)) ? was : next));
  }, []);
  // AFTER EVERY RENDER: no dependency list, because what moves the room — a task, a name, a count — is any prop.
  useLayoutEffect(measureFacts);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measureFacts);
    for (const element of [end.current, ruler.current]) if (element !== null) observer.observe(element);
    return (): void => {
      observer.disconnect();
    };
  }, [measureFacts]);

  const buttons = (entries: readonly OrderedEntry[]): ReactElement[] =>
    entries.flatMap((entry) => {
      const icon = entry.command.icon;
      // The registry refuses a command placed here without an icon, so this never skips one in a
      // registry that constructed; it keeps the type honest rather than asserting.
      if (icon === undefined) return [];
      return [
        <IconButton
          key={entry.command.id}
          icon={ICONS[icon]}
          label={entry.command.title}
          size="dense"
          pressed={entry.command.checked?.(context)}
          onClick={() => {
            // Not awaited, for `QuickToolbar`'s reason: nothing here reads the result.
            void entry.command.run(context);
          }}
        />,
      ];
    });

  return (
    <footer className="m-status-bar" role="status" aria-label={i18n._(STATUS_LABEL)} data-pane="status-bar">
      {/* THE ANNOUNCEMENT, as text in the status region, visually hidden. */}
      <span className="m-status-page m-visually-hidden">
        {i18n._(STATUS_PAGE_OF, { page: pdfjsPageOf(page), count: pageCount })}
      </span>
      {/* THREE REGIONS (the owner's 27 September list, item 5, over v5-02): what the tool is doing at the start, the
          page navigation at the CENTRE, and the document's line, the panel toggles and the zoom at the end. The outer
          two share the free width, so the centre is the bar's. */}
      <div className="m-status-start">
        {outside ? (
          <span className="m-status-problem">{i18n._(STATUS_GO_TO_OUTSIDE, { count: pageCount })}</span>
        ) : null}
        {/* WHAT THE TOOL THAT IS ON WAITS FOR, and nothing when none is. ONE sentence for the Escape, so the rule
            that it stops the tool is written once rather than in every tool's hint. */}
        {toolHint === undefined ? null : (
          <span className="m-status-mode">{i18n._(STATUS_TOOL_LINE, { hint: i18n._(toolHint) })}</span>
        )}
        {/* A TIP in the room left (ADR-0159), after what the tool waits for; hidden whole when it does not fit. */}
        {tip}
      </div>
      <div className="m-status-cluster m-status-centre" role="group" aria-label={i18n._(STATUS_NAVIGATION)}>
        {buttons(model.navigation.before)}
        <form
          className="m-status-goto"
          onSubmit={(event) => {
            event.preventDefault();
            if (typed === null) return;
            // THE ONE CONVERSION: a person types the number they can see, which is PDF.js's, and
            // `jumpTo` takes the kernel's. `pageNumbering.ts` is where the two meet.
            const wanted = Number(typed);
            if (!Number.isInteger(wanted) || wanted < 1 || wanted > pageCount) {
              setOutside(true);
              return;
            }
            setOutside(false);
            setTyped(null);
            onGoTo(kernelPageOf(wanted));
          }}
        >
          <label className="m-visually-hidden" htmlFor={fieldId}>
            {i18n._(STATUS_GO_TO)}
          </label>
          <input
            id={fieldId}
            // `data-goto-input` so `view.go-to` can send the caret here without this surface
            // exporting a ref through the registry.
            data-goto-input="true"
            // `inputMode` rather than `type="number"`, whose spinner and scroll-to-change are a
            // hazard in a bar a reader scrolls past. Validated on submit either way.
            inputMode="numeric"
            value={typed ?? String(pdfjsPageOf(page))}
            aria-invalid={outside}
            onFocus={(event) => {
              event.target.select();
            }}
            onChange={(event) => {
              setTyped(event.target.value);
              // CLEARED ON EDIT: a refusal that stayed while the number was corrected would still
              // be on screen when Enter was pressed on a page that exists.
              setOutside(false);
            }}
            onBlur={() => {
              // Leaving the field without submitting puts the page back, rather than leaving a
              // number on screen that is not where the reader is.
              if (!outside) setTyped(null);
            }}
          />
          <span className="m-status-total">{i18n._(STATUS_PAGE_TOTAL, { count: pageCount })}</span>
        </form>
        {buttons(model.navigation.after)}
      </div>
      <div className="m-status-end" ref={end}>
        {/* THE DOCUMENT ITSELF, on the zoom's side as v5-02 draws it: its name, its length, its size, and whether it
            is on disk — the four facts about the file rather than the view, in one line with the design's separators. */}
        {/* WHOLE FACTS ONLY (`statusFacts.ts`): a line too narrow for all four gives up the size, then the length,
            then the name, and keeps whether the document is saved. */}
        <span className="m-status-document" ref={line}>
          {FACT_ORDER.filter((fact) => shownFacts.has(fact)).map((fact, index) => (
            <Fragment key={fact}>
              {index === 0 ? null : <span aria-hidden="true">·</span>}
              {facts[fact]}
            </Fragment>
          ))}
        </span>
        {model.chrome.length === 0 ? null : (
          <div className="m-status-cluster" role="group" aria-label={i18n._(STATUS_CHROME_GROUP)}>
            {buttons(model.chrome)}
          </div>
        )}
        <div className="m-status-cluster" role="group" aria-label={i18n._(STATUS_ZOOM_GROUP)}>
          {buttons(model.zoom.before)}
          <input
            className="m-status-zoom-slider"
            type="range"
            aria-label={i18n._(STATUS_ZOOM_SLIDER)}
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step={SLIDER_STEP}
            // THE SCALE SHOWN, which for a fit is what the scroller resolved; moving the slider leaves
            // the fit for that scale, as the zoom buttons do.
            value={Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, zoom))}
            onChange={(event) => {
              const scale = Number(event.target.value);
              if (!Number.isFinite(scale)) return;
              onZoom(() => ({ kind: 'scale', scale }));
            }}
          />
          {buttons(model.zoom.between)}
          <span className="m-status-zoom">
            {/* ROUNDED FOR DISPLAY ONLY: derived from the live scale, never stored. */}
            {i18n._(STATUS_ZOOM, { percent: Math.round(zoom * 100) })}
          </span>
          {buttons(model.zoom.after)}
        </div>
        {/* THE RUNNING TASK, absent rather than empty when nothing is running, and last, so the
            numbers a reader checks do not move sideways while one runs. */}
        {task === undefined ? null : (
          <span className="m-status-task" data-status-task={String(task.done)}>
            {i18n._(TASK_PROGRESS, {
              label: i18n._(task.label),
              done: task.done,
              total: task.total,
            })}
            <button className="m-status-cancel" onClick={task.cancel} type="button">
              {i18n._(TASK_CANCEL)}
            </button>
          </span>
        )}
        {/* THE LINE'S RULER: each fact whole and the dot between two, under the line's own rule, out of the region's
            flow and out of reach, so the room is read against every fact's width whatever is shown. Last, so the
            line's neighbour is still the control beside it. */}
        <span className="m-status-document__ruler" ref={ruler} aria-hidden="true" inert>
          {FACT_ORDER.map((fact) => (
            <span data-ruler-fact={fact} key={fact}>
              {facts[fact]}
            </span>
          ))}
          <span data-ruler-fact="separator">·</span>
        </span>
      </div>
    </footer>
  );
}
