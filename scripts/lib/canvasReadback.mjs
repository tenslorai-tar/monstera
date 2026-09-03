// @ts-check
/**
 * Running the canvas harness, and reading what the renderer reported.
 *
 * ## One caller became two, so the runner moved
 *
 * `canvasPixels.proof.mjs` owned this. `renderGeometry.proof.mjs` needs the same
 * thing — the same binary, the same display handling, the same marker, the same
 * failure reporting — and a second copy would be a second opinion about how this
 * harness is driven (B3a). The two proofs differ in what they ASK, which is the
 * fixture and the assertions; they do not differ in how the question is put.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';

const ROOT = repoRoot();

/** The compiled harness the Electron binary runs. */
export const HARNESS = join(ROOT, 'apps', 'desktop', 'dist', 'canvasHarnessMain.js');

/** The one line a caller may read out of the harness's output. */
export const MARKER = 'MONSTERA_CANVAS_READBACK ';

/** The catalogue a control's accessible name is read from. */
const CATALOGUE = join(ROOT, 'packages', 'ui', 'src', 'messages', 'en.ts');

/**
 * The English text a control's message key resolves to.
 *
 * ## Read rather than spelt here, and it carries its own positive control
 *
 * This is a SEARCH, and its reassuring answer is a string — but a wrong pattern
 * returns nothing, and nothing would then be handed to the harness as the name
 * to click, producing "the control was not found" for a control that is there.
 * That is a broken instrument reporting the defect it was written to detect. So
 * a miss throws, naming the file and the key.
 *
 * The alternative was a literal in the proof, which is a second spelling of a
 * string the catalogue owns; the drift would be silent there and loud in the
 * harness, which is the wrong way round.
 *
 * @param {string} key the dotted message key the control's title is minted from
 * @returns {string}
 */
export function controlName(key) {
  const source = readFileSync(CATALOGUE, 'utf8');
  // The catalogue spells the value as `[SOME_KEY]: 'text',` under a computed
  // key, so the anchor is the key's own dotted name on the line that mints it,
  // and the English text is found by the constant that line binds.
  const minted = new RegExp(
    `export const (\\w+) = messageKey\\('${key.replace(/\./gu, '\\.')}'\\)`,
    'u',
  ).exec(source);
  if (minted === null) {
    throw new Error(
      `No constant in ${CATALOGUE} mints the key "${key}". A proof would otherwise ` +
        `hand the harness an empty name, and the harness would report that the control ` +
        `does not exist — a broken reader producing exactly the finding it exists to detect.`,
    );
  }
  const text = new RegExp(`\\[${minted[1]}\\]:\\s*'([^']+)'`, 'u').exec(source);
  if (text === null || text[1] === undefined) {
    throw new Error(
      `${CATALOGUE} mints ${minted[1]} for "${key}" but the EN catalogue has no entry for ` +
        `it. The resolver throws on a missing message at run time, so this is a renderer that ` +
        `cannot draw the surface that control sits on.`,
    );
  }
  return text[1];
}

/**
 * Runs the harness under a display and returns what the renderer reported.
 *
 * `xvfb-run -a` on Linux, because Electron needs an X display there and without
 * one it does not error — it HANGS. The wrapper is applied here rather than only
 * in the workflow so that running a proof by hand on Linux behaves the same as
 * running it in CI. Its absence is reported as itself rather than as ENOENT from
 * the spawn, which reads like the harness misbehaving.
 *
 * **The display is not optional here in the way it is for a policy read-back.**
 * PDF.js's display path schedules through `requestAnimationFrame`, and Chromium
 * fires none in a page whose `visibilityState` is `hidden` — so with no display
 * the render never completes and a proof reports a canvas that was never drawn
 * on, which is precisely the defect it is looking for. A false positive about a
 * working renderer, produced by the environment.
 *
 * @param {string} binary the Electron binary
 * @param {string} name the accessible name of the Open control
 * @param {string} fixture absolute path to the document to render
 * @param {string} zoomName the accessible name of the zoom-in control
 * @returns {{
 *   dispatched: boolean,
 *   settledBy: 'drawn' | 'failed' | 'bound',
 *   width: number,
 *   height: number,
 *   painted: number,
 *   blank: number,
 *   pixels: number,
 *   renderFailed: boolean,
 *   elapsedMs: number,
 *   zoomed: {
 *     clicks: number,
 *     settledBy: 'resized' | 'bound',
 *     width: number,
 *     height: number,
 *     painted: number,
 *     devicePixelRatio: number,
 *   },
 * }}
 */
export function readback(binary, name, fixture, zoomName) {
  const needsDisplay = process.platform === 'linux' && process.env['DISPLAY'] === undefined;
  const XVFB = ['/usr/bin/xvfb-run', '/bin/xvfb-run', '/usr/local/bin/xvfb-run'];
  let wrapper;
  if (needsDisplay) {
    wrapper = XVFB.find((path) => existsSync(path));
    if (wrapper === undefined) {
      throw new Error(
        `Electron needs an X display on Linux and no xvfb-run was found. Tried:\n  ` +
          `${XVFB.join('\n  ')}\nInstall it (\`xvfb\` on Debian/Ubuntu) or export DISPLAY. ` +
          `Without one PDF.js's display path never fires a frame, so this proof would report ` +
          `an undrawn canvas for a renderer that works.`,
      );
    }
  }

  const args = [HARNESS, fixture, name, zoomName];
  const [command, spawnArgs] =
    wrapper === undefined ? [binary, args] : [wrapper, ['-a', binary, ...args]];

  const result = spawnSync(command, spawnArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error(`Could not run the harness via ${command}`, { cause: result.error });
  }

  const line = `${result.stdout}`.split(/\r?\n/).find((entry) => entry.startsWith(MARKER));
  if (line === undefined) {
    // The harness reports its own failures on stderr with a marker, so "it broke
    // and said why" is separated from "it never spoke". Those need different
    // fixes and produce the same missing line.
    const spoke = `${result.stderr}`
      .split(/\r?\n/)
      .filter((entry) => entry.startsWith('MONSTERA_CANVAS_HARNESS_FAILED'))
      .join('\n');
    throw new Error(
      `The harness produced no ${MARKER.trim()} line (exit ${String(result.status)}${
        result.signal === null ? '' : `, signal ${result.signal}`
      }).\n` +
        (spoke === ''
          ? `It reported no failure of its own either, so it was killed or never started. ` +
            `A timeout here means the window never finished loading.\n`
          : `${spoke}\n`) +
        `command: ${command} ${spawnArgs.join(' ')}\n` +
        `stdout: ${result.stdout.slice(0, 1200)}\n` +
        `stderr: ${result.stderr.slice(-2400)}`,
    );
  }
  return JSON.parse(line.slice(MARKER.length));
}
