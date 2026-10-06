import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { type ReactElement, useEffect, useState } from 'react';

import {
  DESTINATIONS_EMPTY,
  DESTINATIONS_LABEL,
  DESTINATIONS_TRUNCATED,
  DESTINATIONS_UNAVAILABLE,
  DESTINATION_UNRESOLVED,
} from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { readWholeList } from './readWholeList.js';

/**
 * The document's outline — its named destinations, as a reader would recognise
 * them.
 *
 * ## Read ONCE PER DOCUMENT, unlike the links panel beside it
 *
 * An outline is a property of the document, so the effect is keyed on the
 * document rather than on the page. The links panel re-asks on every page
 * change because its answer is per page; asking for the outline again on each
 * scroll would be the same round trip for the same answer, and the shapes
 * differ because the questions do.
 *
 * ## An entry with NO PAGE is still shown
 *
 * `page: null` means the entry names no page here — an external URI, one the
 * document does not define, or none at all. It is rendered without a control,
 * the way an external link is: a gap in a table of contents is more confusing
 * than an entry that cannot be followed, and a button that did nothing would be
 * the display-only defect. One with entries under it is a heading and reads as
 * one; only a leaf is marked as going nowhere.
 *
 * ## The depth is INDENTATION and nothing else
 *
 * The panel does not rebuild the tree. A flat list with an indent is what the
 * kernel hands over and what a reader sees; reconstructing nesting here would
 * put a tree walk in a surface for a visual effect one CSS property gives.
 */
export function DestinationsPanel({
  client,
  docId,
  version,
  onJump,
}: {
  readonly client: ContractClient;
  /** `undefined` with no document open, which renders nothing. */
  readonly docId: DocId | undefined;
  /**
   * The open document's version.
   *
   * Present so the outline is re-read when the document moves: a command that
   * rewrites the page tree can change which page an entry resolves to, and an
   * outline describing the previous version would send a reader to the wrong
   * place with nothing to show it had.
   */
  readonly version: DocVersion | undefined;
  /** Takes the reader to a page, recording the jump. */
  readonly onJump: (page: number) => void;
}): ReactElement | null {
  const { i18n } = useLingui();
  const [state, setState] = useState<PanelState>({ kind: 'idle' });

  useEffect(() => {
    if (docId === undefined || version === undefined) return;
    let cancelled = false;

    void readWholeList(
      (from) => client['document.destinations']({ docId, from }),
      (part) => part.destinations,
    ).then(
      (answer) => {
        if (cancelled) return;
        setState(
          answer.ok
            ? { kind: 'outline', docId, destinations: answer.value.items, truncated: answer.value.last.truncated }
            : { kind: 'unavailable', docId },
        );
      },
      () => {
        if (!cancelled) setState({ kind: 'unavailable', docId });
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [client, docId, version]);

  // KEYED ON THE DOCUMENT, for the links panel's reason one axis over: an
  // outline held from the previous document would offer a reader headings from
  // a file they closed, and those look exactly like the current one's.
  if (docId === undefined || state.kind === 'idle' || state.docId !== docId) return null;

  return (
    <nav className="m-destinations" aria-label={i18n._(DESTINATIONS_LABEL)}>
      {state.kind === 'unavailable' ? (
        <p className="m-destinations-empty">{i18n._(DESTINATIONS_UNAVAILABLE)}</p>
      ) : state.destinations.length === 0 ? (
        <p className="m-destinations-empty">{i18n._(DESTINATIONS_EMPTY)}</p>
      ) : (
        <ul className="m-destinations-list">
          {state.destinations.map((entry, at) => {
            // BOUND TO A LOCAL, and this is the compiler being right rather
            // than pedantic: TypeScript does not carry a narrowing of a
            // PROPERTY into a closure, because nothing stops the object being
            // written between the check and the call. A `const` cannot be, so
            // the click handler below holds a number rather than a maybe.
            const page = entry.page;
            // A HEADING OVER CHILDREN: no page of its own, and the entry after it sits under it. It is the outline's
            // structure, not an entry going nowhere — a delete keeps one this way when the page it named goes and its
            // children stay (ADR-0155), and drawing it as unresolved would put back the dead entry the delete removed.
            const heading = page === null && (state.destinations[at + 1]?.depth ?? -1) > entry.depth;
            return (
              // THE INDEX IS THE KEY, and it is right here for the links
              // panel's reason: outline entries have no identity of their own,
              // the list is replaced whole, and two headings may legitimately
              // share a title at the same depth.
              <li key={at} style={{ paddingInlineStart: `${String(entry.depth * INDENT)}px` }}>
                {heading ? (
                  <span className="m-destination-heading">{entry.title}</span>
                ) : page === null ? (
                  <span className="m-destination-unresolved">
                    {i18n._(DESTINATION_UNRESOLVED, { title: entry.title })}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="m-destination"
                    onClick={() => {
                      onJump(page);
                    }}
                  >
                    <span className="m-destination-title">{entry.title}</span>
                    <span className="m-destination-page">{pdfjsPageOf(page)}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {state.kind === 'outline' && state.truncated ? (
        <p className="m-destinations-empty">{i18n._(DESTINATIONS_TRUNCATED)}</p>
      ) : null}
    </nav>
  );
}

/** How far one level of nesting indents, in CSS pixels. */
const INDENT = 12;

/** One outline entry, as the contract carries it. */
interface PanelDestination {
  readonly title: string;
  readonly page: number | null;
  readonly depth: number;
}

/**
 * What the panel is showing.
 *
 * Three states rather than a list plus a flag, for `LinksPanel`'s reason: a
 * list beside `failed: boolean` makes *refused, and here are no entries*
 * representable, which is a state nothing produces and every reader must rule
 * out. Each carries the document it describes, so an answer for a closed one is
 * not rendered.
 */
type PanelState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'unavailable'; readonly docId: DocId }
  | {
      readonly kind: 'outline';
      readonly docId: DocId;
      readonly destinations: readonly PanelDestination[];
      /** Whether the walk stopped at its bound — said, never left as a shorter outline (ADR-0130). */
      readonly truncated: boolean;
    };
