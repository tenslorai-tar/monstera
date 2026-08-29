import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { ABOUT_CHANNEL_LABEL, ABOUT_VERSION_LABEL } from '../messages/en.js';

/**
 * The About dialog's body.
 *
 * ## It renders what main said, and holds no opinion about it
 *
 * The version and the install channel are `app.info`'s answer, passed as
 * validated props. This component does not fetch them: `DialogRegistry.openWith`
 * validates props at the **open call**, before any state moves, so a body that
 * fetched its own would be doing it after the only place both sides exist.
 *
 * ## Every visible word is a key
 *
 * B9's lint rule bans literal JSX text, and the two labels here are the
 * population it catches. The values are expressions, which it tolerates and
 * should — a version string is not translatable text.
 *
 * A default export because `declareDialog` takes a `lazy()` component, and
 * `lazy` resolves a module's default.
 */
export default function AboutBody({
  version,
  installChannel,
}: {
  readonly version: string;
  readonly installChannel: string;
}): ReactElement {
  const { _ } = useLingui();

  return (
    <dl className="m-about">
      <dt>{_(ABOUT_VERSION_LABEL)}</dt>
      <dd>{version}</dd>
      <dt>{_(ABOUT_CHANNEL_LABEL)}</dt>
      <dd>{installChannel}</dd>
    </dl>
  );
}
