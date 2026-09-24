// @ts-check
/**
 * One DocuSign sign-in against the LIVE service, and the SHAPE of what `userinfo` answers.
 *
 * ## Why it exists
 *
 * The owner's live runs on 2026-09-24 signed in and were refused *"no account this application can
 * send from"* — twice, the second time with `isDefaultAccount` taking both of DocuSign's published
 * spellings. The application turns that refusal into one code and keeps nothing of the answer, so
 * the one fact that decides the fix — what `userinfo` actually says — was visible to nobody. This
 * reads it, through the same kernel functions the application calls: `authorizationUrl`,
 * `exchangeCode` and `sendingAccount`, over the same loopback sign-in on the same registered ports.
 *
 * **Its first reading, 2026-09-24**: ONE account, `"is_default": false`, on `demo.docusign.net` —
 * which is why `sendingAccount` takes the only account when none is marked.
 *
 * ## What it prints, and what it never prints
 *
 * The SHAPE: how many accounts, each entry's field names, its `is_default` as DocuSign spelt it (a
 * boolean or a string, which is not personal), its `base_uri` host, and whether this build's rule
 * chooses one. **Never** a token, an account id, a name or an e-mail address — the top level's
 * values are reduced to their field names.
 *
 * ## Where the key comes from
 *
 * `MONSTERA_DOCUSIGN_KEY`, read once. An integration key identifies a public client and is not a
 * secret the way a password is, but it is stored as one in the application, so it is treated as one
 * here: not printed, not written. **Absent, it reports UNVERIFIABLE and never a pass.**
 *
 * The sign-in opens the person's default browser. A browser already signed in to DocuSign, with
 * consent already given, may complete it with nothing typed.
 *
 * Usage, in one shell, for one run (the developer environment unless `--production`):
 *
 *     MONSTERA_DOCUSIGN_KEY=<integration key> npm run probe:docusign
 */

import { spawn } from 'node:child_process';

import { signInThroughLoopback } from '../../apps/desktop/dist/docusignSignIn.js';
import {
  DOCUSIGN_ACCOUNT_HOSTS,
  DOCUSIGN_REDIRECT_PORTS,
  DocusignRefused,
  authorizationUrl,
  exchangeCode,
  sendingAccount,
  oauthState,
  pkcePair,
} from '../../packages/kernel/dist/docusign.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';

const KEY_VARIABLE = 'MONSTERA_DOCUSIGN_KEY';
const REQUIRE_FLAG = '--require-docusign';

refuseStaleBuild(
  repoRoot(),
  [
    ['packages/kernel/src/docusign.ts', 'packages/kernel/dist/docusign.js', 'tsc'],
    ['apps/desktop/src/docusignSignIn.ts', 'apps/desktop/dist/docusignSignIn.js', 'tsc'],
  ],
  2,
);

const clientId = process.env[KEY_VARIABLE] ?? '';
if (clientId === '') {
  exitUnverifiable({
    required: process.argv.includes(REQUIRE_FLAG),
    subject: 'a DocuSign sign-in against the live service',
    why: `${KEY_VARIABLE} is not set, so no sign-in was started.`,
    flag: REQUIRE_FLAG,
  });
}

/** @type {import('@monstera/contract').DocusignEnvironment} */
const environment = process.argv.includes('--production') ? 'production' : 'demo';

/**
 * Opens the default browser through `Start-Process`, which is `ShellExecute` — the call Electron's
 * `shell.openExternal` makes, so the probe opens a URL the way the application does.
 *
 * **The URL travels in an environment variable, never on a command line.** The first version passed
 * it to `explorer.exe` as an argument, and on the owner's machine (2026-09-24) Explorer opened the
 * Documents folder instead of a browser, and the sign-in waited for a redirect that could not come.
 * A variable is read by PowerShell as a string, so neither its `&` nor anything else in it is parsed.
 *
 * @param {string} url
 * @returns {Promise<void>}
 */
function openInBrowser(url) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:MONSTERA_PROBE_URL'],
      { stdio: 'ignore', env: { ...process.env, MONSTERA_PROBE_URL: url } },
    );
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Start-Process exited ${String(code)}, so no browser was opened`));
    });
  });
}

/**
 * A value's kind as DocuSign spelt it: `boolean true`, `string "true"`, `absent`.
 *
 * @param {unknown} value
 * @returns {string}
 */
function spelling(value) {
  if (value === undefined) return 'absent';
  if (typeof value === 'string') return `string ${JSON.stringify(value)}`;
  if (typeof value === 'boolean' || typeof value === 'number') return `${typeof value} ${String(value)}`;
  return typeof value;
}

/**
 * A URL's host, or what it was instead.
 *
 * @param {unknown} value
 * @returns {string}
 */
function hostOf(value) {
  if (typeof value !== 'string') return spelling(value);
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'not a URL';
  }
}

process.stdout.write(`Signing in to DocuSign (${environment}) in your default browser…\n`);

const pair = pkcePair();
const state = oauthState();
const { code, redirectUri } = await signInThroughLoopback({
  authorize: (redirect) => ({
    url: authorizationUrl({ environment, clientId, redirectUri: redirect, state, challenge: pair.challenge }),
    state,
  }),
  openInBrowser,
  ports: DOCUSIGN_REDIRECT_PORTS,
});
process.stdout.write(`Signed in; the redirect arrived on ${redirectUri}.\n`);

const tokens = await exchangeCode({ environment, clientId, redirectUri, code, verifier: pair.verifier });
process.stdout.write('The code was exchanged for a token, with no client secret.\n');

// THE RAW ANSWER, read once here so its shape can be printed before the kernel's rule reads it.
const response = await fetch(`https://${DOCUSIGN_ACCOUNT_HOSTS[environment]}/oauth/userinfo`, {
  headers: { authorization: `Bearer ${tokens.accessToken}` },
});
process.stdout.write(`\nuserinfo answered HTTP ${String(response.status)}.\n`);
/** @type {unknown} */
const parsed = await response.json();
if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
  process.stdout.write(`The answer is not an object: ${spelling(parsed)}\n`);
  process.exit(1);
}
const answer = /** @type {Record<string, unknown>} */ (parsed);
process.stdout.write(`Top-level fields: ${Object.keys(answer).sort().join(', ')}\n`);

const accounts = answer['accounts'];
if (!Array.isArray(accounts)) {
  process.stdout.write(`accounts is not a list: ${spelling(accounts)}\n`);
} else {
  process.stdout.write(`accounts: ${String(accounts.length)} entr${accounts.length === 1 ? 'y' : 'ies'}\n`);
  accounts.forEach((/** @type {unknown} */ account, index) => {
    /** @type {Record<string, unknown>} */
    const entry = typeof account === 'object' && account !== null ? /** @type {Record<string, unknown>} */ (account) : {};
    process.stdout.write(
      `  [${String(index)}] fields: ${Object.keys(entry).sort().join(', ')}\n` +
        `      is_default: ${spelling(entry['is_default'])}\n` +
        `      base_uri:   ${hostOf(entry['base_uri'])}\n`,
    );
  });
}

// THE APPLICATION'S RULE, on a fresh call with the same token: what the product would decide.
try {
  const chosen = await sendingAccount({ environment, accessToken: tokens.accessToken });
  process.stdout.write(`\nThis build's rule CHOOSES an account, on ${hostOf(chosen.basePath)}.\n`);
} catch (error) {
  if (!(error instanceof DocusignRefused)) throw error;
  process.stdout.write(`\nThis build's rule REFUSES: ${error.reason} — ${error.message}\n`);
  process.exitCode = 1;
}
