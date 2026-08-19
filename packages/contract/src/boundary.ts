import { type Failure, type Result, err, ok } from '@monstera/shared';

import {
  type ChannelMap,
  type ClientApi,
  type FailureOf,
  type Handlers,
  INTERNAL_FAILURE,
  type ParamsOf,
  type ResultOf,
} from './channel.js';
import { IncidentLog, type IncidentSink } from './incident.js';
import { envelopeSchema } from './schemas.js';

/**
 * Wraps one handler so that everything crossing the boundary is validated in
 * exactly one place (C5).
 *
 * Both directions are checked, and the outbound direction is the one people
 * question:
 *
 * - **Inbound** params come from another process and are untrusted by
 *   definition. Nothing else downstream re-checks them, which is what makes
 *   "validated once, at the boundary" true rather than aspirational.
 * - **Outbound** results come from our own code, so validating them looks
 *   redundant. It is not: it catches a handler that has drifted from the
 *   contract at the moment it drifts, in the process that owns the bug, with a
 *   schema error naming the field. Without it the same defect surfaces later as
 *   a renderer reading `undefined` off a view model, which is a much longer
 *   walk back to the cause.
 *
 * ## What crosses when something goes wrong (ADR-0009 §9)
 *
 * A handler may throw, and a throw must not reject the IPC call — a rejection
 * across Electron's bridge arrives having lost its name, stack and cause. But
 * the diagnostic that preserves them is exactly what must not reach the
 * renderer: `toStructuredError` copies `message`, copies `stack`, and recurses
 * into `cause`, and a rethrown `EPERM` carries an absolute path in the first
 * two.
 *
 * So the throw is **split**. The diagnostic is recorded main-side, where the
 * path is already known, and the renderer gets `internal` plus the incident id
 * that names the log entry. Both purposes served, by two objects rather than
 * one object crossing.
 *
 * A **declared** failure never comes through that path at all: it is returned,
 * typed to the channel's codes, and passes straight out.
 */
export function wrapHandler<TMap extends ChannelMap, K extends keyof TMap & string>(
  channels: TMap,
  id: K,
  handler: Handlers<TMap>[K],
  incidents: IncidentLog,
): (rawParams: unknown) => Promise<Result<ResultOf<TMap, K>, Failure<FailureOf<TMap, K>>>> {
  const definition = channels[id];
  if (definition === undefined) {
    throw new Error(`No channel declared for "${id}"`);
  }

  const internal = (thrown: unknown): Result<never, Failure<FailureOf<TMap, K>>> =>
    err({ code: INTERNAL_FAILURE, incident: incidents.record(id, thrown) });

  return async (rawParams: unknown) => {
    const parsedParams = definition.params.safeParse(rawParams);
    if (!parsedParams.success) {
      // A schema error names fields and values, which is a disclosure question
      // as much as the fs errors are — so it is recorded, not forwarded.
      return internal(
        new Error(`Invalid params for "${id}": ${parsedParams.error.message}`, {
          cause: parsedParams.error,
        }),
      );
    }

    let produced: Result<unknown>;
    try {
      produced = await handler(parsedParams.data as ParamsOf<TMap, K>);
    } catch (thrown) {
      return internal(thrown);
    }

    if (!produced.ok) {
      // A DECLARED failure, checked against the declaration rather than trusted.
      // The type already forbids an undeclared code; this catches the case the
      // type cannot see — a handler reached through an `any` at some boundary,
      // or a build that drifted from the contract it was compiled against.
      const declared: readonly string[] = [...definition.failures, INTERNAL_FAILURE];
      if (!declared.includes(produced.error.code)) {
        return internal(
          new Error(
            `Handler for "${id}" reported the undeclared failure code ` +
              `"${produced.error.code}". Declared: ${declared.join(', ')}.`,
          ),
        );
      }
      return produced as Result<never, Failure<FailureOf<TMap, K>>>;
    }

    const parsedResult = definition.result.safeParse(produced.value);
    if (!parsedResult.success) {
      return internal(
        new Error(
          `Handler for "${id}" returned a value that does not match its declared result: ` +
            parsedResult.error.message,
          { cause: parsedResult.error },
        ),
      );
    }

    return ok(parsedResult.data as ResultOf<TMap, K>);
  };
}

/**
 * Wraps every handler in a registry. The return type is keyed by the registry,
 * so a caller that registers this map with the IPC layer cannot miss a channel.
 */
export function wrapHandlers<TMap extends ChannelMap>(
  channels: TMap,
  handlers: Handlers<TMap>,
  sink: IncidentSink,
): {
  readonly [K in keyof TMap]: (
    rawParams: unknown,
  ) => Promise<Result<ResultOf<TMap, K>, Failure<FailureOf<TMap, K>>>>;
} {
  // One log for the registry, so ids are unique across its channels and a
  // report naming i7 identifies one line rather than one per channel.
  const incidents = new IncidentLog(sink);
  const entries = Object.keys(channels).map((id) => [
    id,
    wrapHandler(channels, id as keyof TMap & string, handlers[id as keyof TMap], incidents),
  ]);
  return Object.fromEntries(entries) as {
    readonly [K in keyof TMap]: (
      rawParams: unknown,
    ) => Promise<Result<ResultOf<TMap, K>, Failure<FailureOf<TMap, K>>>>;
  };
}

/**
 * `toError` and `unwrap` were here and are **deleted**, not moved.
 *
 * They rebuilt a thrown `Error` from the wire form so a renderer caller could
 * use `try`/`catch`, and kept the remote `stack` on it as a property. That was
 * right while the wire carried a message and a stack. It is wrong now that it
 * carries a code and an incident id (ADR-0009 §9): there is no message to
 * rebuild an `Error` from, the renderer's text comes from an i18n key, and
 * `remoteStack` was a field whose entire content was absolute paths.
 *
 * A failure is now a value the caller must destructure — which is also the
 * property a `catch` never had, since nothing makes a caller write one.
 */

/**
 * Builds the client surface for a registry from a single transport function.
 *
 * This is the fourth derived surface: the preload bridge passes
 * `ipcRenderer.invoke` and the browser shim passes an in-process call, and both
 * get a fully typed client without either restating a channel. A shim that does
 * not implement the whole registry fails to compile, which is what stops the
 * test double drifting away from the real thing while its tests stay green.
 *
 * The envelope is validated on arrival. Main is not an attacker, but it is a
 * different process that can be a different build during development, and a
 * malformed envelope should surface as a schema error naming the channel rather
 * than as `undefined` propagating into the UI.
 */
export function createClient<TMap extends ChannelMap>(
  channels: TMap,
  invoke: (id: keyof TMap & string, params: unknown) => Promise<unknown>,
): ClientApi<TMap> {
  const entries = Object.keys(channels).map((id) => {
    const definition = channels[id];
    if (definition === undefined) throw new Error(`No channel declared for "${id}"`);
    const envelope = envelopeSchema(definition.result);

    return [
      id,
      async (params: unknown): Promise<Result<unknown>> => {
        const raw = await invoke(id, params);
        const parsed = envelope.safeParse(raw);
        if (!parsed.success) {
          // A malformed envelope is main misbehaving, not a channel failure, so
          // it throws rather than being reported as one. It is also the one
          // error here whose text is ours: it names the channel and the schema,
          // never a document.
          throw new Error(`Malformed response envelope for "${id}": ${parsed.error.message}`, {
            cause: parsed.error,
          });
        }
        return parsed.data;
      },
    ];
  });

  return Object.fromEntries(entries) as ClientApi<TMap>;
}
