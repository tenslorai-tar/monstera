import {
  compareReleaseVersions,
  releaseVersionSchema,
  updateManifestSchema,
  type UpdateManifest,
  type UpdateManifestAddress,
  type UpdateStatus,
} from '@monstera/contract';
import { readWithin } from '@monstera/kernel';

import type { AppInfo } from './contractHandlers.js';
import type { SettingsSurface } from './settingsFile.js';

/**
 * The update check (ADR-0018, [ADR-0110](../../../docs/DECISIONS/0110-the-update-check-is-built-dormant-and-reads-numbers-only.md)):
 * one plain GET of a number-only manifest, at most once per start, in `main`.
 *
 * ## The providers, one per install channel
 *
 * ADR-0018 names two: `StoreUpdateProvider`, which checks, and `WebUpdateProvider`, **registered with nothing behind
 * it** — the seam kept so a signed download is a configuration change later. A development build checks nothing. A
 * `Record` over the channel, so a channel with no provider is a compile error rather than a build that guesses.
 *
 * ## Dormant is a state the check answers, before anything else it asks
 *
 * The address is the contract's `UPDATE_MANIFEST`, and while it is `dormant` this answers `dormant` without reading
 * the setting or calling anything. Going live is that one value, on the owner's word that monsterapdf.com serves the
 * file (ADR-0110).
 *
 * ## What the request carries
 *
 * Nothing about the person: no query, no cookie, no body, and only the header names Node's `fetch` sends by itself,
 * which `updateCheck.test.ts` measures against a local server and writes down. `timestampTransport.ts`' shape — no
 * redirect followed, a timeout, the body counted as it arrives through `readWithin`. Like any request, the site sees
 * the internet address; the setting's description says so.
 *
 * ## Why the manifest is numbers only
 *
 * A manifest a stranger swapped can at worst show a false *update available* that opens the real Microsoft Store —
 * it carries no address and no text, and every sentence a person reads is this application's own (B5 over a
 * signature this project has no key for).
 */

/** Which install channel a build is — `AppInfo`'s, baked at build time. */
export type InstallChannel = AppInfo['installChannel'];

/** What a channel's provider does: read the manifest, or nothing at all. */
export type UpdateProvider = { readonly id: 'store'; readonly checks: true } | { readonly id: 'web' | 'none'; readonly checks: false };

/** The Store build's provider: the manifest check, the indicator and the security notice. */
export const STORE_UPDATE_PROVIDER: UpdateProvider = { id: 'store', checks: true };

/**
 * The web build's provider, **registered with nothing behind it** (ADR-0018): no direct download exists, and the day
 * one does, its updater is built here rather than as an amendment.
 */
export const WEB_UPDATE_PROVIDER: UpdateProvider = { id: 'web', checks: false };

/** Each channel's provider. A development build is the one this repository runs, and it never checks. */
export const UPDATE_PROVIDERS: Readonly<Record<InstallChannel, UpdateProvider>> = {
  store: STORE_UPDATE_PROVIDER,
  web: WEB_UPDATE_PROVIDER,
  development: { id: 'none', checks: false },
};

/**
 * The most bytes a manifest may be, in RECEIVED bytes. **A bound, not a measurement**: the file is five short
 * fields, well under a tenth of this, and anything longer is not the file.
 */
export const MAX_MANIFEST_BYTES = 4096;

/**
 * How long the one request may take before the answer is *unknown*. **A bound, not a measurement**: a static file
 * answers in far less, and the person is never waiting on it — nothing is shown until an answer exists.
 */
export const MANIFEST_TIMEOUT_MS = 10_000;

/** The file under `userData` that records which security release the person acknowledged. */
export const UPDATE_RECORD_FILE = 'update-check.json';

/**
 * What a manifest says about the installed version. First match wins (ADR-0110):
 *
 * 1. a security release above the installed version — the notice that needs acknowledging;
 * 2. below the minimum supported version;
 * 3. below the newest;
 * 4. otherwise current, which includes a build AHEAD of the manifest.
 *
 * An installed version that is not three numbers — a development build's pre-release tag — is `unknown`, never a
 * guess. Numbers compare as numbers, so `1.2.10` is above `1.2.9`.
 */
export function statusFor(installed: string, manifest: UpdateManifest, acknowledged: string | null): UpdateStatus {
  if (!releaseVersionSchema.safeParse(installed).success) return { kind: 'unknown' };
  const below = (version: string): boolean => compareReleaseVersions(installed, version) < 0;
  if (manifest.security && below(manifest.version)) {
    return { kind: 'security', version: manifest.version, acknowledged: acknowledged === manifest.version };
  }
  if (below(manifest.minimumVersion)) return { kind: 'unsupported', version: manifest.version };
  if (below(manifest.version)) return { kind: 'newer', version: manifest.version };
  return { kind: 'current' };
}

/**
 * The GET. Transport and parse; it decides nothing about versions.
 *
 * @param fetchImpl injected so a case can answer from a local server; the application passes nothing.
 */
export function manifestTransport(fetchImpl: typeof fetch = fetch): (url: string) => Promise<UpdateManifest> {
  return async (url) => {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`the manifest answered HTTP ${String(response.status)}`);
    if (response.body === null) throw new Error('the manifest answered no body');
    const bytes = await readWithin(
      response.body,
      MAX_MANIFEST_BYTES,
      (received) =>
        new Error(
          `the manifest passed its ${String(MAX_MANIFEST_BYTES)}-byte ceiling at ${String(received)} bytes received`,
        ),
    );
    return updateManifestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  };
}

/** The check a start makes, and the one thing a person can record about it. */
export interface UpdateCheck {
  /** The answer for this start: the first call runs the check, every later call shares it. */
  readonly status: () => Promise<UpdateStatus>;
  /** Records that the person saw the security notice for the version the check found; `false` when there was none. */
  readonly acknowledge: () => Promise<boolean>;
}

/** The record's one field: the security release a person acknowledged, so the notice is shown once per version. */
const ACKNOWLEDGED = 'acknowledgedSecurityVersion';

/**
 * The check.
 *
 * **Once per start, and only when asked.** The renderer asks after its first paint, so nothing here is on the
 * startup path, and the answer is kept for the rest of the run: a long session does not check again, and no retry
 * follows a failure — the next start is the next check.
 *
 * @param deps.enabled the Settings switch, read when the check runs
 * @param deps.record where the acknowledgement is kept; `null` keeps none, so the notice returns next start
 * @param deps.log one line when the check found no answer, naming why
 */
export function createUpdateCheck(deps: {
  readonly provider: UpdateProvider;
  readonly address: UpdateManifestAddress;
  readonly installed: string;
  readonly enabled: () => boolean;
  readonly record: SettingsSurface | null;
  readonly fetchManifest: (url: string) => Promise<UpdateManifest>;
  readonly log: (detail: string) => void;
}): UpdateCheck {
  const acknowledged = (): string | null => {
    const value = deps.record?.read()[ACKNOWLEDGED];
    return typeof value === 'string' ? value : null;
  };

  const run = async (): Promise<UpdateStatus> => {
    if (!deps.provider.checks) return { kind: 'none' };
    if (deps.address.state === 'dormant') return { kind: 'dormant' };
    if (!deps.enabled()) return { kind: 'off' };
    let manifest: UpdateManifest;
    try {
      manifest = await deps.fetchManifest(deps.address.url);
    } catch (error) {
      deps.log(error instanceof Error ? error.message : String(error));
      return { kind: 'unknown' };
    }
    return statusFor(deps.installed, manifest, acknowledged());
  };

  let found: Promise<UpdateStatus> | undefined;
  const status = (): Promise<UpdateStatus> => (found ??= run());

  return {
    status,
    acknowledge: async () => {
      const current = await status();
      if (current.kind !== 'security' || deps.record === null) return false;
      deps.record.write({ ...deps.record.read(), [ACKNOWLEDGED]: current.version });
      found = Promise.resolve({ ...current, acknowledged: true });
      return true;
    },
  };
}
