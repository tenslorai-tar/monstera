import type { ContractClient } from '@monstera/contract';
import { useEffect } from 'react';

/**
 * Starts the editing hosts as the Edit tab is shown
 * ([ADR-0048](../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md)'s corrections of
 * 2026-10-20 and 2026-10-21): one ask each time the tab comes into use, so the first read does not pay the hosts' start
 * after the person has pressed. It renews nothing (the correction of 2026-10-26): `main` stops a host `HOST_IDLE_MS`
 * after its last call, on the Edit tab as anywhere else, since keeping them up there held 250 to 300 MB and made nothing
 * faster.
 */
export function useEditingEnginesStarted(client: ContractClient, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    void client['app.prepareEditing']({});
  }, [client, active]);
}
