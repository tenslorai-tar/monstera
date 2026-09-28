import { LOG_DETAIL_SETTING_ID, channels } from '@monstera/contract';

import type { SettingsSurface } from './settingsFile.js';

/**
 * The detailed log's lines: one per renderer request, by its name, its outcome and `main`'s time
 * ([ADR-0119](../../../docs/DECISIONS/0119-a-detailed-log-records-each-request-by-name-outcome-and-time.md)).
 *
 * ## Called for every request, from the one place every request crosses
 *
 * `registerContractHandlers` times the wrapped handler and hands this the channel, the raw params, the outcome and
 * the milliseconds. A channel registered tomorrow is logged by being registered; nothing here names a feature.
 *
 * ## Nothing from the parameters, except a command's kind — read by the channel's own schema
 *
 * The params are the renderer's and carry what a person typed. The one field written is `document.execute`'s
 * `command.kind`, a member of a closed enum, and it is read by parsing the params with that channel's schema — the
 * same parse the handler's wrapper made — never by a cast of the untrusted value.
 */
export type RequestObserver = (channel: string, params: unknown, outcome: string, milliseconds: number) => void;

/** The graph with no log — every unit test's position, and a harness's: nothing is recorded. */
export const NO_REQUEST_LOG: RequestObserver = () => undefined;

/**
 * The one request not recorded: PDF.js asks for the document's bytes in ranges, so its count follows the bytes the
 * viewer reads rather than anything a person did, and its lines would fill the log's cap with the transport.
 */
const TRANSPORT = 'document.readRange';

/** The settings save, after which the level is read again — so turning *Detailed* on takes effect at once. */
const SETTINGS_SAVE = 'settings.save';

/** Whether the stored settings ask for the detailed log. Only `'detailed'` does: anything else is the default. */
export function logIsDetailed(stored: Readonly<Record<string, unknown>>): boolean {
  return stored[LOG_DETAIL_SETTING_ID] === 'detailed';
}

/** A `document.execute` request's command kind, or `undefined` for params its schema refuses. */
function commandKindOf(params: unknown): string | undefined {
  const parsed = channels['document.execute'].params.safeParse(params);
  return parsed.success ? parsed.data.command.kind : undefined;
}

/**
 * The observer for a log that `write` appends to, at the level `settings` holds.
 *
 * @param settings the stored settings, read now and after each successful save.
 * @param write the log's own line writer (`ShellLog.write`), so a detailed line sits in order beside a failure.
 */
export function createRequestLog(
  settings: Pick<SettingsSurface, 'read'>,
  write: (kind: string, detail: string) => void,
): RequestObserver {
  let detailed = logIsDetailed(settings.read());
  return (channel, params, outcome, milliseconds) => {
    // THE SAVE THAT CHANGED THE LEVEL is recorded at the level it set: the line that turned *Detailed* on is the
    // first one written, and the one that turned it off is not.
    if (channel === SETTINGS_SAVE && outcome === 'ok') detailed = logIsDetailed(settings.read());
    if (!detailed || channel === TRANSPORT) return;
    const kind = channel === 'document.execute' ? commandKindOf(params) : undefined;
    write('REQUEST', `${channel}${kind === undefined ? '' : ` ${kind}`} ${outcome} ${String(Math.round(milliseconds))}ms`);
  };
}
