import { Menu } from '@base-ui/react/menu';
import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { RIBBON_MORE } from '../messages/en.js';
import { Icon } from '../primitives/Icon.js';
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
}: {
  readonly entries: readonly OrderedEntry[];
  readonly context: CommandContext;
  /** Told after a command runs, so Studio's overlay dismisses as it does for any tool. */
  readonly onChosen: () => void;
}): ReactElement {
  const { i18n } = useLingui();

  return (
    <Menu.Root>
      <Menu.Trigger className="m-tool-button m-ribbon__more" nativeButton>
        <Icon name="Ellipsis" size="ribbon" />
        <span className="m-tool-button__label">{i18n._(RIBBON_MORE)}</span>
        <Icon name="ChevronDown" size="dense" />
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
