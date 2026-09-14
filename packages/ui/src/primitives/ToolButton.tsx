import { useLingui } from '@lingui/react';
import { Button as BaseButton } from '@base-ui/react/button';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import { Icon } from './Icon.js';
import type { IconName } from './icons.js';

/**
 * A ribbon button: a glyph over its caption, §10.3's *"compact 52 px buttons"*
 * with §10.4's 20 px ribbon icon.
 *
 * A primitive rather than markup in `Ribbon.tsx`, because §10.4 grows controls
 * *"in the package, never ad hoc in the feature"*. A surface that drew its own
 * glyph-and-caption button would be the first of several.
 *
 * ## The caption IS the accessible name
 *
 * The label is visible, so it names the control and the glyph is hidden. An
 * `aria-label` beside visible text would be a second name, and the two can
 * disagree the day the catalogue is translated.
 */
export interface ToolButtonProps {
  readonly label: MessageKey;
  readonly icon: IconName;
  readonly onClick: () => void;
}

export function ToolButton({ label, icon, onClick }: ToolButtonProps): ReactElement {
  const { _ } = useLingui();
  return (
    <BaseButton className="m-tool-button" nativeButton onClick={onClick} type="button">
      <Icon name={icon} size="ribbon" />
      <span className="m-tool-button__label">{_(label)}</span>
    </BaseButton>
  );
}
