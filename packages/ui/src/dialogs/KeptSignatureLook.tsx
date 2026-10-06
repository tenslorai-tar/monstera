import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { SIGN_DOCUMENT_KEPT_DRAWN } from '../messages/en.js';
import type { KeptSignature } from './signDocument.js';
import { SignatureOutlineImage, useSignatureFaces, useTypedName } from './TypedSignature.js';

/**
 * A drawn signature's strokes as one SVG path in the pad's own unit (0–1 across, y down), so a kept drawing shows as it
 * was drawn at any size — the viewBox scales it.
 */
function strokesPath(strokes: readonly (readonly (readonly [number, number])[])[]): string {
  return strokes
    .map((stroke) => stroke.map(([across, down], index) => `${index === 0 ? 'M' : 'L'}${String(across)} ${String(down)}`).join(' '))
    .join(' ');
}

/**
 * A kept typed name, drawn as the outline it will be placed as (ADR-0150). Until the faces are read, and if its face
 * cannot set it, the name is shown as plain text — a kept signature is never shown as an empty box.
 */
function KeptTypedLook({ text, font }: Extract<KeptSignature['look'], { kind: 'typed' }>): ReactElement {
  const set = useTypedName(useSignatureFaces(), font, text);
  return set?.kind === 'outline' ? (
    <SignatureOutlineImage className="m-sign-document__kept-typed" label={text} outline={set.outline} />
  ) : (
    <span className="m-sign-document__kept-text">{text}</span>
  );
}

/**
 * How a kept signature looks, in either dialog that offers the library (ADR-0133: ONE library, shown one way).
 *
 * A typed one as the outline it will be drawn as, a drawing as its strokes, a picture by its `blob:` address. *Sign
 * with certificate* and the plain *Signature* both render a kept entry through this, so the two can never show the same
 * signature differently.
 *
 * @param number the entry's place in the list, from one — a drawing has no words of its own to be named by
 */
export function KeptSignatureLook({ entry, number }: { readonly entry: KeptSignature; readonly number: number }): ReactElement {
  const { _ } = useLingui();
  if (entry.look.kind === 'typed') return <KeptTypedLook {...entry.look} />;
  if (entry.look.kind === 'drawn') {
    return (
      <svg
        aria-label={_(SIGN_DOCUMENT_KEPT_DRAWN, { number })}
        className="m-sign-document__kept-drawn"
        role="img"
        viewBox="0 0 1 0.5"
      >
        <path d={strokesPath(entry.look.strokes)} />
      </svg>
    );
  }
  return <img alt={entry.look.name} className="m-sign-document__kept-picture" src={entry.look.src} />;
}
