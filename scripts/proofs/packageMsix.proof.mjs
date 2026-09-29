// @ts-check
/**
 * Proves the MSIX packager's decisions ([ADR-0123](../../docs/DECISIONS/0123-the-msix-is-assembled-here-and-packed-by-the-sdks-makeappx.md)):
 * which Publisher each flavour writes and refuses, which versions it refuses, and that its resolution check sees a
 * missing package — each with the control that separates it from a check that refuses or accepts everything.
 *
 * Pure: it builds no package and needs no SDK, so it runs on every runner.
 *
 * Usage: node scripts/proofs/packageMsix.proof.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadTypeScript } from '../lib/loadTypeScript.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import {
  UNSIGNED_OID,
  appxManifest,
  bareSpecifiers,
  packageIdentity,
  refuseVersion,
  unresolvedImports,
} from '../release/packageMsix.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });

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

  if (failures.length > 0) {
    process.stderr.write(`\nMSIX packager proof — ${String(failures.length)} failure(s):\n\n${failures.map((f) => `  - ${f}`).join('\n\n')}\n\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${roster.format('MSIX packager case')}\n`);
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
