import { describe, expect, it } from 'vitest';

import { type ClosingWindow, createCloseGate } from './windowClose.js';

/** A window that records what the gate did to it. */
function recording(canAsk: boolean): ClosingWindow & { asked: number; closed: number } {
  const window = {
    asked: 0,
    closed: 0,
    ask: () => {
      window.asked += 1;
      return canAsk;
    },
    close: () => {
      window.closed += 1;
    },
  };
  return window;
}

describe('the window close gate', () => {
  it('holds the first close and asks the renderer', () => {
    const window = recording(true);
    const gate = createCloseGate(window);

    expect(gate.onCloseRequested()).toBe(false);
    expect(window.asked).toBe(1);
    // THE DECISION, not an end state: holding means nothing was closed by the gate itself.
    expect(window.closed).toBe(0);
  });

  it('asks again on a second close while the first is unanswered, and still holds', () => {
    const window = recording(true);
    const gate = createCloseGate(window);
    gate.onCloseRequested();

    expect(gate.onCloseRequested()).toBe(false);
    expect(window.asked).toBe(2);
  });

  it('once confirmed, closes the window and lets the close it raises through without asking', () => {
    const window = recording(true);
    const gate = createCloseGate(window);
    gate.onCloseRequested();

    gate.confirm();

    expect(window.closed).toBe(1);
    expect(gate.onCloseRequested()).toBe(true);
    // CONTROL for the case above: the second pass did not reach `ask`.
    expect(window.asked).toBe(1);
  });

  it('lets the close through when there is no page to ask', () => {
    const window = recording(false);
    const gate = createCloseGate(window);

    expect(gate.onCloseRequested()).toBe(true);
    expect(window.asked).toBe(1);
  });
});
