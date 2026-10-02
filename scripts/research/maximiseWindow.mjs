// @ts-check
import { execFileSync } from 'node:child_process';

/**
 * Maximises a launched window, as the owner's is in every recording of the lag (`batch-1`) — 1600 × 852 inside it on
 * the owner's display and on this machine's. ONE helper for the instruments that launch the application, so a memory
 * figure and a frame figure are read at the same size: a window-sized layer is a texture the size of the window.
 *
 * The shell sets no size, and Electron's DevTools protocol has no `Browser.getWindowForTarget` (measured: *"wasn't
 * found"*), so this asks Windows: `ShowWindow(…, SW_MAXIMIZE)` on the main window of THIS run's process, found by its
 * PID — never by title, which the owner's own window shares.
 *
 * @param {number} pid
 */
export function maximise(pid) {
  const command =
    "Add-Type -Name Win -Namespace Frames -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(System.IntPtr window, int command);'; " +
    `$w = (Get-Process -Id ${String(pid)}).MainWindowHandle; if ($w -eq 0) { exit 3 }; [void][Frames.Win]::ShowWindow($w, 3)`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'pipe' });
}
