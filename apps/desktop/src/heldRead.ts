/**
 * A read made once and held for the session: every caller after the first, and every caller while it is in flight, takes
 * the same answer. A read that FAILS is not held, so the next caller asks again rather than meeting the first failure for
 * the rest of the session.
 *
 * For a fact that does not change while the application runs and costs something to read: the computer's font families
 * (W5), whose first read starts the compose host and reads its catalogue.
 */
export function heldRead<T>(read: () => Promise<T>): () => Promise<T> {
  let held: Promise<T> | null = null;
  return () => {
    held ??= read().catch((error: unknown) => {
      held = null;
      throw error;
    });
    return held;
  };
}
