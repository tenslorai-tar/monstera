// @ts-check
/**
 * Whether a built application STARTS: its main process gets as far as a window whose renderer has mounted.
 *
 * ## Why the packager runs a program rather than reading a file list
 *
 * 0.1.7.0 was built, packed and installed, and did not start: `main` threw on its first resolve because the module
 * closure had left `@monstera/nodemode`'s entry out. Every check the packager made passed, because each asked a
 * question about FILES — which modules the graph reaches, whether a package is present — and the defect was a file
 * nothing in the graph named. A file list proves which files exist; only a start proves the program runs. So the
 * package is refused unless the staged `Monstera.exe` itself starts.
 *
 * ## What counts as started, and why silence does not
 *
 * Measured on the 0.1.7.0 stage, 2026-10-02: the process stayed alive for the full 25 s, opened its DevTools port, and
 * printed nothing on stdout or stderr — Electron reports an exception thrown in `main` in a dialog and nowhere else, even
 * with `ELECTRON_ENABLE_LOGGING`. So *no error was printed* is the reassuring answer a broken start also gives, and the
 * check waits for the positive instead: a page at the application's own `renderer/index.html`, whose `#root` has
 * children. `main` builds its whole dependency graph — the engine platforms, the reader surface — synchronously before
 * `whenReady` creates the window (`main.ts`), so that page existing means the graph was built; the mount means the
 * renderer's bundle ran too.
 *
 * A scratch `--user-data-dir` scopes the run: Electron's single-instance lock follows it (`shell.proof.mjs`), so a
 * start while the owner's installed application is open is not handed to the owner's window, and nothing the run
 * writes lands in the owner's profile. `--remote-debugging-port=0` lets Windows pick the port, which Chromium writes
 * to `DevToolsActivePort` in that folder. The process tree is ended by PID.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The application's own page, as `window.ts` loads it. */
const RENDERER_PAGE = /^file:\/\/\/.*\/renderer\/index\.html$/u;

/**
 * One `Runtime.evaluate` on a page, over its DevTools socket.
 *
 * @param {string} socketUrl
 * @param {string} expression
 * @returns {Promise<unknown>}
 */
async function evaluate(socketUrl, expression) {
  const socket = new WebSocket(socketUrl);
  try {
    await new Promise((opened, failed) => {
      socket.addEventListener('open', opened, { once: true });
      socket.addEventListener('error', () => failed(new Error(`the page's DevTools socket would not open: ${socketUrl}`)), { once: true });
    });
    const answer = new Promise((answered) => {
      socket.addEventListener('message', (event) => {
        /** @type {{ id?: number, result?: { result?: { value?: unknown } } }} */
        const message = JSON.parse(String(event.data));
        if (message.id === 1) answered(message.result?.result?.value);
      });
    });
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    return await Promise.race([answer, new Promise((late) => setTimeout(() => late(undefined), 5000))]);
  } finally {
    socket.close();
  }
}

/**
 * Starts `command` and waits for its renderer to mount, then ends it.
 *
 * @param {{ readonly command: string, readonly args?: readonly string[], readonly timeoutMs?: number }} options
 *   `args` precede this function's own switches, so an application folder can be named first as Electron expects
 * @returns {Promise<{ readonly started: boolean, readonly ms: number, readonly reason: string }>}
 */
export async function startsToWindow({ command, args = [], timeoutMs = 60_000 }) {
  const userData = mkdtempSync(join(tmpdir(), 'monstera-start-'));
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' };
  // A PARENT RUN AS NODE would make the child Node too, and it would never open a window for a reason of ours.
  delete env['ELECTRON_RUN_AS_NODE'];
  const child = spawn(command, [...args, `--user-data-dir=${userData}`, '--remote-debugging-port=0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  let output = '';
  const keep = (/** @type {unknown} */ chunk) => {
    output = `${output}${String(chunk)}`.slice(-3000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  /** @type {number | null | undefined} */
  let exitCode;
  const exited = new Promise((done) => {
    child.on('exit', (code) => {
      exitCode = code;
      done(undefined);
    });
  });
  const started = Date.now();
  const elapsed = () => Date.now() - started;

  try {
    /** @type {string | null} */
    let pageSeen = null;
    while (elapsed() < timeoutMs) {
      await new Promise((tick) => setTimeout(tick, 250));
      if (exitCode !== undefined) {
        return { started: false, ms: elapsed(), reason: `the process exited with code ${String(exitCode)} before its renderer mounted; its output ends:\n${output}` };
      }
      const portFile = join(userData, 'DevToolsActivePort');
      if (!existsSync(portFile)) continue;
      const port = readFileSync(portFile, 'utf8').split('\n')[0] ?? '';
      /** @type {{ type: string, url: string, webSocketDebuggerUrl?: string }[]} */
      let targets;
      try {
        targets = /** @type {typeof targets} */ (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json());
      } catch {
        continue;
      }
      const page = targets.find((target) => target.type === 'page' && RENDERER_PAGE.test(target.url));
      if (page === undefined || page.webSocketDebuggerUrl === undefined) continue;
      pageSeen = page.url;
      const children = await evaluate(page.webSocketDebuggerUrl, "document.getElementById('root')?.childElementCount ?? 0").catch(() => 0);
      if (typeof children === 'number' && children > 0) return { started: true, ms: elapsed(), reason: '' };
    }
    return {
      started: false,
      ms: elapsed(),
      reason:
        pageSeen === null
          ? `no window loaded the application's page within ${String(timeoutMs)} ms — main throws before creating it, and ` +
            `Electron shows that only in a dialog. Its output ends:\n${output}`
          : `the window loaded ${pageSeen}, and its renderer had not mounted within ${String(timeoutMs)} ms. Its output ends:\n${output}`,
    };
  } finally {
    if (exitCode === undefined && child.pid !== undefined) {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        // Already gone: taskkill exits non-zero for a PID with no process, which is the state this wanted.
      }
      await exited;
    }
    // THE PROFILE IS RELEASED as the tree finishes tearing down, after the launched process's own exit — so a folder
    // that will not go is reported, never thrown, which would replace the answer this run is returning.
    try {
      rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (error) {
      process.stderr.write(`The start check's scratch profile ${userData} was not removed: ${String(error)}\n`);
    }
  }
}
