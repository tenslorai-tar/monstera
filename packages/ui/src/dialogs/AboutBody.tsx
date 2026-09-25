import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  ABOUT_CHANNEL_DEVELOPMENT,
  ABOUT_CHANNEL_LABEL,
  ABOUT_CHANNEL_STORE,
  ABOUT_CHANNEL_WEB,
  ABOUT_LICENCE,
  ABOUT_LICENCES,
  ABOUT_SOURCE,
  ABOUT_UPDATES_DEVELOPMENT,
  ABOUT_UPDATES_STORE,
  ABOUT_UPDATES_WEB,
  ABOUT_VERSION_LABEL,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { AboutAnswer } from './about.js';

type Channel = 'store' | 'web' | 'development';

/** The install channel in words — a person reads *Microsoft Store*, not the build's enum. */
const CHANNEL_NAMES: Readonly<Record<Channel, MessageKey>> = {
  store: ABOUT_CHANNEL_STORE,
  web: ABOUT_CHANNEL_WEB,
  development: ABOUT_CHANNEL_DEVELOPMENT,
};

/**
 * How this build is updated, per channel (the founding record's E4: *"show 'Updates are managed by Microsoft
 * Store' in About"*, and *"Update checks are the only phone-home in the app, and the About panel says so"*).
 * No build here checks for updates itself: the Store build never self-updates, and the web channel's updater
 * is not built — so each line says what is true of this build rather than what a later one will do.
 */
const UPDATE_LINES: Readonly<Record<Channel, MessageKey>> = {
  store: ABOUT_UPDATES_STORE,
  web: ABOUT_UPDATES_WEB,
  development: ABOUT_UPDATES_DEVELOPMENT,
};

/**
 * The About dialog's body: the build, its licence, how it is updated, and the two pages the AGPL and the
 * third-party licences call for (BUILD-PROMPT D12 *"About (version, licences, source offer)"*).
 *
 * ## It renders what main said, and holds no opinion about it
 *
 * The version and the install channel are `app.info`'s answer, passed as validated props. The two buttons
 * ANSWER the dialog with a page; the command opens it through `app.openWebPage`, which names places and
 * never addresses. Every visible word is a key (B9).
 *
 * A default export because `declareDialog` takes a `lazy()` component, and `lazy` resolves a module's default.
 */
export default function AboutBody({
  version,
  installChannel,
  resolve,
}: {
  readonly version: string;
  readonly installChannel: Channel;
} & DialogAnswering<AboutAnswer>): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-about">
      <dl className="m-about__facts">
        <dt>{_(ABOUT_VERSION_LABEL)}</dt>
        <dd>{version}</dd>
        <dt>{_(ABOUT_CHANNEL_LABEL)}</dt>
        <dd>{_(CHANNEL_NAMES[installChannel])}</dd>
      </dl>
      <p className="m-about__line">{_(UPDATE_LINES[installChannel])}</p>
      <p className="m-about__line">{_(ABOUT_LICENCE)}</p>
      <div className="m-about__actions">
        <Button
          label={ABOUT_SOURCE}
          onClick={() => {
            resolve('source');
          }}
        />
        <Button
          label={ABOUT_LICENCES}
          onClick={() => {
            resolve('licences');
          }}
        />
      </div>
    </div>
  );
}
