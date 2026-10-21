import { describe, expect, it, vi } from 'vitest';
import { layerArrival } from './layerArrival.js';

describe('layerArrival', () => {
  it('with no strip mounted, tells as soon as the page area is drawn', () => {
    const told = vi.fn();
    layerArrival(told).page();
    expect(told).toHaveBeenCalledOnce();
  });

  it('with a strip mounted, waits for its cards as well as the page area, in either order', () => {
    const pageFirst = vi.fn();
    const one = layerArrival(pageFirst);
    one.strip.mounted();
    one.page();
    // THE CONTROL: the page area alone is the old rule, under which the rebuilt strip came forward still drawing.
    expect(pageFirst).not.toHaveBeenCalled();
    one.strip.drawn();
    expect(pageFirst).toHaveBeenCalledOnce();

    const stripFirst = vi.fn();
    const two = layerArrival(stripFirst);
    two.strip.mounted();
    two.strip.drawn();
    expect(stripFirst).not.toHaveBeenCalled();
    two.page();
    expect(stripFirst).toHaveBeenCalledOnce();
  });

  it('a strip that unmounts before drawing no longer holds the layer back', () => {
    const told = vi.fn();
    const gate = layerArrival(told);
    const unmount = gate.strip.mounted();
    gate.page();
    expect(told).not.toHaveBeenCalled();
    unmount();
    expect(told).toHaveBeenCalledOnce();
  });

  it('tells once, however many reports follow', () => {
    const told = vi.fn();
    const gate = layerArrival(told);
    gate.page();
    gate.page();
    gate.strip.drawn();
    expect(told).toHaveBeenCalledOnce();
  });
});
