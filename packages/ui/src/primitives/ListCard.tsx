import type { ReactElement, ReactNode } from 'react';

/**
 * One item of a left-panel list, in its own closed box (the owner's E2): a rounded, bordered card with the panel's
 * spacing, its hover and its selected state, in every theme.
 *
 * ## One component, so the lists cannot drift apart
 *
 * The Fields, Comments, Layers and Links lists each drew their rows their own way. A card is a style several lists
 * share, so it lives here once (B3a): a list takes this element for its rows and keeps its own row class for what is
 * particular to it. `selected` is a prop rather than a class a caller remembers, so a selected card looks the same in
 * every list; a caller's own data attributes pass through, so its tests and its read of a row are unchanged.
 *
 * It draws a box and nothing else: what a press on the item does stays with the controls inside it, so keyboard focus,
 * names and roles are the list's as they were.
 */
export function ListCard({
  className,
  selected,
  children,
  ...rest
}: {
  /** The list's own row class, beside the card's. */
  readonly className?: string | undefined;
  /** Whether the item is chosen in its list. */
  readonly selected: boolean;
  /** A list whose chosen item is a POSITION a reader is at (the find bar's current match) says so to a screen reader. */
  readonly 'aria-current'?: 'true' | undefined;
  readonly children: ReactNode;
} & Readonly<Record<`data-${string}`, string | undefined>>): ReactElement {
  return (
    <li {...rest} className={className === undefined ? 'm-list-card' : `m-list-card ${className}`} data-list-card-selected={selected ? 'true' : undefined}>
      {children}
    </li>
  );
}
