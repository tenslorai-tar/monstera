import { asDocId, asDocVersion, asFileHandle, type StructuredError } from '@monstera/shared';
import { z } from 'zod';

/**
 * Wire schemas for the branded identity types.
 *
 * Each parses an untrusted primitive and brands it, so a value that arrives
 * from another process is branded only after it has been checked. Branding
 * first and validating later would put an unchecked value into a type that
 * claims it was checked.
 */
export const docIdSchema = z.string().min(1).transform(asDocId);
export const docVersionSchema = z.number().int().nonnegative().transform(asDocVersion);
export const fileHandleSchema = z.string().min(1).transform(asFileHandle);

/**
 * How an error crosses a process or worker boundary (C5).
 *
 * Structured, never a bare string. An `Error` does not survive
 * `structuredClone` or JSON with its identity intact — it arrives as `{}` or as
 * a message with no name, no stack and, worst of all, no `cause`, which is
 * usually where the actual failure is. Recursive so the cause chain survives
 * the trip.
 */
export const structuredErrorSchema: z.ZodType<StructuredError> = z.lazy(() =>
  z.object({
    name: z.string(),
    message: z.string(),
    stack: z.string().optional(),
    cause: structuredErrorSchema.optional(),
  }),
);

/**
 * The envelope every channel result travels in.
 *
 * A rejection is data, not an exception, for exactly as long as it is in
 * transit. The preload bridge turns it back into a thrown `Error` so renderer
 * callers stay idiomatic, but on the wire it is a value the schema can check.
 *
 * @param value schema for the success payload
 */
export function envelopeSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: failureSchema }),
  ]);
}

/**
 * What a failure looks like on the wire (ADR-0009 §9).
 *
 * Two fields, both strings, and **`.strict()` is the load-bearing part**: a
 * `message`, a `stack` or a `cause` arriving on a failure is rejected here
 * rather than passed through. That matters because this schema is what the
 * renderer validates against, so it is the last place a diagnostic could sneak
 * across from a main build that drifted — and the failure it would produce is
 * silent, since extra fields are exactly what a permissive parse ignores.
 *
 * `structuredErrorSchema` above is unchanged and still used for the diagnostic
 * that stays main-side. The two schemas describe the two objects, which is the
 * decision made visible: one crosses and one does not.
 */
export const failureSchema = z
  .object({
    code: z.string().min(1),
    incident: z.string().min(1),
  })
  .strict();
