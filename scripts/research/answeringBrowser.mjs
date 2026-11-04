// @ts-check
/**
 * Which process the browser an instrument is connected to IS: the one answer every launched-app instrument takes to
 * *is the port answering from the program this run launched?*
 *
 * The browser names its own process (`SystemInfo.getProcessInfo`, its `browser` entry), which is the question netstat
 * was asked and could not answer: once connected, the port's listening socket was not listed and the browser's end of
 * the connection read CLOSED — three of eleven launches of the development build on 2026-11-01 (`frameTimes.mjs`), and
 * every one of two `appMemory.mjs` launches on 2026-11-04, whose netstat check refused a launch it had made itself.
 */

/**
 * @param {any} browser a Playwright browser connected over CDP
 * @returns {Promise<number | undefined>} the browser process's PID
 */
export async function answeringBrowserPid(browser) {
  const info = await (await browser.newBrowserCDPSession()).send('SystemInfo.getProcessInfo');
  return /** @type {{ type: string, id: number }[]} */ (info.processInfo).find((each) => each.type === 'browser')?.id;
}

/**
 * Refuses unless the connected browser is the launched process.
 * @param {any} browser @param {{ pid?: number | undefined, exitCode: number | null }} child @param {string} [label]
 */
export async function requireLaunchedBrowser(browser, child, label = 'the application') {
  const answering = await answeringBrowserPid(browser);
  if (answering === undefined || answering !== child.pid) {
    throw new Error(`${label}: the browser answering is PID ${String(answering)}, not the launched ${String(child.pid)} (exit code ${String(child.exitCode)})`);
  }
}
