// @vitest-environment happy-dom
import { channels, contrast } from '@monstera/shared';
import { render } from '@testing-library/react';
import { type ReactElement, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOnColor } from './useOnColor.js';

const WHITE = channels('#ffffff');

/** An element solving `--out` from `wanted` against `--paper`, declared by a stylesheet rule as the cascade does. */
function Probe({ wanted }: { readonly wanted: string }): ReactElement {
  const element = useRef<HTMLDivElement | null>(null);
  useOnColor(element, '--out', wanted, ['--paper'], 3);
  return <div className="probe" ref={element} />;
}

function declare(rules: string): void {
  const sheet = document.createElement('style');
  sheet.dataset['fixture'] = 'tokens';
  sheet.textContent = `.probe { --paper: #ffffff; ${rules} }`;
  document.head.append(sheet);
}

afterEach(() => {
  for (const sheet of document.querySelectorAll('style[data-fixture="tokens"]')) sheet.remove();
});

/** The solved colour's contrast against the white paper. */
async function solvedContrast(container: HTMLElement): Promise<number> {
  const probe = container.querySelector<HTMLElement>('.probe');
  if (probe === null) throw new Error('the probe rendered');
  await vi.waitFor(() => {
    expect(probe.style.getPropertyValue('--out')).not.toBe('');
  });
  const solved = channels(probe.style.getPropertyValue('--out'));
  if (solved === null || WHITE === null) throw new Error('a colour did not parse');
  return contrast(solved, WHITE);
}

describe('useOnColor', () => {
  it('solves a TRANSLUCENT colour as drawn over the paper, by the least change (Part A3)', async () => {
    // The light theme's soft border. Composited over white it is a pale grey, so the solve darkens it to about 3:1.
    // Its channels read bare are near-black, already 17:1, which the solve handed back unchanged.
    declare('--soft: rgba(15, 30, 22, 0.06);');
    const { container } = render(<Probe wanted="--soft" />);
    const ratio = await solvedContrast(container);
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(ratio).toBeLessThan(3.2);
  });

  it('CONTROL: an opaque colour that already clears the floor is handed back as it is', async () => {
    declare('--solid: #595959;');
    const { container } = render(<Probe wanted="--solid" />);
    const probe = container.querySelector<HTMLElement>('.probe');
    await solvedContrast(container);
    expect(probe?.style.getPropertyValue('--out')).toBe('rgb(89, 89, 89)');
  });
});
