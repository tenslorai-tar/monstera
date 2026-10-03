import { describe, expect, it } from 'vitest';

import { APPLICATION_DIALOGS } from '../registries/applicationDialogs.js';
import { DialogRegistry } from '../registries/dialogs.js';
import { DIALOG_SAMPLES } from './dialogSamples.js';

/**
 * The dialog gallery's samples against the registry they review (`dialogGallery.tsx`).
 *
 * Every registered dialog has a state, every state opens through the application's own `openWith` (so its props
 * pass that dialog's schema), and no sample names an id nothing registers. Without this the gallery rots silently:
 * a dialog added later has no picture, and a schema that changed refuses its sample only on the day someone captures.
 */
const registry = new DialogRegistry(APPLICATION_DIALOGS);
const registered = APPLICATION_DIALOGS.map((dialog) => dialog.id);

describe('the dialog gallery’s samples', () => {
  it('give every registered dialog at least one state', () => {
    expect(registered.filter((id) => (DIALOG_SAMPLES[id] ?? []).length === 0)).toStrictEqual([]);
    // CONTROL: the registry is read, not empty, so "none missing" is a fact about the dialogs.
    expect(registered.length).toBeGreaterThan(80);
    expect(registered).toContain('dialog.print');
  });

  it('name no dialog the application does not register', () => {
    expect(Object.keys(DIALOG_SAMPLES).filter((id) => !registered.includes(id))).toStrictEqual([]);
  });

  it('open each state through the registry, so its props pass that dialog’s own schema', () => {
    const refused: string[] = [];
    for (const [id, samples] of Object.entries(DIALOG_SAMPLES)) {
      for (const sample of samples) {
        try {
          registry.openWith(id, sample.props);
        } catch (thrown) {
          refused.push(`${id} ${sample.state}: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
        }
      }
    }
    expect(refused).toStrictEqual([]);
  });

  it('CONTROL: a state whose props the schema refuses is refused here', () => {
    expect(() => registry.openWith('dialog.donate', { unexpected: true })).toThrow();
  });

  it('name each state once per dialog', () => {
    const repeated = Object.entries(DIALOG_SAMPLES).filter(
      ([, samples]) => new Set(samples.map((sample) => sample.state)).size !== samples.length,
    );
    expect(repeated.map(([id]) => id)).toStrictEqual([]);
  });
});
