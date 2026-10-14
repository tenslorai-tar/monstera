/**
 * Stops a host that has gone `idleMs` without a call (the owner's run 4 item 13b), the ONE rule for every host that
 * holds no document's session (B3a): PDFium's, which writes byte images and holds nothing between commands (ADR-0047),
 * and the compose host, which holds no document (ADR-0060). The MuPDF host is not one of them: it holds every open
 * document's live session.
 *
 * ## Counted from the call, armed at its end
 *
 * `counted` wraps each of a binding's calls. A call counts from when it is made, not from when it reaches the host, so a
 * call that has asked for the host and not yet used it counts: a retire must never stop a host between the two. Its end
 * arms one timer, replacing the last, so the host is asked to stop `idleMs` after its LAST call.
 *
 * The stop is the binding's `retire`, which decides by its own account — `busy()` and anything else it holds, such as a
 * workbook's parts in its area — and answers whether it stopped. A retire that declined arms nothing: whatever it saw
 * will end and arm a new timer, or is a state no timer should end.
 *
 * The timer is unref'd: an idle stop is never a reason for the process to stay alive.
 */
export function idleHost(
  idleMs: number,
  /** Stops the host where it is idle, read when the timer fires; answers whether it stopped. */
  retire: () => Promise<boolean>,
  /** Where a stop that threw is told; it is never thrown into the call that armed it, which has already answered. */
  failed: (error: unknown) => void,
): {
  readonly counted: <A extends unknown[], R>(call: (...args: A) => Promise<R>) => (...args: A) => Promise<R>;
  readonly busy: () => boolean;
} {
  let running = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const settled = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      retire().catch(failed);
    }, idleMs);
    timer.unref();
  };
  return {
    counted:
      (call) =>
      async (...args) => {
        running += 1;
        try {
          return await call(...args);
        } finally {
          running -= 1;
          settled();
        }
      },
    busy: () => running !== 0,
  };
}
