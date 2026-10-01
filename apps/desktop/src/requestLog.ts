import { LOG_DETAIL_STORED, type MainHandlers, channels, storedSetting } from '@monstera/contract';

import type { SettingsSurface } from './settingsFile.js';

/**
 * The detailed log's lines: one per renderer request, by its name, its outcome and `main`'s time
 * ([ADR-0119](../../../docs/DECISIONS/0119-a-detailed-log-records-each-request-by-name-outcome-and-time.md),
 * corrected 2026-09-28).
 *
 * ## Called for every request, from the handlers the composition root builds
 *
 * {@link observedHandlers} wraps the graph's whole handler map once, so a channel registered tomorrow is logged by
 * being registered; nothing here names a feature. It is applied in the GRAPH rather than in `registerContractHandlers`
 * so that no call site changes: `pickerProbe.ts` registers the graph too, and its bytes are digested by the record of
 * a person driving the real file dialog — an argument added there expires that record (9cf27e94's reason).
 *
 * ## Nothing from the parameters, except a command's kind — read by the channel's own schema
 *
 * The params carry what a person typed. The one field written is `document.execute`'s `command.kind`, a member of a
 * closed enum, read by the channel's own schema, never by a cast.
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
  return storedSetting(stored, LOG_DETAIL_STORED) === 'detailed';
}

/** A `document.execute` request's command kind, or `undefined` for params its schema refuses. */
function commandKindOf(params: unknown): string | undefined {
  const parsed = channels['document.execute'].params.safeParse(params);
  return parsed.success ? parsed.data.command.kind : undefined;
}

/**
 * The graph's handlers, each telling `requests` its channel, params, outcome and span when it answers.
 *
 * A handler that THROWS is told as `internal`, the code the boundary's wrapper turns a throw into, and the throw goes
 * on to that wrapper unchanged — it records the incident, which is the problems log's line.
 *
 * @param now the clock the span is read from, injected so a case can name the milliseconds.
 */
export function observedHandlers(
  handlers: MainHandlers,
  requests: RequestObserver,
  now: () => number = () => performance.now(),
): MainHandlers {
  const observed = Object.entries(handlers).map(([channel, handler]) => {
    const answer = handler as (params: unknown) => Promise<{ ok: true } | { ok: false; error: { code: string } }>;
    // A TUPLE, so `fromEntries` below answers a typed map rather than `any` — an untyped entry list would make the
    // cast a cast of `any`, which checks nothing.
    return [
      channel,
      async (params: unknown) => {
        const started = now();
        try {
          const result = await answer(params);
          requests(channel, params, result.ok ? 'ok' : result.error.code, now() - started);
          return result;
        } catch (thrown) {
          requests(channel, params, 'internal', now() - started);
          throw thrown;
        }
      },
    ] as const;
  });
  // THE SAME KEYS, each answering what its handler answered: the map's type is the input's.
  return Object.fromEntries(observed) as unknown as MainHandlers;
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
