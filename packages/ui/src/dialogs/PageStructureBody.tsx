import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  PAGE_STRUCTURE_IMAGES,
  PAGE_STRUCTURE_LINES,
  PAGE_STRUCTURE_PAGE,
  PAGE_STRUCTURE_REFUSED,
  PAGE_STRUCTURE_TRUNCATED,
  PAGE_STRUCTURE_UNTAGGED,
  PAGE_STRUCTURE_UNTAGGED_LINES,
} from '../messages/en.js';

/** One element, as the dialog's props carry it. */
interface ShownNode {
  readonly role: string;
  readonly raw: string;
  readonly depth: number;
  readonly lines: number;
}

type PageStructureProps =
  | {
      readonly kind: 'read';
      readonly page: number;
      readonly nodes: readonly ShownNode[];
      readonly truncated: boolean;
      readonly untaggedLines: number;
      readonly images: number;
    }
  | { readonly kind: 'refused'; readonly page: number };

/**
 * The reading-order inspection's body.
 *
 * ## The list IS the reading order
 *
 * The elements arrive in tree order, which is the order a tagged document tells a
 * screen reader to follow, so the list is shown as it came and never re-sorted.
 * Indentation is the depth and nothing else — `DestinationsPanel`'s rule, for its
 * reason: a flat list with an indent is what crossed, and rebuilding a tree here
 * would be a walk in a surface for an effect one property gives.
 *
 * ## It does not say whether the order is RIGHT
 *
 * A tree that disagrees with how the page is drawn may be a well-tagged
 * multi-column page or a badly tagged one. Measured 2026-09-14, the engine's lines
 * also break differently under the structure read on 8 of 12 tagged corpus pages,
 * so no line-by-line comparison can separate the two either (ADR-0065's
 * correction). The body shows the tagging and leaves the judgement to the reader.
 *
 * ## Three things are said beside the list, because each is a finding
 *
 * No elements (an untagged page), lines inside no element (content the tags left
 * out), and images (a page tagged only as a figure is not an empty page).
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function PageStructureBody(props: PageStructureProps): ReactElement {
  const { _, i18n } = useLingui();
  const format = new Intl.NumberFormat(i18n.locale);
  const count = (value: number): string => format.format(value);

  if (props.kind === 'refused') {
    return (
      <p className="m-page-structure" data-refused="true">
        {_(PAGE_STRUCTURE_REFUSED, { page: count(props.page) })}
      </p>
    );
  }

  return (
    <div className="m-page-structure">
      <p>{_(PAGE_STRUCTURE_PAGE, { page: count(props.page) })}</p>
      {props.nodes.length === 0 ? (
        <p data-untagged="true">{_(PAGE_STRUCTURE_UNTAGGED)}</p>
      ) : (
        <ol className="m-page-structure__list">
          {props.nodes.map((node, at) => (
            // THE POSITION IS THE KEY: two paragraphs at the same depth share
            // every field, and the order is what this list exists to show.
            <li
              key={at}
              className="m-page-structure__row"
              data-depth={node.depth}
              style={{ paddingInlineStart: `${String(node.depth * INDENT)}px` }}
            >
              <span className="m-page-structure__role">{node.role === '' ? node.raw : node.role}</span>
              {node.role !== '' && node.raw !== node.role ? (
                <span className="m-page-structure__raw">{node.raw}</span>
              ) : null}
              <span className="m-page-structure__lines">
                {_(PAGE_STRUCTURE_LINES, { count: node.lines })}
              </span>
            </li>
          ))}
        </ol>
      )}
      {props.untaggedLines > 0 ? (
        <p data-untagged-lines="true">
          {_(PAGE_STRUCTURE_UNTAGGED_LINES, { count: props.untaggedLines })}
        </p>
      ) : null}
      {props.images > 0 ? <p>{_(PAGE_STRUCTURE_IMAGES, { count: props.images })}</p> : null}
      {props.truncated ? <p data-truncated="true">{_(PAGE_STRUCTURE_TRUNCATED)}</p> : null}
    </div>
  );
}

/** Pixels of indentation per level, `DestinationsPanel`'s figure. */
const INDENT = 12;
