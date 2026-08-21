// @ts-check
/**
 * What a utility process actually IS on the pinned Electron, measured.
 *
 * ADR-0022 has to choose mechanisms for invariant 25's four properties, and
 * `ForkOptions` on 43.4.1 offers none of them — no integrity level, no job
 * object, no sandbox, no filesystem restriction. So the mechanisms have to come
 * from somewhere else, and every candidate depends on facts about the host
 * process that this repository has never established:
 *
 * - which Node the host runs, since Node's permission model is a candidate for
 *   the filesystem property and its flags differ by version;
 * - whether Node's core modules are reachable at all from a utility process
 *   (`net` decides whether "no network" can be a configuration or must be
 *   containment);
 * - what the process token and job assignment already are on Windows, because
 *   "lowest workable integrity level" is a claim about a starting point nobody
 *   has read.
 *
 * **This is research, not a proof.** It asserts nothing and gates nothing; it
 * prints what is true of the pinned runtime so an ADR can state mechanisms with
 * measurements behind them instead of plausible API names. It lives under
 * `scripts/research/` for that reason.
 *
 * Usage: node scripts/research/hostSurface.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { electronBinaryPath } from '../provision/electron.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'monstera-host-'));

/**
 * The host body. Everything here runs INSIDE the utility process, which is the
 * only place these questions have an answer.
 */
const HOST = `
const report = {};

report.versions = {
  node: process.versions.node,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
};
report.execPath = process.execPath;
report.argv0 = process.argv0;
report.execArgv = process.execArgv;
report.platform = process.platform;
report.pid = process.pid;

// Does the host have Node's core surface at all? This decides whether "no
// network" can be configured or has to be contained: a session-scoped policy
// governs Electron's net module, and nothing about require('net').
for (const name of ['net', 'dgram', 'fs', 'child_process', 'os', 'worker_threads']) {
  try {
    const loaded = require('node:' + name);
    report['has_' + name] = typeof loaded === 'object' && loaded !== null;
  } catch (error) {
    report['has_' + name] = 'threw: ' + String(error && error.message);
  }
}

// Node's permission model is the candidate mechanism for the filesystem
// property. Whether it is even queryable tells us if execArgv could carry it.
report.hasPermission = typeof process.permission === 'object' && process.permission !== null;
if (report.hasPermission) {
  try {
    report.permissionFsRead = process.permission.has('fs.read');
    report.permissionNet = process.permission.has('net');
  } catch (error) {
    report.permissionQuery = 'threw: ' + String(error && error.message);
  }
}

// Can the host open an outbound socket RIGHT NOW? Recorded as the starting
// point, not as a verdict — the containment assertion this informs must use a
// target that would SUCCEED without the guard, and a loopback listener in the
// same process is exactly that.
try {
  const net = require('node:net');
  const server = net.createServer();
  report.canListen = 'pending';
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const socket = net.connect(port, '127.0.0.1', () => {
      report.canListen = true;
      report.loopbackPort = port;
      socket.destroy();
      server.close(() => process.parentPort.postMessage(report));
    });
    socket.on('error', (error) => {
      report.canListen = 'connect threw: ' + String(error && error.message);
      server.close(() => process.parentPort.postMessage(report));
    });
  });
  server.on('error', (error) => {
    report.canListen = 'listen threw: ' + String(error && error.message);
    process.parentPort.postMessage(report);
  });
} catch (error) {
  report.canListen = 'threw: ' + String(error && error.message);
  process.parentPort.postMessage(report);
}
`;

/**
 * The main-process body: fork the host under each candidate configuration and
 * print what each reports.
 *
 * The `execArgv` variants are the mechanism question. Node's permission model is
 * the leading candidate for invariant 25's filesystem property, and whether a
 * utility process honours those flags at all is not something to assume — it is
 * a Node feature reached through an Electron fork, and either layer can drop it.
 */
const MAIN = `
const { app, utilityProcess } = require('electron');
const { join } = require('node:path');

const VARIANTS = [
  { label: 'default', execArgv: [] },
  { label: 'permission + fs-read scoped', execArgv: ['--permission', '--allow-fs-read=' + __dirname] },
  { label: 'permission alone', execArgv: ['--permission'] },
];

const results = [];

function runVariant(index) {
  if (index >= VARIANTS.length) {
    process.stdout.write('MONSTERA_HOST_REPORT ' + JSON.stringify(results) + '\\n');
    app.exit(0);
    return;
  }

  const variant = VARIANTS[index];
  let settled = false;
  const settle = (payload) => {
    if (settled) return;
    settled = true;
    results.push({ variant: variant.label, execArgv: variant.execArgv, ...payload });
    runVariant(index + 1);
  };

  let child;
  try {
    child = utilityProcess.fork(join(__dirname, 'host.js'), [], {
      serviceName: 'monstera-research-host',
      stdio: 'inherit',
      execArgv: variant.execArgv,
    });
  } catch (error) {
    // A REFUSAL IS A RESULT. If the fork itself rejects these flags that is the
    // answer to the mechanism question, and it must not look like a timeout.
    settle({ forkThrew: String(error && error.message) });
    return;
  }

  child.on('message', (message) => settle({ fromHost: message, pidVisibleFromMain: child.pid ?? null }));
  child.on('exit', (code) => settle({ hostExitedBeforeReporting: code }));
  setTimeout(() => settle({ error: 'no report within the window' }), 15000);
}

app.whenReady().then(() => runVariant(0));

setTimeout(() => {
  process.stdout.write('MONSTERA_HOST_REPORT ' + JSON.stringify({ error: 'timed out', results }) + '\\n');
  app.exit(1);
}, 90000);
`;

try {
  writeFileSync(join(scratch, 'host.js'), HOST, 'utf8');
  writeFileSync(join(scratch, 'main.js'), MAIN, 'utf8');
  writeFileSync(
    join(scratch, 'package.json'),
    `${JSON.stringify({ name: 'monstera-host-research', version: '0.0.0', main: 'main.js' }, null, 2)}\n`,
    'utf8',
  );

  const electron = electronBinaryPath();
  process.stdout.write(`electron: ${electron}\n\n`);

  const result = spawnSync(electron, [scratch], {
    encoding: 'utf8',
    // A rich ambient environment is not what the real host gets; this is the
    // axis BB-4 was about. Left as inherit here deliberately, because the
    // question being asked is what the runtime provides, not what survives a
    // bare environment — and saying so is the point.
    env: process.env,
    timeout: 60_000,
  });

  const line = `${result.stdout}`.split('\n').find((entry) => entry.startsWith('MONSTERA_HOST_REPORT '));
  if (line === undefined) {
    process.stdout.write(`no report line.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n`);
    process.exit(1);
  }

  process.stdout.write(`${JSON.stringify(JSON.parse(line.slice('MONSTERA_HOST_REPORT '.length)), null, 2)}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
