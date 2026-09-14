/**
 * Handing a page to the operating system's PDF handler — ADR-0062 Decision 2.
 *
 * ## Only a `.pdf`, and the rule lives here once
 *
 * An extension chooses which program the operating system runs, and a save dialog lets a
 * person type `page.exe`. So *a path this build may hand over ends `.pdf`, in any case* is
 * one function, and both of its callers take it (B3a):
 *
 * - the send-out, before it writes, so no page's bytes are left under a program's name;
 * - the launcher in `entry.ts`, before `shell.openPath`, so a caller that skipped the first
 *   check still cannot hand the operating system anything else.
 *
 * Its own module rather than `docusignSignIn.ts`, where `OpenInBrowser` lives: that is the
 * sign-in's, and this is not.
 */

/**
 * Opens a `.pdf` in the operating system's handler. It answers the handler's error
 * message, or `null` when it opened.
 *
 * **It never throws for a launch that failed.** Electron's `shell.openPath` reports
 * failure as a string, and a non-`null` answer is the send-out's `launch-failed` — an
 * outcome the person is told about, rather than a failure nothing sees.
 */
export type OpenExternalEditor = (path: string) => Promise<string | null>;

/** Whether a path may be handed to the operating system's PDF handler. */
export function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf');
}
