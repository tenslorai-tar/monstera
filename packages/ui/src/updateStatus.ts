import type { ContractClient, UpdateStatus } from '@monstera/contract';

import { SECURITY_UPDATE_DIALOG_ID, SECURITY_UPDATE_RESULT } from './dialogs/securityUpdate.js';

/**
 * What the renderer makes of main's update status (ADR-0110). **The one reading of it**, so the title bar's
 * indicator, About's line and the security notice cannot disagree about which answers mean what (B3a).
 */

/** Whether the title bar offers the Store: a newer version, an unsupported one, or a security release. */
export function isUpdateOffered(status: UpdateStatus | undefined): boolean {
  return status?.kind === 'newer' || status?.kind === 'unsupported' || status?.kind === 'security';
}

/**
 * Whether this run asked monsterapdf.com at all — About's line says so exactly when it did. `unknown` counts: the
 * request was made, and no answer came back. `none`, `dormant` and `off` made no request.
 */
export function checksForUpdates(status: UpdateStatus | undefined): boolean {
  return status !== undefined && status.kind !== 'none' && status.kind !== 'dormant' && status.kind !== 'off';
}

/**
 * The security notice, shown when main found a security release this person has not acknowledged (ADR-0018:
 * *"A `security` release shows a notice requiring acknowledgement"*).
 *
 * **Either answer acknowledges, and dismissal does not.** *Open Microsoft Store* and *I understand* both say the
 * person read it; closing the dialog with the × or Escape says nothing, so the notice returns next start. The Store
 * opens through `app.openStore`, which names a page and never an address.
 */
export async function offerSecurityNotice(
  deps: { readonly client: ContractClient; readonly ask: (id: string, props: unknown) => Promise<unknown> },
  status: UpdateStatus,
): Promise<void> {
  if (status.kind !== 'security' || status.acknowledged) return;
  const answer = SECURITY_UPDATE_RESULT.safeParse(await deps.ask(SECURITY_UPDATE_DIALOG_ID, { version: status.version }));
  if (!answer.success) return;
  if (answer.data === 'store') await deps.client['app.openStore']({ page: 'listing' });
  await deps.client['app.acknowledgeSecurityUpdate']({});
}
