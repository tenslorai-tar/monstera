import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { PARK_AFTER_MS, type ParkingState, type ParkingTab, toPark } from './layerParking.js';

/**
 * ADR-0129's correction of 2026-10-17: a layer behind for a minute parks, and never one with something to lose. Each
 * control is the one input the rule must refuse, built from a tab the rule otherwise parks.
 */
const A = asDocId('doc-a');
const B = asDocId('doc-b');
const C = asDocId('doc-c');

const clean = (docId: typeof A): ParkingTab => ({ docId, version: asDocVersion(1), openedVersion: asDocVersion(1) });

const state = (overrides: Partial<ParkingState> = {}): ParkingState => ({
  shown: A,
  arriving: undefined,
  behindSince: new Map([
    [B, 0],
    [C, 0],
  ]),
  parked: new Set(),
  inFlight: 0,
  now: PARK_AFTER_MS,
  ...overrides,
});

describe('which layers behind park', () => {
  it('a clean document behind for the full minute parks; the one on show does not', () => {
    expect(toPark([clean(A), clean(B), clean(C)], state())).toStrictEqual([B, C]);
  });

  it('CONTROL: one millisecond short of the minute, nothing parks', () => {
    expect(toPark([clean(A), clean(B)], state({ now: PARK_AFTER_MS - 1 }))).toStrictEqual([]);
  });

  it('CONTROL: a document a command has applied to never parks — it has an undo history and may have unsaved changes', () => {
    const edited: ParkingTab = { docId: B, version: asDocVersion(2), openedVersion: asDocVersion(1) };
    expect(toPark([clean(A), edited, clean(C)], state())).toStrictEqual([C]);
  });

  it('CONTROL: a document held across a reload, whose history this window did not watch, never parks', () => {
    const held: ParkingTab = { docId: B, version: asDocVersion(1), openedVersion: undefined };
    expect(toPark([clean(A), held, clean(C)], state())).toStrictEqual([C]);
  });

  it('CONTROL: nothing parks while a write or work is in flight', () => {
    expect(toPark([clean(A), clean(B)], state({ inFlight: 1 }))).toStrictEqual([]);
  });

  it('CONTROL: the layer coming forward is not behind, and one already parked is not parked again', () => {
    expect(toPark([clean(A), clean(B), clean(C)], state({ arriving: B, parked: new Set([C]) }))).toStrictEqual([]);
  });

  it('CONTROL: a document with no time behind on record does not park', () => {
    expect(toPark([clean(A), clean(B)], state({ behindSince: new Map() }))).toStrictEqual([]);
  });
});
