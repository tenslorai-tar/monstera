import { channels } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { COMMAND_PROBLEM_DIALOG } from './commandProblem.js';

/**
 * The dialog's code list against the channels' declared codes.
 *
 * ## Two rosters, and only one of them can grow behind the other's back
 *
 * The dialog enumerates the codes it can render. The channels enumerate the
 * codes a handler may report. Those are two lists of the same thing, maintained
 * in two files, and the direction the danger runs is **growth**: a channel
 * gaining a code nobody adds here is a refusal whose props are rejected at the
 * open call, so the user meets the silence this dialog was built to end.
 *
 * 4c's rule says derive from the set when the failure makes that set bigger, so
 * this derives from `channels` — a declared code added anywhere reddens the case
 * without anybody remembering to widen a literal here.
 *
 * The reverse — a code the dialog can render that no channel declares — is
 * harmless and deliberately not asserted: it is a sentence nobody reaches, not a
 * refusal nobody sees.
 */

/** The channels whose refusals reach a user through this dialog. */
const REPORTED = ['document.execute', 'document.undo', 'document.save'] as const;

describe('the command-problem dialog covers every code a document command can report', () => {
  it('accepts every failure the reporting channels declare', () => {
    const declared = [...new Set(REPORTED.flatMap((id) => [...channels[id].failures]))];

    // A BROKEN LOOKUP IS NOT A CLEAN RESULT. An empty list would make the loop
    // below assert nothing and pass, which is the reassuring answer for a
    // `channels` import that resolved to the wrong shape.
    expect(declared.length).toBeGreaterThan(2);

    for (const code of declared) {
      const parsed = COMMAND_PROBLEM_DIALOG.props.safeParse({ code });
      expect(parsed.success, `the dialog cannot render "${code}"`).toBe(true);
    }
  });

  it('accepts `internal` WITH an incident, and refuses it without one', () => {
    // The boundary mints an id for exactly this code (ADR-0009 §9), so a dialog
    // that accepted a bare `internal` would render a reference-less failure and
    // the id would be minted for nobody.
    expect(COMMAND_PROBLEM_DIALOG.props.safeParse({ code: 'internal', incident: 'i1' }).success).toBe(
      true,
    );
    expect(COMMAND_PROBLEM_DIALOG.props.safeParse({ code: 'internal' }).success).toBe(false);
  });

  it('refuses an incident on a DECLARED code, so the pairing is unrepresentable', () => {
    // A declared failure travels alone. `{code: 'document-busy', incident}` is a
    // shape the boundary cannot produce, and a schema that tolerated it would
    // invite a caller to construct one.
    expect(
      COMMAND_PROBLEM_DIALOG.props.safeParse({ code: 'document-busy', incident: 'i1' }).success,
    ).toBe(false);
  });

  it('CONTROL: a code no channel declares is refused', () => {
    // Without this, every case above is satisfied by a schema that accepts any
    // object — which is what a `z.record` or a widened union would be, and the
    // acceptance cases could not tell the difference.
    expect(COMMAND_PROBLEM_DIALOG.props.safeParse({ code: 'document-on-fire' }).success).toBe(false);
  });
});
