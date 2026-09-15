import { useLingui } from '@lingui/react';
import { type ReactElement, useEffect, useRef, useState } from 'react';

import {
  RIBBON_RAIL_LABEL,
  RIBBON_TOOLS_LABEL,
  SECTION_COMMENT,
  SECTION_EDIT,
  SECTION_FORMS,
  SECTION_HOME,
  SECTION_ORGANIZE,
  SECTION_PROTECT,
  SECTION_REVIEW,
  SECTION_TOOLS,
} from '../messages/en.js';
import type { MessageKey } from '@monstera/shared';
import { Icon } from '../primitives/Icon.js';
import type { IconName } from '../primitives/icons.js';
import { ToolButton } from '../primitives/ToolButton.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import { SECTION_IDS, type SectionId } from '../registries/placement.js';
import { LAYOUT_MODE_SETTING, RIBBON_SECTION_SETTING } from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { useSetting } from '../useSetting.js';
import { type RibbonSection, ribbonModel } from './projections.js';

/**
 * §10.3's left section rail and top tool ribbon, as one **projection**.
 *
 * ## Why the rail and the ribbon are one component
 *
 * §10.3 describes them as two pieces of anatomy — *"Left section rail: the eight
 * feature sections … Selecting a section populates the top tool ribbon"* — and
 * they share exactly one thing: which section is active. Splitting them would
 * put that state above both, in a component whose only job is to hold it, and
 * every reader would then have to find out whether anything else consults it.
 * Nothing does.
 *
 * ## It names no command
 *
 * `ribbonModel(...)` decides what appears and in what order; this decides how it
 * looks. A hand-written list of ids here would be the second wiring place §7
 * forbids, which is what `check:secondwiring` scans this directory for.
 *
 * ## Every section is in the rail, and a section with no tools is DISABLED
 *
 * `projections.ts` already decided the first half: the sections come from
 * `SECTION_IDS` rather than from the placements found, *"because the rail shows
 * all eight whether or not a section currently has tools — a section that
 * vanished when its commands were unavailable would be a layout that moves
 * under the user."*
 *
 * The second half is this component's and it is the honest reading of §10.4's
 * ban on a control that does nothing. A section with no groups today is not a
 * surface under construction to be hidden; it is a section of the product that
 * has not been built yet, and a rail that showed seven entries this week and
 * eight next week teaches the user that the layout is unreliable. So the entry
 * is present and `disabled`, which says *this exists and holds nothing* — a
 * thing a person can read — rather than either lying or moving.
 *
 * **This is expected to be temporary and is not a placeholder.** As stages land,
 * sections fill; the disabled state is derived from the model on every render,
 * so nothing has to be revisited when they do.
 *
 * ## The active section is a SETTING, and the layout mode decides only how the tools are shown
 *
 * §10.3: *"The rail's state model is identical in every mode: the active section persists, and selecting a section —
 * including re-selecting the current one — is what opens the overlay in Studio. One state model, two presentations."*
 * So `appearance.ribbon-section` is the one owner of which section is active — component state until 2026-09-15, waiting
 * for exactly this — and `appearance.layout-mode` decides the presentation:
 *
 * - **Ribbon** — the tools strip is in the grid, always.
 * - **Studio** — the strip is hidden; selecting a section opens it as a temporary overlay, dismissed on a tool choice,
 *   Escape, or a press outside both the overlay and the rail.
 * - **Focus** — neither rail nor strip is drawn. Capability stays: every command is still in the palette and on its
 *   chord.
 *
 * A stored section that holds nothing still falls back to the first filled one, below, so a persisted choice can never
 * leave the ribbon showing an empty strip.
 */
export interface RibbonProps {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  /** Where the active section and the layout mode live. */
  readonly settings: SettingsStore;
}

/**
 * A section's visible name.
 *
 * A total record rather than a lookup with a fallback: `SectionId` is a closed
 * union, so a ninth section is a compile error here — which is where a missing
 * translation should be found, rather than at runtime as a rail entry labelled
 * with its own id.
 */
const SECTION_TITLES: Readonly<Record<SectionId, MessageKey>> = {
  home: SECTION_HOME,
  comment: SECTION_COMMENT,
  edit: SECTION_EDIT,
  organize: SECTION_ORGANIZE,
  forms: SECTION_FORMS,
  review: SECTION_REVIEW,
  protect: SECTION_PROTECT,
  tools: SECTION_TOOLS,
};

/**
 * A section's glyph on the rail (§10.3: *"the eight feature sections … as labeled
 * icons"*). A total record for `SECTION_TITLES`' reason: a ninth section is a
 * compile error here.
 */
const SECTION_ICONS: Readonly<Record<SectionId, IconName>> = {
  home: 'House',
  comment: 'MessageSquare',
  edit: 'PenLine',
  organize: 'Files',
  forms: 'ClipboardList',
  review: 'ClipboardCheck',
  protect: 'Shield',
  tools: 'Wrench',
};

export function Ribbon({ registry, context, settings }: RibbonProps): ReactElement | null {
  const { i18n } = useLingui();
  const chosen = useSetting(settings, RIBBON_SECTION_SETTING);
  const mode = useSetting(settings, LAYOUT_MODE_SETTING);
  // STUDIO'S OVERLAY IS PRESENTATION, not state that persists: a reopened window starts with it shut.
  const [overlay, setOverlay] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);

  // CLICK-AWAY AND ESCAPE, only while Studio's overlay is open. A press on the rail is not "away": selecting a section
  // is what opens the overlay, so it must not also close it.
  //
  // ESCAPE IS HEARD ON THE DOCUMENT, not on the overlay, because that is where focus is when a person presses it: the
  // rail button they just clicked. A handler on the overlay passed a unit case that fired the key AT the overlay and
  // failed in the production build (2026-09-15), where no real key press lands there. No command claims Escape in
  // Studio — `view.leave-focus` exists only in Focus — so nothing else competes for the key.
  useEffect(() => {
    if (mode !== 'studio' || !overlay) return undefined;
    const away = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (overlayRef.current?.contains(target) === true || railRef.current?.contains(target) === true) return;
      setOverlay(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOverlay(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return (): void => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [mode, overlay]);
  const sections = ribbonModel(registry, context);
  const filled = sections.filter((section) => section.groups.length > 0);

  // NOTHING AT ALL when no section holds anything, which is `QuickToolbar`'s
  // rule: an eight-entry rail of disabled buttons over a start screen is a
  // surface that looks broken rather than empty. The model is what is asked,
  // never whether a document is open — a surface consulting application state
  // would be deciding its own contents.
  if (filled.length === 0) return null;
  // FOCUS draws neither rail nor strip (§10.3); the commands stay registered, reachable from the palette and chords.
  if (mode === 'focus') return null;

  // THE CHOSEN SECTION ONLY IF IT STILL HOLDS SOMETHING. A section can empty
  // out under the reader — every command in it declares `when`, and closing a
  // document takes them all — and a ribbon that then showed nothing beside a
  // rail with a selected entry would read as broken rather than as empty.
  const active =
    filled.find((section) => section.section === chosen)?.section ?? filled[0]?.section;

  return (
    // `display: contents` on this root, in `app.css`. The rail and the tool strip
    // are two pieces of §10.3's anatomy in two places — the rail down the left
    // beside the document, the tools across the top — and one component still
    // owns the one piece of state they share. Their grid areas are the shell's,
    // so this component never learns where the shell puts them.
    <div className="m-ribbon">
      <nav aria-label={i18n._(RIBBON_RAIL_LABEL)} className="m-ribbon__rail" ref={railRef}>
        {SECTION_IDS.map((id) => {
          const has = filled.some((section) => section.section === id);
          return (
            <button
              aria-current={id === active ? 'true' : undefined}
              className={id === active ? 'm-ribbon__tab is-active' : 'm-ribbon__tab'}
              data-ribbon-section={id}
              disabled={!has}
              key={id}
              onClick={() => {
                settings.set(RIBBON_SECTION_SETTING.id, id);
                // Re-selecting the current section opens the overlay too: §10.3 names that case.
                if (mode === 'studio') setOverlay(true);
              }}
              type="button"
            >
              <Icon name={SECTION_ICONS[id]} size="control" />
              <span className="m-ribbon__tab-label">{i18n._(SECTION_TITLES[id])}</span>
            </button>
          );
        })}
      </nav>
      {mode === 'ribbon' || overlay ? (
      <div
        aria-label={i18n._(RIBBON_TOOLS_LABEL)}
        className={mode === 'studio' ? 'm-ribbon__tools m-ribbon__tools--overlay' : 'm-ribbon__tools'}
        data-ribbon-active={active}
        ref={overlayRef}
        role="toolbar"
      >
        {groupsOf(sections, active).map((group) => (
          <div className="m-ribbon__group" key={group.group}>
            <div className="m-ribbon__buttons">
              {group.entries.map((entry) => (
                <ToolButton
                  key={entry.command.id}
                  // THE REGISTRY GUARANTEES IT: a command placed on the ribbon with no
                  // icon is refused at construction, so `File` is never drawn for a
                  // command in the shipped graph.
                  icon={entry.command.icon ?? 'File'}
                  label={entry.command.title}
                  onClick={() => {
                    // Not awaited, for `QuickToolbar`'s reason: a handler
                    // returning a promise would make React's event handling
                    // wait on IPC, and nothing here reads the result.
                    void entry.command.run(context);
                    // A TOOL CHOICE DISMISSES STUDIO'S OVERLAY (§10.3).
                    if (mode === 'studio') setOverlay(false);
                  }}
                />
              ))}
            </div>
            {/* THE CAPTION UNDER THE BUTTONS, which is where §10.3 puts it —
                "captioned groups". It is not a heading: the group name labels a
                cluster of controls inside a toolbar, and a heading there would
                put a document outline inside a toolbar for a screen reader.

                Resolved through the catalogue, which is what the 2026-09-08
                amendment to §7 is for — this line rendered the group's id until
                `group` became a `MessageKey`, and no lint rule could see it. */}
            <div className="m-ribbon__caption">{i18n._(group.group)}</div>
          </div>
        ))}
      </div>
      ) : null}
    </div>
  );
}

/** One section's groups, or none when it is not in the model. */
function groupsOf(
  sections: readonly RibbonSection[],
  active: SectionId | undefined,
): RibbonSection['groups'] {
  return sections.find((section) => section.section === active)?.groups ?? [];
}
