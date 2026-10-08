import { win32 } from 'node:path';

/**
 * The machine's installed fonts' folder, which the hosts that set text read beside the bundled set
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)
 * Decision 2), or `null` where there is none to hand them.
 *
 * ## The system folder, and only it
 *
 * Windows keeps the fonts installed for every user in `%SystemRoot%\Fonts`. A font installed for one person alone lives
 * under that person's profile, which a contained host is never handed, so it is not a source; the resolver then sets
 * the word in a bundled face, which is what it does on a machine that has no such font.
 *
 * `SystemRoot` and its older spelling `windir` are Windows' own, set for every process. Off Windows there is no host to
 * hand a folder to, and `null` says so rather than guessing a Linux font path the hosts would never read.
 */
export function installedFontsFolder(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== 'win32') return null;
  const root = environment['SystemRoot'] ?? environment['windir'];
  return root === undefined || root.length === 0 ? null : win32.join(root, 'Fonts');
}
