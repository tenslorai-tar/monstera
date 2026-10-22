import { type ContractClient, type FieldAction, type UrlFetchRefusal, schemeOf } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import { SUBMIT_FORM_DIALOG_ID, SUBMIT_FORM_RESULT } from '../dialogs/submitForm.js';
import {
  BUTTON_PRESS_UNREAD,
  BUTTON_SUBMIT_BLOCKED,
  BUTTON_SUBMIT_CREDENTIALS,
  BUTTON_SUBMIT_MAIL_OPENED,
  BUTTON_SUBMIT_MAIL_WITHOUT_DATA,
  BUTTON_SUBMIT_NOT_HTTPS,
  BUTTON_SUBMIT_NOT_OPENED,
  BUTTON_SUBMIT_NOT_TAKEN,
  BUTTON_SUBMIT_SENT,
  BUTTON_SUBMIT_UNAVAILABLE,
  BUTTON_SUBMIT_UNREACHABLE,
  BUTTON_SUBMIT_UNREPRESENTABLE,
  BUTTON_SUBMIT_UNRESOLVABLE,
} from '../messages/en.js';
import type { ShowToast } from '../toasts.js';

/** What `main` answers a submission, and what a refused one said. */
type SubmitAnswer = Awaited<ReturnType<ContractClient['document.submitButtonForm']>>;

/**
 * Each guard reason's sentence for a SUBMISSION, in a total record keyed by the contract's list, for
 * `UrlOpenProblemBody`'s reason. Its own sentences rather than that dialog's: those say a PDF was not saved. The three
 * a POST never meets (a body past a ceiling, a body that is not a PDF, a redirect chain) read as the server not taking
 * it, which is what any of them would be.
 */
const REFUSED: Readonly<Record<UrlFetchRefusal, MessageKey>> = {
  'not-https': BUTTON_SUBMIT_NOT_HTTPS,
  credentials: BUTTON_SUBMIT_CREDENTIALS,
  'blocked-address': BUTTON_SUBMIT_BLOCKED,
  unresolvable: BUTTON_SUBMIT_UNRESOLVABLE,
  unreachable: BUTTON_SUBMIT_UNREACHABLE,
  'http-error': BUTTON_SUBMIT_NOT_TAKEN,
  'too-many-redirects': BUTTON_SUBMIT_NOT_TAKEN,
  'too-large': BUTTON_SUBMIT_NOT_TAKEN,
  'not-a-pdf': BUTTON_SUBMIT_NOT_TAKEN,
};

/** The application's own exports a submission falls back on when its data does not fit in a message. */
export type SubmitFallbackId = 'document.export-form-data-fdf' | 'document.export-form-data-xfdf';

/** What asking and sending needs: the dialog, a sentence, and the application's own Export form data. */
export interface ButtonSubmitDeps {
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  readonly toast: ShowToast;
  readonly run: (id: SubmitFallbackId) => Promise<void>;
}

/**
 * ASKED FIRST, then sent (ADR-0259 Decision 6): the question names the address, the encoding and the fields as the
 * button's action holds them, and only *Send* (or *Open in mail app*) calls `send`, which names the step and never the
 * address or the data. What `main` answers is then said: a send, a refusal by the guard's reason, or the mail app.
 *
 * WHERE THE DATA DID NOT FIT in a message, the mail app opened without it and the person is told so, and the
 * application's own Export form data runs, whose save dialog is its question, so they can attach the file themselves.
 * HTML form data has no export of its own and falls back on FDF, the encoding a submission writes with no flag.
 */
export async function askThenSubmit(
  deps: ButtonSubmitDeps,
  action: Extract<FieldAction, { kind: 'submit' }>,
  send: () => Promise<SubmitAnswer>,
): Promise<void> {
  const mail = schemeOf(action.address) === 'mailto:';
  const answer = await deps.ask(SUBMIT_FORM_DIALOG_ID, { address: action.address, format: action.format, fields: action.fields, mail });
  if (!SUBMIT_FORM_RESULT.safeParse(answer).success) return;
  const sent = await send();
  if (!sent.ok) {
    deps.toast('problem', BUTTON_SUBMIT_UNAVAILABLE);
    return;
  }
  const outcome = sent.value;
  switch (outcome.kind) {
    case 'sent':
      deps.toast('done', BUTTON_SUBMIT_SENT);
      return;
    case 'mail-opened':
      deps.toast('done', BUTTON_SUBMIT_MAIL_OPENED);
      return;
    case 'mail-opened-without-data':
      deps.toast('problem', BUTTON_SUBMIT_MAIL_WITHOUT_DATA);
      await deps.run(action.format === 'xfdf' ? 'document.export-form-data-xfdf' : 'document.export-form-data-fdf');
      return;
    case 'refused':
      deps.toast('problem', REFUSED[outcome.reason]);
      return;
    case 'not-opened':
      deps.toast('problem', BUTTON_SUBMIT_NOT_OPENED);
      return;
    case 'unrepresentable':
      deps.toast('problem', BUTTON_SUBMIT_UNREPRESENTABLE);
      return;
    case 'stale':
    case 'no-such-submit':
      deps.toast('problem', BUTTON_PRESS_UNREAD);
      return;
  }
}
