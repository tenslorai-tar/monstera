import { useLingui } from '@lingui/react';
import { type ReactElement, useId, useState } from 'react';

import {
  STATUS_GO_TO,
  STATUS_GO_TO_OUTSIDE,
  STATUS_LABEL,
  STATUS_NAVIGATION,
  STATUS_PAGE_OF,
  STATUS_PAGE_TOTAL,
  STATUS_ZOOM,
  STATUS_ZOOM_GROUP,
  STATUS_ZOOM_SLIDER,
  TASK_CANCEL,
  TASK_PROGRESS,
} from '../messages/en.js';
import { kernelPageOf, pdfjsPageOf } from '../pageNumbering.js';
import { ICONS } from '../primitives/icons.js';
import { IconButton } from '../primitives/IconButton.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import type { RunningTask } from '../runningTask.js';
import { ZOOM_STEPS, type ZoomMode } from '../zoom.js';
import { statusBarModel, type OrderedEntry } from './projections.js';

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
 * ## The percentage sits BESIDE THE SLIDER
 *
 * §10.3 lists "slider · zoom-in button · current percentage". ADR-0067 gives each cluster ONE value
 * control, so the percentage — a readout of the slider's value — is rendered with it, and zoom-in
 * follows. The order therefore reads zoom-out · slider · percentage · zoom-in · fit; the deviation
 * from §10.3's list is stated here and in the journal rather than hidden in a position.
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
}): ReactElement {
  const { i18n } = useLingui();
  // `null` until a person types: the field then shows what they typed, and otherwise the page.
  const [typed, setTyped] = useState<string | null>(null);
  const [outside, setOutside] = useState(false);
  const fieldId = useId();
  const model = statusBarModel(registry, context);

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
          onClick={() => {
            // Not awaited, for `QuickToolbar`'s reason: nothing here reads the result.
            void entry.command.run(context);
          }}
        />,
      ];
    });

  return (
    <footer className="m-status-bar" role="status" aria-label={i18n._(STATUS_LABEL)}>
      {/* FIRST, at the far end from the numbers: which document this is. */}
      <span className="m-status-name" title={name}>
        {name}
      </span>
      {/* THE ANNOUNCEMENT, as text in the status region, visually hidden. */}
      <span className="m-status-page m-visually-hidden">
        {i18n._(STATUS_PAGE_OF, { page: pdfjsPageOf(page), count: pageCount })}
      </span>
      <div className="m-status-cluster" role="group" aria-label={i18n._(STATUS_NAVIGATION)}>
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
      {outside ? (
        <span className="m-status-problem">{i18n._(STATUS_GO_TO_OUTSIDE, { count: pageCount })}</span>
      ) : null}
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
    </footer>
  );
}
