// @ts-check
/**
 * Proves the MSIX packager's decisions ([ADR-0123](../../docs/DECISIONS/0123-the-msix-is-assembled-here-and-packed-by-the-sdks-makeappx.md)):
 * which Publisher each flavour writes and refuses, which versions it refuses, and that its resolution check sees a
 * missing package — each with the control that separates it from a check that refuses or accepts everything.
 *
 * And the executable's icon: the packager's own step is applied to a copy of the provisioned `electron.exe` and the
 * icon is read back from its resources, against the same file without the step. And the start check that refuses a
 * package whose program does not start, against three applications the provisioned runtime starts by folder.
 *
 * It builds no package and needs no SDK. The icon and start cases need a Windows executable, so they run where Windows
 * is; elsewhere they are named as not run, and `--require-runtime` — which the Windows leg passes — makes that a
 * failure.
 *
 * Usage: node scripts/proofs/packageMsix.proof.mjs [--require-runtime]
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTypeScript } from '../lib/loadTypeScript.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { applicationIcon, carriesIcon, icoImages } from '../lib/peIcons.mjs';
import { formatError } from '../lib/reportError.mjs';
import { partialOutcome } from '../lib/unverifiable.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { startsToWindow } from '../release/startCheck.mjs';
import {
  BRAND_ICON,
  UNSIGNED_OID,
  appxManifest,
  bareSpecifiers,
  brandExecutable,
  packageIdentity,
  refuseVersion,
  unresolvedImports,
} from '../release/packageMsix.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELECTRON_BINARY = electronBinaryPath(REPO_ROOT);
const RUNTIME_PRESENT = process.platform === 'win32' && existsSync(ELECTRON_BINARY);

/** @type {string[]} */
const failures = [];

/** The cases that need a Windows executable, named once: the count, and what a run without one lists as not run. */
const RUNTIME_CASES = [
  "the packager's step leaves the executable carrying the brand's icon, read back from its resources",
  "CONTROL: the same executable without the step shows an icon, and it is not the brand's",
  "CONTROL: an .ico one byte different from the brand's is not reported as carried",
  'the start check passes an application whose window loads its page and mounts',
  "CONTROL: one whose main throws before its window — 0.1.7.0's shape, silent on every stream — is not started, and no window is why",
  'CONTROL: one whose window loads its page and never mounts is not started, and the mount is why',
];

/** Cases decidable without one. These run on every machine. */
const PURE_CASES = 11;

const roster = createRoster(failures, { cases: RUNTIME_PRESENT ? PURE_CASES + RUNTIME_CASES.length : PURE_CASES });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** The message a call throws, or `null` when it returns. @param {() => unknown} run */
function thrown(run) {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const RESERVED = { store: { identityName: 'Tenslor.Monstera', publisher: 'CN=ABCDEF01-2345', publisherDisplayName: 'Tenslor Inc.' } };
const EMPTY = { store: { identityName: '', publisher: '', publisherDisplayName: '' } };

const ts = await loadTypeScript('the packager’s import scanner is the compiler’s, and this proof exercises it');
const scratch = mkdtempSync(join(tmpdir(), 'monstera-msix-proof-'));

try {
  const test = packageIdentity('test', EMPTY);
  check(
    'the test flavour writes the unsigned OID into its Publisher, and needs no reserved identity',
    test.publisher.endsWith(UNSIGNED_OID) && test.name !== RESERVED.store.identityName,
    JSON.stringify(test),
  );

  const oidInStore = { store: { ...RESERVED.store, publisher: `CN=ABCDEF01-2345, ${UNSIGNED_OID}` } };
  const refused = thrown(() => packageIdentity('store', oidInStore));
  // CONTROL: the same reserved identity without the OID is accepted — so the refusal is the OID's, not the flavour's.
  const accepted = packageIdentity('store', RESERVED);
  check(
    'the Store flavour REFUSES a Publisher carrying the unsigned OID, and accepts the same identity without it',
    refused !== null && refused.includes(UNSIGNED_OID) && accepted.publisher === RESERVED.store.publisher,
    `refused: ${String(refused)}; accepted: ${JSON.stringify(accepted)}`,
  );

  const unreserved = thrown(() => packageIdentity('store', EMPTY));
  check(
    'the Store flavour refuses to invent an identity Partner Center has not reserved',
    unreserved !== null && unreserved.includes('msix.json'),
    String(unreserved),
  );

  const shapes = ['0.1.0', '0.1.0.0.0', '0.1.a.0', '01.1.0.0'].map((version) => thrown(() => refuseVersion(version, [])));
  // CONTROL: a well-formed version with nothing packed before it passes.
  check(
    'a version that is not four numeric parts is refused, and a well-formed one is not',
    shapes.every((message) => message !== null) && thrown(() => refuseVersion('0.1.0.0', [])) === null,
    JSON.stringify(shapes),
  );

  const fourth = thrown(() => refuseVersion('0.1.0.1', []));
  check('the fourth part must be 0 — the Store reserves it', fourth !== null && fourth.includes('fourth'), String(fourth));

  const reused = thrown(() => refuseVersion('0.1.0.0', ['0.1.0.0']));
  const older = thrown(() => refuseVersion('0.1.0.0', ['0.2.0.0']));
  // CONTROL: a greater version passes against the same history — so the refusals are the ordering, not the history.
  const greater = thrown(() => refuseVersion('0.10.0.0', ['0.2.0.0', '0.9.3.0']));
  check(
    'a version already packed, or older than one, is refused; a greater one passes (0.10 is greater than 0.9)',
    reused !== null && older !== null && greater === null,
    `reused: ${String(reused)}; older: ${String(older)}; greater: ${String(greater)}`,
  );

  const specifiers = bareSpecifiers(
    [
      "import { z } from 'zod';",
      "import 'side-effect';",
      "const m = await import('mupdf');",
      "const k = require('koffi');",
      "const p = createRequire(import.meta.url).resolve('@monstera/kernel/engine');",
      "const w = require.resolve('zxing-wasm/reader/zxing_reader.wasm');",
      "import { join } from 'node:path';",
      "import fs from 'fs';",
      "import { app } from 'electron';",
      "import { local } from './local.js';",
    ].join('\n'),
    ts,
  ).sort();
  // CONTROL: prose that LOOKS like an import — the eleven false reports the first, pattern-based version made on its
  // first run were all of these shapes. A scanner that reads text would name 'ended' and 'the harness never spoke'.
  const prose = bareSpecifiers(
    [
      "const done = Promise.resolve('ended');",
      "throw new Error(\"nothing came from 'the harness never spoke'\");",
      'const note = `imported from \'somewhere\' in a template`;',
    ].join('\n'),
    ts,
  );
  check(
    'every literal import form is read — and prose that looks like one is not, nor builtins, Electron or relative paths',
    JSON.stringify(specifiers) ===
      JSON.stringify(['@monstera/kernel/engine', 'koffi', 'mupdf', 'side-effect', 'zod', 'zxing-wasm/reader/zxing_reader.wasm']) &&
      prose.length === 0,
    `read ${JSON.stringify(specifiers)}; from prose ${JSON.stringify(prose)}`,
  );

  // A STAGED APP: the contract imports zod, which is shipped; the desktop dist imports a package that is not.
  const app = join(scratch, 'app');
  const write = (/** @type {string} */ path, /** @type {string} */ text) => {
    mkdirSync(join(app, path, '..'), { recursive: true });
    writeFileSync(join(app, path), text);
  };
  write('node_modules/@monstera/contract/dist/index.js', "import { z } from 'zod';\n");
  write('node_modules/zod/package.json', '{"name":"zod"}');
  write('dist/entry.js', "import { PDFDocument } from '@cantoo/pdf-lib';\nimport { z } from 'zod';\n");
  const missing = unresolvedImports(app, ts);
  check(
    'a package the shipped code imports and the package does not hold is named — and one it holds is not',
    JSON.stringify(missing) === JSON.stringify([`${join('dist', 'entry.js')}: @cantoo/pdf-lib`]),
    JSON.stringify(missing),
  );

  // 0.1.7.0's SHAPE: a workspace package staged as its manifest, without the entry its `exports` names, which the shell
  // RESOLVES. CONTROL: the same tree with the entry present names nothing — so the report is the missing file's.
  write('node_modules/@monstera/nodemode/package.json', JSON.stringify({ name: '@monstera/nodemode', exports: { '.': { default: './dist/index.js' } } }));
  write('dist/reader.js', "import { createRequire } from 'node:module';\nexport const at = createRequire(import.meta.url).resolve('@monstera/nodemode');\n");
  const withoutEntry = unresolvedImports(app, ts).filter((line) => line.includes('nodemode'));
  write('node_modules/@monstera/nodemode/dist/index.js', 'export {};\n');
  const withEntry = unresolvedImports(app, ts).filter((line) => line.includes('nodemode'));
  check(
    "a workspace package staged without the entry its exports name is reported for the file that resolves it — and not once the entry is there",
    withoutEntry.length === 1 && (withoutEntry[0] ?? '').startsWith(`${join('dist', 'reader.js')}: @monstera/nodemode`) && withEntry.length === 0,
    `without: ${JSON.stringify(withoutEntry)}; with: ${JSON.stringify(withEntry)}`,
  );

  // THE POSITIVE CONTROL'S OWN CASE: with zod gone the check cannot see, and must say so rather than report nothing.
  rmSync(join(app, 'node_modules', 'zod'), { recursive: true });
  const blind = thrown(() => unresolvedImports(app, ts));
  const manifest = appxManifest({ identity: packageIdentity('test', EMPTY), version: '0.1.0.0', architecture: 'x64' });
  check(
    'a blinded resolution check refuses to report, and the manifest carries full trust, the webcam and .pdf',
    blind !== null &&
      blind.includes('cannot see') &&
      manifest.includes('<rescap:Capability Name="runFullTrust" />') &&
      manifest.includes('<DeviceCapability Name="webcam" />') &&
      manifest.includes('>.pdf</uap:FileType>') &&
      manifest.includes('<DisplayName>Monstera PDF Editor</DisplayName>') &&
      manifest.includes(`Publisher="CN=Tenslor Inc., ${UNSIGNED_OID}"`),
    `blind: ${String(blind)}`,
  );

  // The brand's set is the seven sizes `assets/brand/README.md` names. CONTROL: a PNG — the brand's own 256-pixel
  // logo — is refused rather than read as an icon with no images.
  const brandImages = icoImages(readFileSync(BRAND_ICON));
  const notIco = thrown(() => icoImages(readFileSync(join(REPO_ROOT, 'assets', 'brand', 'logo-256.png'))));
  check(
    "the brand's .ico reads as its seven images, and a PNG is refused as not an .ico",
    brandImages.length === 7 && notIco !== null && notIco.includes('not an .ico'),
    `${String(brandImages.length)} image(s); PNG: ${String(notIco)}`,
  );

  if (RUNTIME_PRESENT) {
    const brand = readFileSync(BRAND_ICON);
    const plain = join(scratch, 'plain.exe');
    const branded = join(scratch, 'branded.exe');
    copyFileSync(ELECTRON_BINARY, plain);
    copyFileSync(ELECTRON_BINARY, branded);
    await brandExecutable(branded, BRAND_ICON);
    check(RUNTIME_CASES[0] ?? '', carriesIcon(readFileSync(branded), brand), `first group: ${String(applicationIcon(readFileSync(branded)).images.length)} image(s)`);

    // The plain file must SHOW an icon — Electron's — so "not the brand's" is a comparison that ran, not a group the
    // reader failed to find; `applicationIcon` throws when there is none.
    const shown = applicationIcon(readFileSync(plain));
    check(RUNTIME_CASES[1] ?? '', shown.images.length > 0 && !carriesIcon(readFileSync(plain), brand), `first group ${String(shown.id)}: ${String(shown.images.length)} image(s)`);

    const altered = Buffer.from(brand);
    const lastEntry = 6 + (brandImages.length - 1) * 16;
    const lastByte = altered.readUInt32LE(lastEntry + 12) + altered.readUInt32LE(lastEntry + 8) - 1;
    altered.writeUInt8(altered.readUInt8(lastByte) ^ 1, lastByte);
    check(RUNTIME_CASES[2] ?? '', !carriesIcon(readFileSync(branded), altered), 'the last image differs in its last byte');

    // THREE APPLICATIONS the provisioned runtime starts by folder, differing only in how far they get.
    /** @param {string} name @param {string} main @param {string} page */
    const application = (name, main, page) => {
      const folder = join(scratch, name);
      mkdirSync(join(folder, 'renderer'), { recursive: true });
      writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: `start-${name}`, main: 'main.cjs' }));
      writeFileSync(join(folder, 'main.cjs'), main);
      writeFileSync(join(folder, 'renderer', 'index.html'), page);
      return folder;
    };
    const opens =
      "const { app, BrowserWindow } = require('electron');\nconst { join } = require('node:path');\n" +
      "app.whenReady().then(() => { void new BrowserWindow({ show: false }).loadFile(join(__dirname, 'renderer', 'index.html')); });\n";
    const mounts = '<!doctype html><title>start</title><div id="root"><p>mounted</p></div>\n';
    const good = await startsToWindow({ command: ELECTRON_BINARY, args: [application('good', opens, mounts)], timeoutMs: 30_000 });
    check(RUNTIME_CASES[3] ?? '', good.started, `${String(good.ms)} ms: ${good.reason}`);
    const throws = await startsToWindow({
      command: ELECTRON_BINARY,
      args: [application('throws', "throw new Error('thrown before the window, as 0.1.7.0 threw');\n", mounts)],
      timeoutMs: 10_000,
    });
    check(RUNTIME_CASES[4] ?? '', !throws.started && throws.reason.startsWith('no window loaded'), `${String(throws.ms)} ms: ${throws.reason}`);
    const empty = await startsToWindow({
      command: ELECTRON_BINARY,
      args: [application('empty', opens, '<!doctype html><title>start</title><div id="root"></div>\n')],
      timeoutMs: 10_000,
    });
    check(RUNTIME_CASES[5] ?? '', !empty.started && empty.reason.includes('had not mounted'), `${String(empty.ms)} ms: ${empty.reason}`);
  }

  if (failures.length > 0) {
    process.stderr.write(`\nMSIX packager proof — ${String(failures.length)} failure(s):\n\n${failures.map((f) => `  - ${f}`).join('\n\n')}\n\n`);
    process.exitCode = 1;
  } else if (RUNTIME_PRESENT) {
    process.stdout.write(`${roster.format('MSIX packager case')}\n`);
  } else {
    const partial = partialOutcome({
      required: process.argv.includes('--require-runtime'),
      ran: PURE_CASES,
      missed: RUNTIME_CASES,
      why:
        process.platform === 'win32'
          ? `The Electron runtime is missing:\n    ${ELECTRON_BINARY}\n  Run \`npm run provision:electron\`.`
          : 'This is not Windows: the icon cases need a Windows executable and rcedit, which runs one.',
      flag: '--require-runtime',
    });
    if (partial.stream === 'stderr') process.stderr.write(`${roster.format('MSIX packager case')}${partial.text}`);
    else process.stdout.write(`${roster.format('MSIX packager case')}${partial.text}`);
    process.exitCode = partial.code;
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
