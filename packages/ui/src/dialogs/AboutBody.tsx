import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import heroLogo from '../../../../assets/brand/logo-hero.png';
import {
  ABOUT_CHANNEL_DEVELOPMENT,
  ABOUT_CHANNEL_LABEL,
  ABOUT_CHANNEL_STORE,
  ABOUT_CHANNEL_WEB,
  ABOUT_COPYRIGHT,
  ABOUT_LICENCE,
  ABOUT_LICENCES,
  ABOUT_LOCAL,
  ABOUT_SOURCE,
  ABOUT_VERSION_LABEL,
  ABOUT_WHAT,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
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
 * The About dialog's body: what Monstera is, the build, its licence, and the two pages the AGPL and the third-party
 * licences call for (BUILD-PROMPT D12 *"About (version, licences, source offer)"*).
 *
 * **No line mentions updates** (ADR-0236 and its correction), on any run: the body takes no update status, so no
 * prop can bring one back. The install channel is a fact about where the build came from.
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
      {/* THE MARK, from the owner's `monstera_logo.png` through the start screen's derivative. `alt=""`: the
          dialog's title names the application, and the picture is the mark alone (ADR-0002's note of 2026-10-04). */}
      <img className="m-about__logo" src={heroLogo} alt="" />
      <dl className="m-dialog-facts">
        <dt>{_(ABOUT_VERSION_LABEL)}</dt>
        <dd>{version}</dd>
        <dt>{_(ABOUT_CHANNEL_LABEL)}</dt>
        <dd>{_(CHANNEL_NAMES[installChannel])}</dd>
      </dl>
      <p className="m-about__line">{_(ABOUT_WHAT)}</p>
      <p className="m-about__line">{_(ABOUT_LOCAL)}</p>
      <p className="m-about__line">{_(ABOUT_LICENCE)}</p>
      <p className="m-about__line">{_(ABOUT_COPYRIGHT)}</p>
      <DialogFooter dismissal="close">
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
      </DialogFooter>
    </div>
  );
}
