import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import type { AnnotationStyle } from './annotations/annotationStyle.js';
import { hexFromColour } from './annotations/annotationStyle.js';
import type { AnnotationSelection } from './annotations/selectTool.js';
import {
  COMMENT_STYLES_APPLY,
  COMMENT_STYLES_CURRENT,
  COMMENT_STYLES_LABEL,
  COMMENT_STYLES_NONE,
  COMMENT_STYLES_NO_WIDTH,
} from './messages/en.js';
import { Button } from './primitives/Button.js';

/**
 * The comment styles panel — the style controls' OTHER half.
 *
 * `StylePanel` decides what the next annotation looks like. This one shows what
 * the selected ones look like now, and changes them. Two panels rather than one
 * because they answer different questions and one of them is a document
 * mutation: applying a style is a command with a handle, a version and an undo
 * entry, where setting a preference is none of those.
 *
 * ## It reads the style from the SELECTION, which reads it from the walk
 *
 * Nothing here derives an appearance. `document.annotations` answers what each
 * annotation is drawn in — including a `null` width for the six subtypes that
 * have no `/BS` — and the selection carries it through. A panel that guessed
 * from the kind would be right about this build's own marks and wrong about
 * every document somebody else made.
 *
 * ## What it shows is the FIRST selected annotation
 *
 * A multi-selection has as many styles as it has members, and a panel showing
 * one of them as though it were all is the compound claim this project keeps
 * paying for. So the heading says how many are selected and the swatch is
 * labelled as the first — the honest reading of *what am I about to change*,
 * where an averaged or blanked control would be a value nothing in the document
 * has.
 */
export interface CommentStylesPanelProps {
  /** What is selected, or `undefined` for nothing. */
  readonly selection: AnnotationSelection | undefined;
  /** The style the authoring controls are set to — what Apply would write. */
  readonly style: AnnotationStyle;
  /** Sends the restyle, through the one dispatcher. */
  readonly onApply: (selection: AnnotationSelection) => void;
}

export function CommentStylesPanel({
  selection,
  style,
  onApply,
}: CommentStylesPanelProps): ReactElement {
  const { i18n } = useLingui();

  if (selection === undefined) {
    return (
      <section aria-label={i18n._(COMMENT_STYLES_LABEL)} className="m-comment-styles">
        <p className="m-comment-styles__empty">{i18n._(COMMENT_STYLES_NONE)}</p>
      </section>
    );
  }

  const first = selection.items[0];

  return (
    <section aria-label={i18n._(COMMENT_STYLES_LABEL)} className="m-comment-styles">
      <p className="m-comment-styles__current">
        {i18n._(COMMENT_STYLES_CURRENT, { count: selection.items.length })}
      </p>
      {first === undefined ? null : (
        <span
          className="m-comment-styles__swatch"
          data-current-colour={hexFromColour([
            first.style.colour[0] ?? 0,
            first.style.colour[1] ?? 0,
            first.style.colour[2] ?? 0,
          ])}
          data-current-opacity={String(first.style.opacity)}
          // A WIDTH OF `null` IS SAID, not shown as zero: the subtype has no
          // border to change, and a `0` in a panel reads as *no border* rather
          // than *no such property*, which is what a person would then try to
          // set.
          data-current-width={first.style.borderWidth === null ? '' : String(first.style.borderWidth)}
        >
          {first.style.borderWidth === null ? i18n._(COMMENT_STYLES_NO_WIDTH) : ''}
        </span>
      )}
      <Button
        label={COMMENT_STYLES_APPLY}
        onClick={() => {
          onApply(selection);
        }}
        variant="primary"
      />
      {/* THE STYLE THAT WOULD BE WRITTEN, so *Apply* is not a control whose
          effect a person has to remember. It is the authoring controls' value,
          read rather than duplicated. */}
      <span
        className="m-comment-styles__pending"
        data-pending-colour={hexFromColour(style.colour([0, 0, 0]))}
        data-pending-opacity={String(style.opacity)}
        data-pending-width={String(style.lineWidth)}
      />
    </section>
  );
}
