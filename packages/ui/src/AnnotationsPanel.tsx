import { useLingui } from '@lingui/react';
import type { AnnotationKindName, ContractClient } from '@monstera/contract';
import type { DocId, DocVersion, MessageKey } from '@monstera/shared';
import { type ReactElement, useEffect, useState } from 'react';

import {
  ANNOTATIONS_EMPTY,
  ANNOTATIONS_FOREIGN,
  ANNOTATIONS_KIND_CARET,
  ANNOTATIONS_KIND_CIRCLE,
  ANNOTATIONS_KIND_HIGHLIGHT,
  ANNOTATIONS_KIND_INK,
  ANNOTATIONS_KIND_LINE,
  ANNOTATIONS_KIND_OTHER,
  ANNOTATIONS_KIND_POLYGON,
  ANNOTATIONS_KIND_POLYLINE,
  ANNOTATIONS_KIND_REDACT,
  ANNOTATIONS_KIND_SQUARE,
  ANNOTATIONS_KIND_STICKY_NOTE,
  ANNOTATIONS_KIND_STRIKEOUT,
  ANNOTATIONS_KIND_UNDERLINE,
  ANNOTATIONS_KIND_TEXT_BOX,
  ANNOTATIONS_LABEL,
  ANNOTATIONS_REMOVE,
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
  onRemove,
}: {
  readonly client: ContractClient;
  /** `undefined` with no document open, which renders nothing. */
  readonly docId: DocId | undefined;
  /** The version the shell has. Re-reads when it moves. */
  readonly version: DocVersion | undefined;
  /** Takes the reader to a page, recording the jump. */
  readonly onJump: (page: number) => void;
  /**
   * Removes one annotation, named by the handle the row was built from.
   *
   * Dispatched from the SURFACE rather than through the command registry, for
   * `movePage`'s reason (`App.tsx`): a registered command's `run` takes the
   * application's state and no arguments, because a menu, a chord and the
   * palette all invoke it and none of them can supply a handle. A row can, so
   * it dispatches — through the same `applyDocumentCommand` every other
   * caller uses, never differently.
   */
  readonly onRemove: (handle: {
    readonly page: number;
    readonly index: number;
    readonly version: DocVersion;
  }) => void;
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
              // THE LIST POSITION IS THE REACT KEY, and it is NOT the handle.
              // Worth keeping apart now that the two are both numbers: `at` is
              // where the row sits in this array, `annotation.index` is where
              // the annotation sits in the walk on its own page. They agree for
              // a single-page document and diverge on the second page, so a
              // handle built from `at` would delete the wrong annotation on
              // every document but the simplest.
              //
              // A position is the right React key here for `LinksPanel`'s
              // reason: the list is replaced whole when the version moves and
              // nothing in it is reordered in place.
              <li className="m-annotations-row" key={at}>
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
                  {annotation.authored ? null : (
                    // THE `srcRef` MARK, RENDERED (ADR-0043). Shown on the
                    // foreign rows only: *we wrote this* is the ordinary case in
                    // a panel reached from this application's own tools, and a
                    // badge on every row is one nobody reads. The negative is
                    // what a person needs before they erase or move it.
                    //
                    // `data-annotation-foreign` carries the fact rather than
                    // the label, so a case asserts provenance without matching
                    // on the words — which are a translator's to change.
                    <span className="m-annotations-foreign" data-annotation-foreign="">
                      {i18n._(ANNOTATIONS_FOREIGN)}
                    </span>
                  )}
                  {annotation.contents === '' ? null : (
                    // THE NOTE, when there is one — which is almost always a
                    // foreign annotation's, because nothing this build writes
                    // sets one yet. Its own element so it can be truncated by
                    // CSS rather than by cutting the string, which would put a
                    // second bound beside the channel's.
                    <span className="m-annotations-note">{annotation.contents}</span>
                  )}
                </button>
                <button
                  className="m-annotations-remove"
                  onClick={() => {
                    // THE VERSION COMES FROM THE ANSWER, not from the `version`
                    // prop, and the two are equal here — the guard above returns
                    // null unless they are. Taking it from the state anyway is
                    // the point rather than caution: the handle is *page, index
                    // and the version its walk was read at*, and building it
                    // from the shell's current version would produce a value
                    // that can never disagree, which is a guard that cannot
                    // fire wearing the shape of one that can.
                    onRemove({
                      page: annotation.page,
                      index: annotation.index,
                      version: state.version,
                    });
                  }}
                  title={i18n._(ANNOTATIONS_REMOVE)}
                  type="button"
                >
                  {i18n._(ANNOTATIONS_REMOVE)}
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
  'text-box': ANNOTATIONS_KIND_TEXT_BOX,
  // *NOTE* AND NOT *STICKY NOTE*, which is the tool's name rather than the
  // object's. A reader scanning this list is being told what is on the page —
  // and *Insertion mark* likewise says what a caret MEANS in a marked-up
  // document, where *Caret* names the glyph it happens to be drawn as.
  'sticky-note': ANNOTATIONS_KIND_STICKY_NOTE,
  caret: ANNOTATIONS_KIND_CARET,
  polygon: ANNOTATIONS_KIND_POLYGON,
  polyline: ANNOTATIONS_KIND_POLYLINE,
  highlight: ANNOTATIONS_KIND_HIGHLIGHT,
  underline: ANNOTATIONS_KIND_UNDERLINE,
  strikeout: ANNOTATIONS_KIND_STRIKEOUT,
  other: ANNOTATIONS_KIND_OTHER,
};

/** One annotation, as the contract carries it. */
interface PanelAnnotation {
  readonly page: number;
  /**
   * The handle's other half — where this sits in the walk on its own page.
   *
   * Carried but never computed here. It is minted by the kernel's reader and
   * resolved by its inverse, and a renderer that derived one would be deciding
   * a question MuPDF's own walk answers (ADR-0041).
   */
  readonly index: number;
  /**
   * **THE CONTRACT'S TYPE, not a copy of its members.**
   *
   * This was the same nine names written out again, and the comment above
   * {@link KIND_LABELS} claimed that a kind added to the channel without a
   * label here is a compile error. It was not: the copy would have gone on
   * satisfying the table while the channel grew past it, and the error the
   * comment promised would never have arrived. Taking the type is what makes
   * that sentence true.
   */
  readonly kind: AnnotationKindName;
  readonly contents: string;
  /**
   * Whether **this build wrote it** — the `srcRef` mark (ADR-0043).
   *
   * `false` means it came with the document. Rendered on those rows only, and
   * read rather than derived: a renderer inferring provenance from anything it
   * can see would be a second opinion about a fact the file carries.
   */
  readonly authored: boolean;
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
