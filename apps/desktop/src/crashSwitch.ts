/**
 * A crash on purpose, for checking the crash report offer from a real crash: `--monstera-crash=renderer` ends the
 * window's renderer once its page has loaded, `--monstera-crash=main` ends this process the same way. Ending a process
 * from outside (Task Manager's *End task*) is a termination, not a crash, so Crashpad writes no report and the offer
 * the person would see after a real crash is never reached (tried by the owner, 2026-10-22).
 *
 * **A packaged build never obeys it**: the switch would be a way for anything that can start Monstera with arguments —
 * a shortcut, a file association's command line — to make it crash. So the answer for a packaged build is `null`
 * whatever the arguments say, and that is decided here rather than at the call site.
 */
export type CrashOrder = 'renderer' | 'main';

const SWITCH = '--monstera-crash=';

/** @param argv the process's arguments @param packaged `app.isPackaged` */
export function crashOrdered(argv: readonly string[], packaged: boolean): CrashOrder | null {
  if (packaged) return null;
  const given = argv.find((argument) => argument.startsWith(SWITCH))?.slice(SWITCH.length);
  return given === 'renderer' || given === 'main' ? given : null;
}
