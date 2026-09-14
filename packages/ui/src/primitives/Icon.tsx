import type { ReactElement } from 'react';

import type { IconSize } from './iconSize.js';
import { ICONS, type IconName } from './icons.js';

/**
 * A named glyph beside text (§10.4).
 *
 * `IconButton` is a control whose only content is a glyph, so its accessible name
 * comes from a required label. This is a glyph drawn beside a visible label — a
 * ribbon button's caption, a rail section's name — so it is **decorative and
 * hidden from assistive technology**: the text beside it is the name, and a glyph
 * announced as well would read twice.
 *
 * `size` is a use, never a number, for `iconSize.ts`' reason; the pixels are in
 * `primitives.css`.
 */
export function Icon({ name, size }: { readonly name: IconName; readonly size: IconSize }): ReactElement {
  const Glyph = ICONS[name];
  return <Glyph aria-hidden className={`m-icon m-icon--${size}`} focusable={false} />;
}
