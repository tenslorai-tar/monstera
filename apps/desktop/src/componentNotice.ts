import type { EventId, EventPayload, NativeComponentId } from '@monstera/contract';

/**
 * Tells the person that a part of Monstera could not start on this computer — ONCE per component per run, for the
 * engine hosts and the converters alike (`app.component-cannot-start`).
 *
 * Once, because every document opened after the first meets the same loader, and a dialog per document would bury the
 * one sentence that says what to do. One teller for the whole process, built in `entry.ts`, so a host refusal and a
 * converter refusal of the same run are not told twice.
 */
export function createCannotStartNotice(
  send: (<K extends EventId>(event: K, payload: EventPayload<K>) => void) | undefined,
): (component: NativeComponentId) => void {
  const told = new Set<NativeComponentId>();
  return (component) => {
    if (told.has(component)) return;
    told.add(component);
    send?.('app.component-cannot-start', { component });
  };
}
