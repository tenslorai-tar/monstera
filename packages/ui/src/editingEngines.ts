import type { ContractClient } from '@monstera/contract';
import { useEffect } from 'react';

/**
 * How often the Edit tab renews its ask for the editing hosts while it is in use
 * ([ADR-0048](../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md)'s correction of
 * 2026-10-24): each ask is a call on the PDFium and compose hosts, which `main` stops `HOST_IDLE_MS` (60 s) after their
 * last call, so a renewal a third of that apart keeps them running while the tab is used and lets them stop 60 to 80 s
 * after it is left.
 */
export const EDITING_RENEW_MS = 20_000;

/**
 * Starts the editing hosts as the Edit tab is shown and keeps them running while it is in use (item 7a): the ask at once,
 * then again every {@link EDITING_RENEW_MS} until `active` is false or the window goes. Nothing is held in `main`: a
 * window that ends without leaving the tab simply renews nothing, and the hosts stop by their idle rule.
 */
export function useEditingEnginesKept(client: ContractClient, active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const ask = (): void => {
      void client['app.prepareEditing']({});
    };
    ask();
    const renewing = setInterval(ask, EDITING_RENEW_MS);
    return () => {
      clearInterval(renewing);
    };
  }, [client, active]);
}
