import { useLingui } from '@lingui/react';
import { type ReactElement, useState } from 'react';

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
import { Button } from '../primitives/Button.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import { SECTION_IDS, type SectionId } from '../registries/placement.js';
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
 * ## The active section is component state, not a setting — yet
 *
 * §10.3 says the active section persists per user, and that is a settings-
 * registry entry. It is deliberately not registered here: persistence belongs
 * with the layout switcher (Ribbon · Studio · Focus), which shares the same
 * state model — *"the rail's state model is identical in every mode"* — and
 * registering a key now would mean a second decision about what persists when
 * the switcher lands. The trigger is the switcher, which is Stage 10's.
 */
export interface RibbonProps {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
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

export function Ribbon({ registry, context }: RibbonProps): ReactElement | null {
  const { i18n } = useLingui();
  const [chosen, setChosen] = useState<SectionId | undefined>(undefined);
  const sections = ribbonModel(registry, context);
  const filled = sections.filter((section) => section.groups.length > 0);

  // NOTHING AT ALL when no section holds anything, which is `QuickToolbar`'s
  // rule: an eight-entry rail of disabled buttons over a start screen is a
  // surface that looks broken rather than empty. The model is what is asked,
  // never whether a document is open — a surface consulting application state
  // would be deciding its own contents.
  if (filled.length === 0) return null;

  // THE CHOSEN SECTION ONLY IF IT STILL HOLDS SOMETHING. A section can empty
  // out under the reader — every command in it declares `when`, and closing a
  // document takes them all — and a ribbon that then showed nothing beside a
  // rail with a selected entry would read as broken rather than as empty.
  const active =
    filled.find((section) => section.section === chosen)?.section ?? filled[0]?.section;

  return (
    <div className="m-ribbon">
      <nav aria-label={i18n._(RIBBON_RAIL_LABEL)} className="m-ribbon__rail">
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
                setChosen(id);
              }}
              type="button"
            >
              {i18n._(SECTION_TITLES[id])}
            </button>
          );
        })}
      </nav>
      <div
        aria-label={i18n._(RIBBON_TOOLS_LABEL)}
        className="m-ribbon__tools"
        data-ribbon-active={active}
        role="toolbar"
      >
        {groupsOf(sections, active).map((group) => (
          <div className="m-ribbon__group" key={group.group}>
            <div className="m-ribbon__buttons">
              {group.entries.map((entry) => (
                <Button
                  key={entry.command.id}
                  label={entry.command.title}
                  onClick={() => {
                    // Not awaited, for `QuickToolbar`'s reason: a handler
                    // returning a promise would make React's event handling
                    // wait on IPC, and nothing here reads the result.
                    void entry.command.run(context);
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
