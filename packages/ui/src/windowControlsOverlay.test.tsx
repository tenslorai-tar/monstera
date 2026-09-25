// @vitest-environment happy-dom
import type { ContractClient } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { groundOf, hexOf, overlayOf, useWindowControlsOverlay } from './windowControlsOverlay.js';

describe('hexOf', () => {
  it('writes an opaque computed colour as lower-case #rrggbb, with or without an alpha of 1', () => {
    expect(hexOf('rgb(20, 22, 24)')).toBe('#141618');
    expect(hexOf('rgba(230, 232, 230, 1)')).toBe('#e6e8e6');
    expect(hexOf('rgb(0, 0, 0)')).toBe('#000000');
  });

  it('refuses a translucent colour, a named one, and a channel past 255 — there is no single colour to send', () => {
    expect(hexOf('rgba(20, 22, 24, 0.5)')).toBeUndefined();
    expect(hexOf('rgba(0, 0, 0, 0)')).toBeUndefined();
    expect(hexOf('red')).toBeUndefined();
    expect(hexOf('rgb(256, 0, 0)')).toBeUndefined();
  });
});

/** A title bar with stated colours and a stated height, since happy-dom lays nothing out. */
function aBar(background: string, text: string, height: number): HTMLElement {
  const bar = document.createElement('header');
  bar.className = 'm-title-bar';
  bar.style.backgroundColor = background;
  bar.style.color = text;
  bar.getBoundingClientRect = () => ({ height }) as DOMRect;
  document.body.append(bar);
  return bar;
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-theme');
});

describe('overlayOf', () => {
  it('reads the bar: its background, its text colour, and its height rounded to a whole pixel', () => {
    expect(overlayOf(aBar('rgb(20, 22, 24)', 'rgb(230, 232, 230)', 33.6))).toStrictEqual({
      color: '#141618',
      symbolColor: '#e6e8e6',
      height: 34,
    });
  });

  it('reads the GROUND a transparent bar sits on, as v5 draws it, and keeps the bar’s own text colour', () => {
    // The ground is a different colour from anything the bar states, so reading the bar alone would refuse — the
    // defect this replaces, where the buttons kept the system's colours on every v5 window.
    const ground = document.createElement('div');
    ground.style.backgroundColor = 'rgb(5, 10, 8)';
    document.body.append(ground);
    const bar = aBar('rgba(0, 0, 0, 0)', 'rgb(230, 232, 230)', 33);
    ground.append(bar);
    expect(groundOf(bar)).toBe('rgb(5, 10, 8)');
    expect(overlayOf(bar)).toStrictEqual({ color: '#050a08', symbolColor: '#e6e8e6', height: 33 });
  });

  it('CONTROL: a bar that paints its own colour is read as itself, whatever lies behind it', () => {
    const ground = document.createElement('div');
    ground.style.backgroundColor = 'rgb(5, 10, 8)';
    document.body.append(ground);
    const bar = aBar('rgb(20, 22, 24)', 'rgb(230, 232, 230)', 33);
    ground.append(bar);
    expect(overlayOf(bar)?.color).toBe('#141618');
  });

  it('CONTROL: a TRANSLUCENT bar stops the walk and is refused, rather than read through to the ground', () => {
    const ground = document.createElement('div');
    ground.style.backgroundColor = 'rgb(5, 10, 8)';
    document.body.append(ground);
    const bar = aBar('rgba(20, 22, 24, 0.5)', 'rgb(230, 232, 230)', 33);
    ground.append(bar);
    expect(groundOf(bar)).toBe('rgba(20, 22, 24, 0.5)');
    expect(overlayOf(bar)).toBeUndefined();
  });

  it('states nothing for a bar outside the channel height bound, which main would refuse', () => {
    expect(overlayOf(aBar('rgb(20, 22, 24)', 'rgb(230, 232, 230)', 0))).toBeUndefined();
    expect(overlayOf(aBar('rgb(20, 22, 24)', 'rgb(230, 232, 230)', 80))).toBeUndefined();
  });
});

function Host({ client }: { readonly client: ContractClient }): ReactElement | null {
  useWindowControlsOverlay(client);
  return null;
}

function aClient(): { readonly client: ContractClient; readonly sent: ReturnType<typeof vi.fn> } {
  const sent = vi.fn(() => Promise.resolve(ok({ applied: true })));
  return { client: { 'window.titleBarOverlay': sent } as unknown as ContractClient, sent };
}

describe('useWindowControlsOverlay', () => {
  it('sends the bar as computed on mount, and AGAIN when the theme changes its colours — never an unchanged one', async () => {
    const bar = aBar('rgb(20, 22, 24)', 'rgb(230, 232, 230)', 33);
    const { client, sent } = aClient();
    render(<Host client={client} />);
    expect(sent.mock.calls).toStrictEqual([[{ color: '#141618', symbolColor: '#e6e8e6', height: 33 }]]);

    // A ROOT ATTRIBUTE THAT CHANGES NOTHING the bar shows: nothing crosses.
    await act(async () => {
      document.documentElement.setAttribute('data-unrelated', 'x');
      await Promise.resolve();
    });
    expect(sent).toHaveBeenCalledTimes(1);

    // THE THEME APPLIED THE WAY `applyAppearance` APPLIES IT — a root attribute — with the bar's colours changed.
    bar.style.backgroundColor = 'rgb(250, 250, 248)';
    bar.style.color = 'rgb(28, 30, 28)';
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'light');
      await Promise.resolve();
    });
    expect(sent).toHaveBeenCalledTimes(2);
    expect(sent.mock.calls[1]).toStrictEqual([{ color: '#fafaf8', symbolColor: '#1c1e1c', height: 33 }]);
  });

  it('a REFUSED call is not a failure the renderer surfaces — a shell with no handlers is a real state', async () => {
    aBar('rgb(20, 22, 24)', 'rgb(230, 232, 230)', 33);
    const refused = vi.fn(() => Promise.reject(new Error('No handler registered')));
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    render(<Host client={{ 'window.titleBarOverlay': refused } as unknown as ContractClient} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    window.removeEventListener('unhandledrejection', unhandled);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
