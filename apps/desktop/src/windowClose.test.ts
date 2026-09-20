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
    gate.listening();

    expect(gate.onCloseRequested()).toBe(false);
    expect(window.asked).toBe(1);
    // THE DECISION, not an end state: holding means nothing was closed by the gate itself.
    expect(window.closed).toBe(0);
  });

  it('asks again on a second close while the first is unanswered, and still holds', () => {
    const window = recording(true);
    const gate = createCloseGate(window);
    gate.listening();
    gate.onCloseRequested();

    expect(gate.onCloseRequested()).toBe(false);
    expect(window.asked).toBe(2);
  });

  it('LETS A CLOSE THROUGH BEFORE THE RENDERER IS LISTENING, and does not ask a page that cannot answer', () => {
    // The defect this exists for: a pushed request reaches whoever is listening WHEN IT IS SENT,
    // so one sent before the subscription is gone — and a gate that held for it would wait for an
    // answer nobody can send. Measured on `proof:shell`, where the harness quits at `whenReady`
    // and the process hung past 120 s.
    //
    // ASSERTED AS THE CALL: a build that asked and then let the close through anyway produces the
    // same `true`, and would still have spent the one request nobody heard.
    const window = recording(true);
    const gate = createCloseGate(window);

    expect(gate.onCloseRequested()).toBe(true);
    expect(window.asked).toBe(0);

    // AND THE SAME GATE HOLDS once the renderer says it is there, so the line above is a state
    // rather than a gate that never asks.
    gate.listening();
    expect(gate.onCloseRequested()).toBe(false);
    expect(window.asked).toBe(1);
  });

  it('once confirmed, closes the window and lets the close it raises through without asking', () => {
    const window = recording(true);
    const gate = createCloseGate(window);
    gate.listening();
    gate.onCloseRequested();

    gate.confirm();

    expect(window.closed).toBe(1);
    expect(gate.onCloseRequested()).toBe(true);
    // CONTROL for the case above: the second pass did not reach `ask`.
    expect(window.asked).toBe(1);
  });

  it('lets the close through when there is no page to ask', () => {
    // A LISTENING RENDERER WHOSE PAGE HAS SINCE GONE — crashed or destroyed — which is the state
    // `ask` reports with `false`, and is not the never-listened state above.
    const window = recording(false);
    const gate = createCloseGate(window);
    gate.listening();

    expect(gate.onCloseRequested()).toBe(true);
    expect(window.asked).toBe(1);
  });
});
