// @ts-check
/**
 * Provisions the browser Playwright drives, into `.tools/` rather than the
 * machine.
 *
 * §10.4 makes accessibility a runtime gate and names the vehicle: *"the mandated
 * gate is axe-core running on every Playwright-rendered screen from Stage 0,
 * with zero serious violations"*. `BUILD-PROMPT.md:768-773` names the same
 * thing against the browser shim. So a browser has to exist somewhere, and
 * where it comes from is the question this file answers.
 *
 * ## The download is a STEP, not an install side effect
 *
 * This is the hazard the Electron pin already closed, and closing it again
 * costs nothing because the mechanism is already in place: every install in
 * this repository runs `npm ci --ignore-scripts`, so Playwright's postinstall —
 * the thing that would otherwise fetch a browser during dependency resolution —
 * never runs. Installing `@playwright/test` added five packages and no binary,
 * measured 2026-09-01.
 *
 * What pins the browser is the PACKAGE version. A Playwright release names the
 * exact browser build it drives, so `@playwright/test@1.62.1` in the lockfile
 * is the pin, and there is no second digest to keep in step with it. That is
 * why this file carries no SHA-256 where `gitleaks.mjs` carries several: the
 * artefact is chosen by a version this repository already commits, rather than
 * by a URL this repository composes.
 *
 * ## Into `.tools/`, so a provisioned machine is one this repository made
 *
 * `PLAYWRIGHT_BROWSERS_PATH` is set to `.tools/playwright`. Without it
 * Playwright installs into a per-user cache — `%LOCALAPPDATA%\ms-playwright` on
 * Windows — which is shared with every other project on the machine and is
 * outside anything this repository can state the contents of. Measured while
 * writing this: that directory already existed here, holding browsers this
 * project never asked for.
 *
 * ## Chromium only, and that is the gate's own scope
 *
 * Neither document asks for a browser matrix. The gate is *"every
 * Playwright-rendered screen"*, and the renderer it is rendering ships inside
 * Electron, which is Chromium. Installing three engines would triple the
 * provisioning cost to test two the product does not contain.
 *
 * Usage: node scripts/provision/playwright.mjs [--force]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatError } from '../lib/reportError.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the browser goes. Gitignored, like every other provisioned artefact. */
export const BROWSERS_PATH = join(REPO_ROOT, '.tools', 'playwright');

/**
 * The CLI, BY PATH.
 *
 * Not `npx playwright`, and not a bare `playwright` on PATH. Invariant 23's
 * reasoning is about native code selection and the same argument holds here:
 * PATH deciding which binary provisions a security-relevant test vehicle is a
 * decision made by the machine rather than by this repository. The lockfile
 * says which Playwright is installed; this is where that one lives.
 */
const CLI = join(REPO_ROOT, 'node_modules', 'playwright', 'cli.js');

/**
 * Whether a browser is already present.
 *
 * A DIRECTORY LISTING, not a flag file. Playwright's own install is what puts
 * a browser here, so asking the directory is asking the thing that knows —
 * a marker this script wrote would say *we ran the installer* rather than
 * *a browser is present*, and those diverge the moment an install half-fails.
 *
 * @returns {string[]} the browser directories found, newest listing order.
 */
export function installedBrowsers() {
  if (!existsSync(BROWSERS_PATH)) return [];
  try {
    return readdirSync(BROWSERS_PATH).filter((entry) => entry.startsWith('chromium'));
  } catch {
    return [];
  }
}

/** @param {boolean} force @returns {number} */
function provision(force) {
  const already = installedBrowsers();
  if (already.length > 0 && !force) {
    process.stdout.write(
      `  ok  chromium is already provisioned: ${already.join(', ')}\n` +
        `      ${BROWSERS_PATH}\n`,
    );
    return 0;
  }

  if (!existsSync(CLI)) {
    process.stderr.write(
      `\nPlaywright is not installed: ${CLI}\n\nRun \`npm ci\` first.\n\n` +
        `This script provisions the BROWSER; the package that drives it comes from the\n` +
        `lockfile, and it is the lockfile's version that pins which browser build arrives.\n\n`,
    );
    return 1;
  }

  process.stdout.write(`  installing chromium into ${BROWSERS_PATH}\n`);
  const run = spawnSync(process.execPath, [CLI, 'install', 'chromium'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH },
  });

  if (run.status !== 0) {
    process.stderr.write(
      `\nplaywright install exited ${String(run.status)}${
        run.signal === null ? '' : ` (signal ${run.signal})`
      }.\n\n`,
    );
    return 1;
  }

  // ASKED AGAIN AFTERWARDS, because an installer's exit code says the process
  // finished and not that the artefact is there. The same distinction the host
  // factory makes about `SetInformationJobObject`: a call's answer is about the
  // call.
  const found = installedBrowsers();
  if (found.length === 0) {
    process.stderr.write(
      `\nplaywright install reported success and ${BROWSERS_PATH} holds no chromium.\n` +
        `The browser is not where PLAYWRIGHT_BROWSERS_PATH pointed, so the tests would\n` +
        `silently use whatever the machine has.\n\n`,
    );
    return 1;
  }

  process.stdout.write(`\n  ok  chromium provisioned: ${found.join(', ')}\n`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith('playwright.mjs')) {
  try {
    process.exitCode = provision(process.argv.includes('--force'));
  } catch (error) {
    process.stderr.write(`\n${formatError(error)}\n`);
    process.exitCode = 1;
  }
}
