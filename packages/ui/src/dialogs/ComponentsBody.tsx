import { useLingui } from '@lingui/react';
import type { ResultOf, channels } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  COMPONENTS_ABSENT,
  COMPONENTS_CHANGED,
  COMPONENTS_CHANGED_DETAIL,
  COMPONENTS_INTRO,
  COMPONENTS_NAME,
  COMPONENTS_PRESENT,
  COMPONENTS_REPAIR,
  COMPONENTS_STATE,
  COMPONENTS_VERIFIED,
  COMPONENTS_VERIFIED_NOTE,
  COMPONENTS_VERIFY,
  COMPONENTS_VERSION,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ComponentsAnswer } from './components.js';

type Component = ResultOf<typeof channels, 'app.components'>['components'][number];

/** Each state in words — a person reads *Installed*, not the channel's enum. */
const STATE_NAMES: Readonly<Record<Component['state'], MessageKey>> = {
  present: COMPONENTS_PRESENT,
  verified: COMPONENTS_VERIFIED,
  absent: COMPONENTS_ABSENT,
  changed: COMPONENTS_CHANGED,
};

/**
 * The Components dialog's body: one row per native component, its version and its state, and *Verify files*.
 *
 * ## It renders what main said
 *
 * The rows are `app.components`' answer, passed as validated props, so a state the channel cannot send cannot be
 * drawn. *Changed* carries its counts beside it, because *changed* alone does not say whether a file is gone or
 * replaced — and a replaced one is the case worth a person's attention. The repair line appears only when something
 * changed: telling someone how to repair a sound installation is a sentence that trains them to ignore this one.
 */
export default function ComponentsBody({
  components,
  verified,
  resolve,
}: {
  readonly components: readonly Component[];
  readonly verified: boolean;
} & DialogAnswering<ComponentsAnswer>): ReactElement {
  const { _ } = useLingui();
  const changed = components.some((component) => component.state === 'changed');

  return (
    <div className="m-components">
      <p className="m-components__line">{_(COMPONENTS_INTRO)}</p>
      <table className="m-components__table">
        <thead>
          <tr>
            <th scope="col">{_(COMPONENTS_NAME)}</th>
            <th scope="col">{_(COMPONENTS_VERSION)}</th>
            <th scope="col">{_(COMPONENTS_STATE)}</th>
          </tr>
        </thead>
        <tbody>
          {components.map((component) => (
            <tr key={component.id} data-state={component.state}>
              <th scope="row">{component.name}</th>
              <td>{component.version}</td>
              <td>
                {_(STATE_NAMES[component.state])}
                {component.state === 'changed' ? (
                  <span className="m-components__detail">
                    {_(COMPONENTS_CHANGED_DETAIL, {
                      missing: component.missing,
                      altered: component.altered,
                      extra: component.extra,
                    })}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {verified ? <p className="m-components__line">{_(COMPONENTS_VERIFIED_NOTE)}</p> : null}
      {changed ? <p className="m-components__line">{_(COMPONENTS_REPAIR)}</p> : null}
      <div className="m-components__actions">
        <Button
          label={COMPONENTS_VERIFY}
          onClick={() => {
            resolve('verify');
          }}
        />
      </div>
    </div>
  );
}
