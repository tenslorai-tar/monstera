import { Menu } from '@base-ui/react/menu';
import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import { RIBBON_MORE } from '../messages/en.js';
import { Icon } from '../primitives/Icon.js';
import type { IconName } from '../primitives/icons.js';
import type { CommandContext } from '../registries/commands.js';
import type { OrderedEntry } from './projections.js';

/**
 * One ribbon group's *More* — the buttons that did not fit, in a menu (the owner's design,
 * `document-light-narrow.png`, 2026-09-22).
 *
 * ## It names no command either
 *
 * It is handed the entries the fold hid, so the overflow is a **view of the same projection** rather
 * than a second list. A command cannot be in a *More* without being in its group, which is the
 * property that makes folding a presentation decision rather than a second wiring place.
 *
 * ## The same shape as the button it replaces
 *
 * It draws as a `ToolButton` does — glyph over label, the group's own row — so a folded group reads
 * as a group with one more tool rather than as a control from somewhere else. The label is a word
 * and not an ellipsis glyph alone: *More* is what it is, and a bare `⋯` is an icon-only control that
 * would need a tooltip to say the same thing.
 */
export function RibbonMore({
  entries,
  context,
  onChosen,
  named,
  widthFolded,
}: {
  readonly entries: readonly OrderedEntry[];
  readonly context: CommandContext;
  /** Told after a command runs, so Studio's overlay dismisses as it does for any tool. */
  readonly onChosen: () => void;
  /**
   * A NAMED menu (ADR-0101): its caption, its glyph, and the command id the row measures it by.
   * Absent, this is the group's *More*. One component for both, so a named menu and *More* cannot
   * drift apart in how they open, what their items are named, or how a keyboard reaches them.
   */
  readonly named?: { readonly label: MessageKey; readonly icon: IconName; readonly measuredAs: string };
  /**
   * How many of a *More*'s entries are primaries the WIDTH folded, as opposed to secondaries, which
   * are in it at every width (ADR-0098). Written on the trigger so a layout check can tell *this row
   * did not fit* from *this group has secondaries* — the same button either way.
   */
  readonly widthFolded?: number;
}): ReactElement {
  const { i18n } = useLingui();

  return (
    <Menu.Root>
      <Menu.Trigger
        className={named === undefined ? 'm-tool-button m-ribbon__more' : 'm-tool-button m-ribbon__menu'}
        data-command={named?.measuredAs}
        data-width-folded={widthFolded === undefined ? undefined : String(widthFolded)}
        nativeButton
      >
        <MoreFace icon={named?.icon ?? 'Ellipsis'} label={i18n._(named?.label ?? RIBBON_MORE)} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" side="bottom">
          <Menu.Popup className="m-context-menu">
            {entries.map((entry) => (
              <Menu.Item
                key={entry.command.id}
                className="m-context-menu-item"
                data-command={entry.command.id}
                label={i18n._(entry.command.title)}
                onClick={() => {
                  // Not awaited, for `QuickToolbar`'s reason: nothing here reads the result.
                  void entry.command.run(context);
                  onChosen();
                }}
              >
                <span>{i18n._(entry.command.title)}</span>
                {entry.command.shortcut === undefined ? null : (
                  <span className="m-context-menu-chord">{entry.command.shortcut}</span>
                )}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** What a *More* draws: ONE definition, so the gauge below cannot measure a different face. */
function MoreFace({ label, icon }: { readonly label: string; readonly icon: IconName }): ReactElement {
  return (
    <>
      <Icon name={icon} size="ribbon" />
      {/* THE LABEL AND ITS CHEVRON ON ONE LINE, which is how the design draws it. A tool button is
          a column — glyph over caption — so a third child would be a third row, and the chevron
          would sit under the word instead of beside it. */}
      <span className="m-tool-button__label m-ribbon__more-label">
        {label}
        <Icon name="ChevronDown" size="chrome" />
      </span>
    </>
  );
}

/**
 * A *More* that is never seen, drawn so the fold knows a More's width before it has folded anything.
 *
 * ## Why the fold cannot wait for a real one
 *
 * A More exists only once a group is folded, and deciding the fold needs its width. The stand-in used
 * until 2026-09-24 was the widest button in the row, which is wrong both ways: on the Comment ribbon it
 * was *Measure perimeter*, twice a More, so every folded group was charged double and the row folded
 * about 200 px too far at 1024 px; and a group whose floor with that stand-in exceeded its natural
 * width was never folded at all. Measuring a real face removes the unmeasured state rather than
 * guessing through it.
 *
 * `aria-hidden` and `visibility: hidden` keep it out of the accessibility tree and off the screen; it
 * is a span, not a button, so there is nothing to focus.
 */
export function RibbonMoreGauge(): ReactElement {
  const { i18n } = useLingui();
  return (
    <span aria-hidden="true" className="m-tool-button m-ribbon__more m-ribbon__more-gauge">
      <MoreFace icon="Ellipsis" label={i18n._(RIBBON_MORE)} />
    </span>
  );
}
