import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { CommandContext, CommandRegistry } from './registries/commands.js';
import type { SettingsStore } from './settingsStore.js';
import { onEditorChange } from './textEditorControl.js';

/**
 * Every command's answers in one string: whether it exists here (`when`) and, where it has one, whether its state is
 * the current one (`checked`). Two contexts in which every command answers the same give the same string.
 */
export function commandAnswers(registry: CommandRegistry, context: CommandContext): string {
  return registry
    .all()
    .map((command) => {
      const shown = command.when?.(context) ?? true;
      const checked = command.checked?.(context);
      return `${command.id}${shown ? '' : '~'}${checked === undefined ? '' : checked ? '+' : '-'}`;
    })
    .join(' ');
}

/**
 * The context the surfaces are given, carrying every command's answers, so a surface memoized on it draws a command's
 * new state the moment it moves (ADR-0258's correction of 2026-10-26).
 *
 * ## Why the answers, and not the stores
 *
 * A predicate is handed only the context, but many read a store they were given when the command was made: the
 * settings (Loupe, the rulers, the theme), the panels' presence, which reads the settings, and the open text editor's
 * formatting. The React Compiler memoizes a surface by what it is given, so when only such a store moved, nothing the
 * surface was given had changed and it drew the answer from before: Loupe pressed once stayed unpressed until a tab
 * switch (`commandStateLive.pw.ts`). So the answers are asked here, of the predicates themselves, whenever one of the
 * stores they read moves and whenever the shell renders; the context's identity moves exactly when an answer does, and
 * nothing renders again for a change no answer shows.
 *
 * ## What a predicate may read, then
 *
 * The context; state the shell holds, from which the registry is rebuilt, so it is asked again on that render; and the
 * stores subscribed below. A predicate that reads another store must have that store added to {@link subscribe}, or its
 * surfaces draw it late — the one list to keep, and the proof's every-command case is what notices a missing one.
 */
export function useCommandContext(registry: CommandRegistry, base: CommandContext, settings: SettingsStore): CommandContext {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      const stops = [settings.subscribe(onChange), onEditorChange(onChange)];
      return () => {
        for (const stop of stops) stop();
      };
    },
    [settings],
  );
  const snapshot = useCallback(() => commandAnswers(registry, base), [registry, base]);
  const answers = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => ({ ...base, answers }), [base, answers]);
}
