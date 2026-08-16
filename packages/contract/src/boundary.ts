import { type Result, type StructuredError, err, ok, toStructuredError } from '@monstera/shared';

import type { ChannelMap, ClientApi, Handlers, ParamsOf, ResultOf } from './channel.js';
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
 * A handler may throw. The throw is converted to a structured error rather than
 * being allowed to reject the IPC call, because a rejection across Electron's
 * bridge arrives having lost its name, stack and cause.
 */
export function wrapHandler<TMap extends ChannelMap, K extends keyof TMap & string>(
  channels: TMap,
  id: K,
  handler: Handlers<TMap>[K],
): (rawParams: unknown) => Promise<Result<ResultOf<TMap, K>>> {
  const definition = channels[id];
  if (definition === undefined) {
    throw new Error(`No channel declared for "${id}"`);
  }

  return async (rawParams: unknown) => {
    const parsedParams = definition.params.safeParse(rawParams);
    if (!parsedParams.success) {
      return err(
        toStructuredError(
          new Error(`Invalid params for "${id}": ${parsedParams.error.message}`, {
            cause: parsedParams.error,
          }),
        ),
      );
    }

    let produced: unknown;
    try {
      produced = await handler(parsedParams.data as ParamsOf<TMap, K>);
    } catch (thrown) {
      return err(toStructuredError(thrown));
    }

    const parsedResult = definition.result.safeParse(produced);
    if (!parsedResult.success) {
      return err(
        toStructuredError(
          new Error(
            `Handler for "${id}" returned a value that does not match its declared result: ` +
              parsedResult.error.message,
            { cause: parsedResult.error },
          ),
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
): { readonly [K in keyof TMap]: (rawParams: unknown) => Promise<Result<ResultOf<TMap, K>>> } {
  const entries = Object.keys(channels).map((id) => [
    id,
    wrapHandler(channels, id as keyof TMap & string, handlers[id as keyof TMap]),
  ]);
  return Object.fromEntries(entries) as {
    readonly [K in keyof TMap]: (
      rawParams: unknown,
    ) => Promise<Result<ResultOf<TMap, K>>>;
  };
}

/**
 * Rebuilds a thrown `Error` from its structured form, preserving the cause
 * chain, so a renderer caller can use `try`/`catch` normally.
 *
 * The original `stack` is kept as a property rather than assigned over the new
 * error's own stack: the two describe different processes, and silently
 * replacing the local stack with a remote one makes the call site that failed
 * unfindable.
 */
export function toError(structured: StructuredError): Error {
  const error = new Error(structured.message, {
    ...(structured.cause === undefined ? {} : { cause: toError(structured.cause) }),
  });
  error.name = structured.name;
  if (structured.stack !== undefined) {
    Object.defineProperty(error, 'remoteStack', {
      value: structured.stack,
      enumerable: true,
    });
  }
  return error;
}

/**
 * Unwraps an envelope on the client side: a success becomes the value, a
 * failure becomes a thrown reconstructed `Error`.
 */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw toError(result.error);
}

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
      async (params: unknown): Promise<unknown> => {
        const raw = await invoke(id, params);
        const parsed = envelope.safeParse(raw);
        if (!parsed.success) {
          throw new Error(
            `Malformed response envelope for "${id}": ${parsed.error.message}`,
            { cause: parsed.error },
          );
        }
        return unwrap(parsed.data as Result<unknown>);
      },
    ];
  });

  return Object.fromEntries(entries) as ClientApi<TMap>;
}
