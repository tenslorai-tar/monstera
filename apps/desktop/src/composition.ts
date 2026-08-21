import { type IncidentSink } from '@monstera/contract';
import { CapabilityRegistry, CommandBus, DocumentService } from '@monstera/kernel';

import { MAIN_DOCUMENT_BYTES_CEILING } from './budget.js';
import { type AppInfo, createContractHandlers } from './contractHandlers.js';
import { DocumentCommands, type SessionLookup } from './documentCommands.js';
import { type ShellFailureSink } from './shellFailure.js';
import { type ShellDependencies } from './main.js';

/**
 * The composition root: the one place that builds the object graph.
 *
 * ## Why this is assembly and not design
 *
 * Everything it constructs was decided elsewhere. `ARCHITECTURE.md` §2 fixes
 * what `DocumentService` owns, §3 fixes the writer of record, ADR-0009 §7 fixes
 * the lane and §6 the routing, ADR-0021 fixes the retention policy. This file
 * makes no decision that is not already law; if it starts to, that is B4 and the
 * law changes first.
 *
 * It is deliberately **not** the Electron entry point. `entry.ts` is, and it does
 * one thing: call `startShell` with what this returns. Keeping them apart is
 * what lets the whole graph be built and inspected without an Electron runtime —
 * nothing here imports Electron, which the boundary lint enforces for every
 * package and does not enforce for this one, so it is stated instead.
 *
 * ## THE ENGINE HAS NO SESSION, AND THAT IS THE LAW RATHER THAN AN OMISSION
 *
 * `document.execute` resolves a session inside the document's lane and reports a
 * miss as a defect. This root supplies a lookup that always misses, and it must:
 *
 * - §2's process diagram puts MuPDF in a **utility process**, and says of it
 *   *"NO in-main fallback — native faults are uncatchable (L20)"*. Opening a
 *   MuPDF session here would put the native parser in `main`, which invariant 20
 *   forbids by name.
 * - §9.17 argues `main`'s budget from *"main holds canonical bytes and never
 *   parses"*. A parser in `main` is the regression that number exists to catch,
 *   and it was measured at 38.1 MB this week arriving by accident through a
 *   type-only import.
 *
 * So the session's owner is `DocumentService` (§2, §3.2) and the process it
 * lives in is a host that does not exist yet. Wiring one here to make the
 * channel work would be the architecture-under-features retrofit, and it would
 * be wiring it into the one process the law says must not have it.
 *
 * **What this costs, MEASURED rather than predicted — and it is less than it
 * looks.** The obvious reading is that `document.execute` is registered and
 * fails with `internal`, which would be the CC-2 shape. Run through the real
 * bridge, it returns `{ ok: false, error: { code: 'document-not-open' } }` — a
 * **declared** failure code, because `DocumentNotOpenError` fires before the
 * session is ever looked up.
 *
 * The missing-session path needs an *open* document, and **opening one is not a
 * channel**: the contract declares `app.info` and `document.execute` and nothing
 * else. So the renderer cannot construct an input that reaches the miss, and
 * every input it can construct gets a declared outcome. That is checked by
 * `proof:shell`, not assumed — the first draft of this paragraph asserted the
 * unhappy answer and was wrong about it.
 *
 * The host is still what completes the feature, and the `docs/FEATURES.md` row
 * names it.
 */
export function createShellDependencies(appInfo: AppInfo): ShellDependencies {
  const capabilities = new CapabilityRegistry();

  const documents = new DocumentService(capabilities, {
    documentBytesCeiling: MAIN_DOCUMENT_BYTES_CEILING,
  });

  // EMPTY BY CONSTRUCTION, and the type says so. `WriterRegistry` is partial
  // because the seam declares four writers of record and one has an adapter —
  // and that one adapter binds a native library, which may not run here. A
  // command routed to an unregistered writer is refused by name rather than
  // failing at a native call.
  const bus = new CommandBus({});

  const noSessionYet: SessionLookup = () => undefined;
  const commands = new DocumentCommands(documents, bus, noSessionYet);

  return {
    handlers: createContractHandlers({ commands, appInfo }),
    incidents: reportIncident,
    failures: reportShellFailure,
  };
}

/**
 * Where a diagnostic goes until a logger exists.
 *
 * `stderr`, with a marker, and it is a real destination rather than a
 * placeholder: an incident that reached nowhere is the failure `IncidentSink`
 * was made required to prevent. The logging row will replace this; a sink that
 * silently dropped would make that replacement look optional.
 *
 * Diagnostics keep their absolute paths here. That is correct and is the
 * opposite of the renderer-facing rule: this side already knows the path, and
 * only the incident id crosses (invariant 2).
 */
const reportIncident: IncidentSink = (incident) => {
  process.stderr.write(
    `MONSTERA_INCIDENT ${incident.id} on ${incident.channel}: ` +
      `${JSON.stringify(incident.diagnostic)}\n`,
  );
};

/** Where a lifecycle failure goes until a logger exists. */
const reportShellFailure: ShellFailureSink = (failure) => {
  process.stderr.write(`MONSTERA_SHELL_FAILURE ${failure.event}: ${failure.detail}\n`);
};
