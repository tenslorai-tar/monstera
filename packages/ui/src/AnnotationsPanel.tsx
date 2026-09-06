import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion, MessageKey } from '@monstera/shared';
import { type ReactElement, useEffect, useState } from 'react';

import {
  ANNOTATIONS_EMPTY,
  ANNOTATIONS_KIND_CIRCLE,
  ANNOTATIONS_KIND_INK,
  ANNOTATIONS_KIND_LINE,
  ANNOTATIONS_KIND_OTHER,
  ANNOTATIONS_KIND_REDACT,
  ANNOTATIONS_KIND_SQUARE,
  ANNOTATIONS_LABEL,
  ANNOTATIONS_ROW,
  ANNOTATIONS_TRUNCATED,
  ANNOTATIONS_UNAVAILABLE,
} from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';

/**
 * Every annotation in the document, with a jump to the page each sits on.
 *
 * ## The WHOLE document, unlike the links panel next to it
 *
 * `LinksPanel` shows one page because a link is a way out of where the reader
 * is standing. This answers *where are the comments in this document*, which is
 * a question about all of it — so the channel is whole-document, bounded, and
 * says when the bound stopped the walk.
 *
 * That flag is rendered rather than swallowed, for the reason it is carried: a
 * panel headed *the annotations in this document* that silently showed some of
 * them is worse than one that says how many it could not fit.
 *
 * ## THE KIND IS A KEY, and that is why the channel's union is closed
 *
 * B9 bans a literal user-facing string, so every kind needs a `MessageKey` —
 * which is only possible because the contract carries a closed set. A
 * `/Subtype` passed through would arrive as a name this file has no key for,
 * and the fallback would be either a raw document string on screen or a row
 * that renders as nothing.
 *
 * `other` is a real member with a real label, not a gap: a foreign highlight is
 * listed as an annotation on its page, which is what a reader needs in order to
 * go and look at it.
 *
 * ## Re-read when the VERSION moves, which is what makes it not stale
 *
 * A command that adds or removes an annotation bumps the document's version,
 * and the panel takes it as a prop rather than subscribing: the shell already
 * knows, and a panel that watched for itself would be a second answer to *what
 * state is this document in*.
 */
export function AnnotationsPanel({
  client,
  docId,
  version,
  onJump,
}: {
  readonly client: ContractClient;
  /** `undefined` with no document open, which renders nothing. */
  readonly docId: DocId | undefined;
  /** The version the shell has. Re-reads when it moves. */
  readonly version: DocVersion | undefined;
  /** Takes the reader to a page, recording the jump. */
  readonly onJump: (page: number) => void;
}): ReactElement | null {
  const { i18n } = useLingui();
  const [state, setState] = useState<PanelState>({ kind: 'idle' });

  useEffect(() => {
    if (docId === undefined || version === undefined) return;
    let cancelled = false;

    void client['document.annotations']({ docId }).then(
      (answer) => {
        if (cancelled) return;
        // A REFUSAL IS ITS OWN STATE, not an empty list. *This document has no
        // annotations* and *we could not ask* are different things to tell a
        // reader, and collapsing them makes the second invisible — which is the
        // reassuring answer for a document that is busy or poisoned.
        setState(
          answer.ok
            ? {
                kind: 'listed',
                version,
                annotations: answer.value.annotations,
                truncated: answer.value.truncated,
              }
            : { kind: 'unavailable', version },
        );
      },
      () => {
        if (!cancelled) setState({ kind: 'unavailable', version });
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [client, docId, version]);

  // THE STATE CARRIES THE VERSION IT DESCRIBES, and this is where that is
  // spent — `LinksPanel`'s argument with a version instead of a page. Showing
  // the previous version's list while the new answer is in flight would be
  // stale rows that look exactly like current ones, and each of them is a jump
  // to a page number that may have moved.
  if (docId === undefined || version === undefined || state.kind === 'idle') return null;
  if (state.version !== version) return null;

  return (
    <nav className="m-annotations-panel" aria-label={i18n._(ANNOTATIONS_LABEL)}>
      {state.kind === 'unavailable' ? (
        <p className="m-annotations-empty">{i18n._(ANNOTATIONS_UNAVAILABLE)}</p>
      ) : state.annotations.length === 0 ? (
        <p className="m-annotations-empty">{i18n._(ANNOTATIONS_EMPTY)}</p>
      ) : (
        <>
          <ul className="m-annotations-list">
            {state.annotations.map((annotation, at) => (
              // THE INDEX IS THE KEY, for `LinksPanel`'s reason: an annotation
              // has no identity this build can see — that is the same missing
              // handle the inverse is owed — the list is replaced whole when
              // the version moves, and nothing in it is reordered in place.
              <li key={at}>
                <button
                  className="m-annotations-item"
                  onClick={() => {
                    onJump(annotation.page);
                  }}
                  type="button"
                >
                  {i18n._(ANNOTATIONS_ROW, {
                    kind: i18n._(KIND_LABELS[annotation.kind]),
                    page: pdfjsPageOf(annotation.page),
                  })}
                  {annotation.contents === '' ? null : (
                    // THE NOTE, when there is one — which is almost always a
                    // foreign annotation's, because nothing this build writes
                    // sets one yet. Its own element so it can be truncated by
                    // CSS rather than by cutting the string, which would put a
                    // second bound beside the channel's.
                    <span className="m-annotations-note">{annotation.contents}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {state.truncated ? (
            <p className="m-annotations-empty">{i18n._(ANNOTATIONS_TRUNCATED)}</p>
          ) : null}
        </>
      )}
    </nav>
  );
}

/**
 * A label per kind, which is what the contract's closed union buys.
 *
 * A `Record` over the union rather than a lookup with a fallback: a member
 * added to the channel without a label here is a compile error, where a
 * fallback would render every new kind as *Annotation* and look correct.
 */
const KIND_LABELS: Record<PanelAnnotation['kind'], MessageKey> = {
  square: ANNOTATIONS_KIND_SQUARE,
  circle: ANNOTATIONS_KIND_CIRCLE,
  line: ANNOTATIONS_KIND_LINE,
  ink: ANNOTATIONS_KIND_INK,
  redact: ANNOTATIONS_KIND_REDACT,
  other: ANNOTATIONS_KIND_OTHER,
};

/** One annotation, as the contract carries it. */
interface PanelAnnotation {
  readonly page: number;
  readonly kind: 'square' | 'circle' | 'line' | 'ink' | 'redact' | 'other';
  readonly contents: string;
}

/**
 * What the panel is showing.
 *
 * Three states rather than a list plus a flag, for `LinksPanel`'s reason:
 * *refused, and here are no annotations* would be a state nothing can produce
 * and every reader has to rule out (B5).
 */
type PanelState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'unavailable'; readonly version: DocVersion }
  | {
      readonly kind: 'listed';
      readonly version: DocVersion;
      readonly annotations: readonly PanelAnnotation[];
      readonly truncated: boolean;
    };
