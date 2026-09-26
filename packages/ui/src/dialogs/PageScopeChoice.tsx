import type { ReactElement } from 'react';

import { PAGE_SCOPE_ALL, PAGE_SCOPE_LABEL, PAGE_SCOPE_TARGET } from '../messages/en.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';

/**
 * *These pages* or *All pages* — the scope of a dialog that changes pages.
 *
 * ## One control, because seven dialogs drew it and each drew it the same way
 *
 * Crop, resize, header and footer, Bates numbers, watermark, transitions and text recognition each held the same
 * two-button fieldset with its own pair of messages, all reading *This page* and *All pages*. The Organize grid made
 * the first of those a set (ADR-0104: a page command acts on `targetPages`), and seven copies of a label that has to
 * learn a count is seven places for one of them not to (B3a).
 *
 * ## The segmented control, not two buttons
 *
 * The copies were two `Button`s whose chosen one was drawn `primary` — the state existed only as a style, with no
 * `aria-pressed` and a fieldset with no name, so a screen reader heard two buttons and no choice (WCAG 1.3.1 and
 * 4.1.2; the WCAG 2.2 review of 2026-09-26). `SegmentedControl` is the primitive for *one of a few values*: a named
 * group, a pressed state on each segment, arrow keys between them.
 *
 * @param pages the pages the command was opened for — `targetPages`, zero-based; the first label counts them
 * @param every whether *All pages* is the one chosen
 */
export function PageScopeChoice({
  pages,
  every,
  onChange,
  className,
}: {
  readonly pages: readonly number[];
  readonly every: boolean;
  readonly onChange: (every: boolean) => void;
  readonly className: string;
}): ReactElement {
  return (
    <div className={className}>
      <SegmentedControl<'target' | 'all'>
        label={PAGE_SCOPE_LABEL}
        options={[
          { value: 'target', label: PAGE_SCOPE_TARGET, values: { count: pages.length } },
          { value: 'all', label: PAGE_SCOPE_ALL },
        ]}
        value={every ? 'all' : 'target'}
        onChange={(next) => {
          onChange(next === 'all');
        }}
      />
    </div>
  );
}
