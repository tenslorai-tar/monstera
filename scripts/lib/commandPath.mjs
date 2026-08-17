// @ts-check
/**
 * Resolves a command to the file it will actually execute.
 *
 * Two callers need this and neither should spawn a process to get it: the
 * scanner canary hashes the binary to key its cache, and gitleaks resolution
 * picks a candidate. Both used to answer "is this real" by running it, which
 * costs about 600 ms on Windows and — more importantly — answers a weaker
 * question than either caller was asking.
 */

import { existsSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

/**
 * @param {string} candidate
 * @returns {boolean} True when the path names an existing regular file.
 */
function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} command A path, or a bare name to look up on PATH.
 * @returns {string | null} The absolute path, or null if nothing resolves.
 */
export function commandPath(command) {
  if (command === '') return null;

  if (command.includes('/') || command.includes('\\')) {
    const absolute = resolve(command);
    return isFile(absolute) ? absolute : null;
  }

  // PATHEXT is what makes `gitleaks` find `gitleaks.exe` on Windows; without it
  // a bare name never resolves there and the lookup silently reports "absent"
  // for a tool that is installed.
  const extensions =
    process.platform === 'win32'
      ? `${process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT'}`.split(';').filter(Boolean)
      : [''];

  for (const directory of `${process.env['PATH'] ?? ''}`.split(delimiter)) {
    if (directory === '') continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      if (existsSync(candidate) && isFile(candidate)) return candidate;
    }
  }
  return null;
}
