import { act, fireEvent, screen } from '@testing-library/react';

import { loadFaces } from '../signatureFaces.js';

/**
 * The two waits a typed signature's test has, each awaited as the event it is rather than polled against a clock.
 *
 * **Why not `findBy`.** Its one-second window is wall-clock, and both waits are CPU-bound: reading the fifteen faces
 * cost 306 ms here alone and 3,079 ms with eight runs sharing four cores, and opening the style menu draws the name in
 * every face, 84 ms alone. On a loaded runner each passes the window with no defect anywhere, which is how
 * `SignDocumentBody.test.tsx` went red on the test-resolution step of 3a13d091 (measured 2026-10-04: two of eight
 * contended runs missed at the same line). Neither wait involves a timer: the faces are one cached promise per face and
 * the menu opens inside React's own work, so awaiting them is exact however slow the machine is, and a missing face or
 * a menu that does not open still fails, at the `getBy` that follows.
 *
 * Used by tests only.
 */

/** Waits until the faces a body asked for on mounting are read and drawn: the same cached promises, then React's work. */
export async function facesRead(): Promise<void> {
  await act(async () => {
    await loadFaces();
  });
}

/** Opens the style menu from its trigger, named by the face in force, and flushes the open. */
export async function openStyleMenu(face: string): Promise<void> {
  const trigger = screen.getByRole('button', { name: `Style: ${face}` });
  await act(async () => {
    fireEvent.click(trigger);
    await Promise.resolve();
  });
}
