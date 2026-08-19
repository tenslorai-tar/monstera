import {
  INTERNAL_FAILURE,
  asDocId,
  asDocVersion,
  asFileHandle,
  type StructuredError,
} from '@monstera/shared';
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
 * What a failure looks like on the wire (ADR-0009 §9, and its 2026-08-19
 * decision).
 *
 * **Two shapes, both `.strict()`, and neither one is optional-field shaped.** A
 * declared code travels alone; `internal` travels with the id of the log entry
 * its diagnostic was withheld into. `.strict()` is the load-bearing part on both:
 * a `message`, a `stack` or a `cause` arriving on a failure is rejected here
 * rather than passed through, and this schema is what the renderer validates
 * against — the last place a diagnostic could cross from a main build that
 * drifted, and a silent place, since extra fields are exactly what a permissive
 * parse ignores.
 *
 * **The `internal`-without-an-id state is closed by the refinement, not left to
 * member order.** A union tries its members in turn, so `{ code: 'internal' }`
 * with no id would fall through the first member and parse cleanly as the second
 * — an unreportable failure arriving as a well-formed one. Excluding the code
 * there is what makes the two shapes disjoint rather than merely ordered.
 *
 * `structuredErrorSchema` above is unchanged and still describes the diagnostic
 * that stays main-side. Two schemas for two objects: one crosses and one does
 * not.
 */
export const failureSchema = z.union([
  z
    .object({
      code: z.literal(INTERNAL_FAILURE),
      incident: z.string().min(1),
    })
    .strict(),
  z
    .object({
      code: z
        .string()
        .min(1)
        .refine((code) => code !== INTERNAL_FAILURE, {
          message: `"${INTERNAL_FAILURE}" must carry an incident id; a declared code must not.`,
        }),
    })
    .strict(),
]);
