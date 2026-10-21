import { useCallback, useLayoutEffect, useRef } from 'react';

import type { CommandContext, CommandRegistry, UiCommand } from './commands.js';

/**
 * Runs a command — or holds it, a double press on a tool that stays on — against the context on screen at the press. A
 * command named by its id is looked up in the registry on screen at the press.
 */
export type RunCommand = (command: UiCommand | string, how?: 'run' | 'hold') => void;

/**
 * THE ONE WAY a projection runs a command from a press (ADR-0258's measurement): a function that keeps its identity, and
 * reads the context — and, for a command named by id, the registry — on screen when it is called rather than when it was
 * drawn.
 *
 * Every button, item and menu entry drawn from the registry handed `command.run(context)` to its handler, a new
 * function each time the context changed — and the context is a new object at every version a command moves, which
 * also rebuilds the registry, so every command object is new too. Each command's answer drew every control again, the UI
 * library's button, tooltip and menu components with them: about 45 ms of an erasure's React work, read 2026-10-21 by
 * CPU profiles of `measureMove.pw.ts` on an unminified, compiled bundle. A control given only plain values — its id,
 * title, icon and state — and this runner keeps the same props across that version, so it is not drawn again.
 *
 * What a control SHOWS — whether it is enabled, pressed, shown at all — is still read from `context` while it is drawn,
 * as plain values; only what a press does is read at the press. Both are taken after each commit, before the frame is
 * painted, so a press always runs what the screen it was made on showed.
 */
export function useRunCommand(context: CommandContext, registry?: CommandRegistry): RunCommand {
  const latest = useRef({ context, registry });
  useLayoutEffect(() => {
    latest.current = { context, registry };
  });
  return useCallback((named: UiCommand | string, how: 'run' | 'hold' = 'run') => {
    const now = latest.current;
    const command = typeof named === 'string' ? now.registry?.get(named) : named;
    if (command === undefined) return;
    // Not awaited, for `QuickToolbar`'s reason: a handler returning a promise would make React's event handling wait on
    // IPC, and nothing here reads the result.
    if (how === 'hold') command.hold?.(now.context);
    else void command.run(now.context);
  }, []);
}
